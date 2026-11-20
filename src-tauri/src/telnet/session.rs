//! Telnet 会话：TCP 连接、协议协商应答、终端驱动、自动登录。
//!
//! 与 SSH 会话对齐的三件事：
//! - 输出走同一条事件通道 `ssh://output/{session_id}`（前端终端不用认协议）；
//! - 状态走 `ssh://status/{session_id}`（`SshStatus::Connected / Disconnected`）；
//! - 会话登记在 `SshManager` 里，`send_input` / `resize` / `disconnect` 等
//!   方法对 Telnet 透明可用。
//!
//! 与 SSH 不同的一件事：**没有 exec 通道**。Telnet 只有一条裸终端流，
//! Agent 的命令通过「发命令 + 回显/哨兵」模拟执行（见 `telnet::exec`），
//! SFTP 直接不支持。

use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::AppHandle;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex as TokioMutex};

use crate::emit_event;
use crate::error::AppError;
use crate::utf8_carry::Utf8Carry;

use super::codec::{
    Codec, CodecEvent, DONT, DO, OPT_BINARY, OPT_ECHO, OPT_NAWS, OPT_SGA, OPT_TTYPE, TTYPE_SEND,
    WILL, WONT,
};

/// 默认终端尺寸（与 SSH 的 PTY 请求一致）。
const DEFAULT_COLS: u16 = 80;
const DEFAULT_ROWS: u16 = 24;
/// 回应 TTYPE 时声称的终端类型（与 SSH 侧 `xterm-256color` 保持一致）。
const TERM_TYPE: &str = "XTERM-256COLOR";
/// TCP 建连超时：与 SSH 握手量级一致，避免在不可达主机上无限等。
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);

/// 发往驱动任务的指令。
pub enum TelnetCommand {
    Input(Vec<u8>),
    Resize { cols: u16, rows: u16 },
    Disconnect,
}

/// 一个活跃的 Telnet 会话。真正的读写由驱动任务独占（与 SSH 的
/// `SshConnection` 同构），外界只能通过 mpsc 下指令。
pub struct TelnetSession {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub connection_id: Option<String>,
    /// 与 SSH 会话共用同一套 generation 语义（重连换代、清理防误删）。
    pub generation: u64,
    pub(crate) cmd_tx: mpsc::UnboundedSender<TelnetCommand>,
    /// exec 模拟的捕获槽：同一时刻只允许一个命令在跑（槽被占用就排队在
    /// 调用方侧等待，见 `subscribe` 的返回值）。
    pub(crate) capture: Arc<TokioMutex<Option<Capture>>>,
}

/// 捕获订阅：以 `token` 区分，驱动侧只把数据发给当前持有者。
pub(crate) struct Capture {
    pub token: String,
    pub tx: mpsc::UnboundedSender<String>,
}

impl TelnetSession {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        id: String,
        host: String,
        port: u16,
        username: String,
        connection_id: Option<String>,
        generation: u64,
        cmd_tx: mpsc::UnboundedSender<TelnetCommand>,
    ) -> Self {
        Self {
            id,
            host,
            port,
            username,
            connection_id,
            generation,
            cmd_tx,
            capture: Arc::new(TokioMutex::new(None)),
        }
    }

    pub fn send_input(&self, data: &[u8]) -> Result<(), AppError> {
        self.cmd_tx
            .send(TelnetCommand::Input(data.to_vec()))
            .map_err(|_| AppError::Ssh("会话已断开".into()))
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), AppError> {
        self.cmd_tx
            .send(TelnetCommand::Resize { cols, rows })
            .map_err(|_| AppError::Ssh("会话已断开".into()))
    }

    pub fn request_disconnect(&self) {
        let _ = self.cmd_tx.send(TelnetCommand::Disconnect);
    }

    /// 订阅输出流（exec 模拟用）。同一会话同时只服务一个订阅者。
    pub(crate) async fn subscribe(&self, token: &str) -> mpsc::UnboundedReceiver<String> {
        let (tx, rx) = mpsc::unbounded_channel();
        let mut slot = self.capture.lock().await;
        *slot = Some(Capture {
            token: token.to_string(),
            tx,
        });
        rx
    }

    /// 释放订阅（只释放自己那一份，避免把后来者顶掉）。
    pub(crate) async fn unsubscribe(&self, token: &str) {
        let mut slot = self.capture.lock().await;
        if slot.as_ref().map(|c| c.token == token).unwrap_or(false) {
            *slot = None;
        }
    }
}

/// 建 TCP 连接（带超时，开启 TCP_NODELAY 降低交互延迟）。
pub(crate) async fn open_tcp(host: &str, port: u16) -> Result<TcpStream, AppError> {
    let stream = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect((host, port)))
        .await
        .map_err(|_| AppError::Ssh(format!("Telnet 连接 {}:{} 超时", host, port)))?
        .map_err(|e| AppError::Ssh(format!("Telnet 连接 {}:{} 失败: {}", host, port, e)))?;
    let _ = stream.set_nodelay(true);
    Ok(stream)
}

/// 登录自动化的凭据（只有密码认证的 Telnet 才会有）。
pub(crate) struct LoginCredentials {
    pub username: String,
    pub password: String,
}

/// 提示语识别：只在**输出尾巴**上匹配，避免历史输出里的 "password" 误触发。
struct LoginAutomator {
    username: String,
    password: String,
    tail: String,
    sent_user: u32,
    sent_password: u32,
    /// 每类提示各记一个上次发送时间：登录提示与密码提示往往前后脚出现，
    /// 共用一个冷却会把第二个提示吞掉。
    last_user: Option<Instant>,
    last_password: Option<Instant>,
}

impl LoginAutomator {
    fn new(credentials: LoginCredentials) -> Self {
        Self {
            username: credentials.username,
            password: credentials.password,
            tail: String::new(),
            sent_user: 0,
            sent_password: 0,
            last_user: None,
            last_password: None,
        }
    }

    /// 观察一段**已去掉 ANSI** 的文本，必要时返回要写回对端的字节。
    fn observe(&mut self, text: &str) -> Option<Vec<u8>> {
        self.tail.push_str(text);
        if self.tail.len() > 512 {
            let cut = self.tail.len() - 512;
            // 按字符边界裁剪，避免切在多字节字符中间
            let boundary = self
                .tail
                .char_indices()
                .find(|(i, _)| *i >= cut)
                .map(|(i, _)| i)
                .unwrap_or(self.tail.len());
            self.tail.drain(..boundary);
        }

        let tail = self.tail.trim_end();
        if !tail.ends_with(':') && !tail.ends_with('：') {
            return None;
        }
        let line = tail.rsplit(['\n', '\r']).next().unwrap_or(tail).to_lowercase();
        let line = line.trim();

        let password_prompt = ["password", "passwd", "密码", "口令"]
            .iter()
            .any(|w| line.contains(w));
        let username_prompt = ["login", "username", "user name", "user:", "账号", "用户名"]
            .iter()
            .any(|w| line.contains(w));

        // 冷却：同一次提示在 3 秒内不重复发送（服务器可能重复打印提示，
        // 而密码已经发出去了，再发一次就变成「密码密码」）。
        let now = Instant::now();
        if password_prompt && self.sent_password < 3 {
            if self
                .last_password
                .map(|last| now.duration_since(last) < Duration::from_secs(3))
                .unwrap_or(false)
            {
                return None;
            }
            self.sent_password += 1;
            self.last_password = Some(now);
            return Some(format!("{}\r\n", self.password).into_bytes());
        }
        if username_prompt && self.sent_user < 3 && !self.username.is_empty() {
            if self
                .last_user
                .map(|last| now.duration_since(last) < Duration::from_secs(3))
                .unwrap_or(false)
            {
                return None;
            }
            self.sent_user += 1;
            self.last_user = Some(now);
            return Some(format!("{}\r\n", self.username).into_bytes());
        }
        None
    }
}

/// 驱动一个 Telnet 会话：读数据（协商 / 输出）、写用户输入、处理 resize。
///
/// 返回断开原因（写给 `ssh://status/{id}` 的 `Disconnected`）。
#[allow(clippy::too_many_arguments)]
pub(crate) async fn drive(
    session_id: String,
    stream: TcpStream,
    mut cmd_rx: mpsc::UnboundedReceiver<TelnetCommand>,
    app: Option<AppHandle>,
    credentials: Option<LoginCredentials>,
    initial_size: (u16, u16),
    capture: Arc<TokioMutex<Option<Capture>>>,
) -> String {
    let event_name = format!("ssh://output/{}", session_id);
    let (mut reader, mut writer) = stream.into_split();
    let mut codec = Codec::new();
    let mut decoder = Utf8Carry::default();
    let mut buffer = [0u8; 8192];
    let mut size = initial_size;
    let mut ttype_enabled = false;
    let mut naws_enabled = false;
    let mut loginer = credentials.map(LoginAutomator::new);

    // 主动开一个 NAWS 协商（不等服务端先开口）：多数 Telnet 服务端会自己发
    // `DO NAWS`，但少数只在客户端先 `WILL` 后才回应，先发一次不违反协议。
    if writer.write_all(&crate::telnet::codec::negotiation_reply(WILL, OPT_NAWS)).await.is_err() {
        return "连接已关闭".into();
    }

    loop {
        tokio::select! {
            read = reader.read(&mut buffer) => {
                match read {
                    Ok(0) => {
                        log::info!("Telnet 会话 {} 被远端关闭", session_id);
                        break "远程关闭了连接".to_string();
                    }
                    Ok(n) => {
                        let mut events = Vec::new();
                        codec.feed(&buffer[..n], &mut events);
                        let mut reply: Vec<u8> = Vec::new();
                        for event in events {
                            match event {
                                CodecEvent::Data(bytes) => {
                                    let text = decoder.decode(&bytes).into_owned();
                                    if text.is_empty() {
                                        continue;
                                    }
                                    if let Some(app) = app.as_ref() {
                                        emit_event(app, &event_name, &text);
                                    }
                                    {
                                        let mut slot = capture.lock().await;
                                        match slot.as_ref() {
                                            Some(cap) => {
                                                if cap.tx.send(text.clone()).is_err() {
                                                    // 订阅者已经走了（命令结束/超时）
                                                    *slot = None;
                                                }
                                            }
                                            None => {}
                                        }
                                    }
                                    if let Some(loginer) = loginer.as_mut() {
                                        let clean = crate::telnet::codec::strip_ansi(&text);
                                        if let Some(bytes) = loginer.observe(&clean) {
                                            reply.extend_from_slice(&bytes);
                                        }
                                    }
                                }
                                CodecEvent::Negotiation { command, option } => {
                                    match (command, option) {
                                        (DO, OPT_TTYPE) => {
                                            ttype_enabled = true;
                                            reply.extend_from_slice(&crate::telnet::codec::negotiation_reply(WILL, option));
                                        }
                                        (DO, OPT_NAWS) => {
                                            naws_enabled = true;
                                            reply.extend_from_slice(&crate::telnet::codec::negotiation_reply(WILL, option));
                                            reply.extend_from_slice(&crate::telnet::codec::naws(size.0, size.1));
                                        }
                                        (DO, OPT_SGA) => {
                                            reply.extend_from_slice(&crate::telnet::codec::negotiation_reply(WILL, option));
                                        }
                                        (DO, _) => {
                                            reply.extend_from_slice(&crate::telnet::codec::negotiation_reply(WONT, option));
                                        }
                                        (WILL, OPT_ECHO) | (WILL, OPT_SGA) | (WILL, OPT_BINARY) => {
                                            reply.extend_from_slice(&crate::telnet::codec::negotiation_reply(DO, option));
                                        }
                                        (WILL, _) => {
                                            reply.extend_from_slice(&crate::telnet::codec::negotiation_reply(DONT, option));
                                        }
                                        // WONT / DONT：对端拒绝，不需要回应
                                        _ => {}
                                    }
                                }
                                CodecEvent::Subnegotiation { option, payload } => {
                                    if option == OPT_TTYPE && payload.first() == Some(&TTYPE_SEND) && ttype_enabled {
                                        reply.extend_from_slice(&crate::telnet::codec::ttype_is(TERM_TYPE));
                                    }
                                    // NAWS 的子协商是服务端回报，不需要客户端处理
                                }
                            }
                        }
                        if !reply.is_empty() {
                            if let Err(e) = writer.write_all(&reply).await {
                                log::warn!("Telnet 会话 {} 写协议应答失败: {}", session_id, e);
                                break format!("网络写入失败: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        log::warn!("Telnet 会话 {} 读取失败: {}", session_id, e);
                        break format!("网络读取失败: {}", e);
                    }
                }
            }

            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(TelnetCommand::Input(data)) => {
                        if writer.write_all(&data).await.is_err() {
                            break "连接已关闭".to_string();
                        }
                    }
                    Some(TelnetCommand::Resize { cols, rows }) => {
                        size = (cols, rows);
                        if naws_enabled {
                            let payload = crate::telnet::codec::naws(cols, rows);
                            if writer.write_all(&payload).await.is_err() {
                                break "连接已关闭".to_string();
                            }
                        }
                    }
                    Some(TelnetCommand::Disconnect) => {
                        log::info!("Telnet 会话 {} 主动断开", session_id);
                        // 照着 IAC 退出习惯先发一个 DM（不可靠也无害），真正的
                        // 断开由关闭 TCP 完成。
                        let _ = writer.write_all(&[crate::telnet::codec::IAC]).await;
                        break "已断开连接".to_string();
                    }
                    None => break "会话已释放".to_string(),
                }
            }
        }
    }
}

/// 供驱动启动前取初始尺寸（目前固定 80x24，与 SSH PTY 一致）。
pub(crate) fn default_size() -> (u16, u16) {
    (DEFAULT_COLS, DEFAULT_ROWS)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// 读到 `needle` 出现为止，返回累计内容（超时即判失败）。
    async fn read_until(stream: &mut TcpStream, needle: &[u8]) -> Vec<u8> {
        let mut acc = Vec::new();
        let mut buf = [0u8; 256];
        loop {
            let n = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buf))
                .await
                .expect("等待对端写出超时")
                .expect("读取失败");
            assert!(n > 0, "对端提前关闭");
            acc.extend_from_slice(&buf[..n]);
            if acc.windows(needle.len()).any(|w| w == needle) {
                return acc;
            }
        }
    }

    /// 一条真实 TCP 回环上的完整握手：协商应答 → 自动登录 → 输出事件 → 断开收尾。
    #[tokio::test]
    async fn negotiates_auto_logs_in_and_streams_output() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let server = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            // 客户端一连上就发 WILL NAWS
            let mut buf = [0u8; 64];
            let n = sock.read(&mut buf).await.unwrap();
            assert_eq!(&buf[..n], &[crate::telnet::codec::IAC, WILL, OPT_NAWS]);

            sock.write_all(&[crate::telnet::codec::IAC, DO, OPT_TTYPE])
                .await
                .unwrap();
            sock.write_all(&[crate::telnet::codec::IAC, DO, OPT_NAWS])
                .await
                .unwrap();
            sock.write_all(&[crate::telnet::codec::IAC, DO, OPT_SGA])
                .await
                .unwrap();
            sock.write_all(&[crate::telnet::codec::IAC, DO, 99])
                .await
                .unwrap();
            sock.write_all(b"login: ").await.unwrap();

            // 应答里应包含：WILL TTYPE、WILL NAWS + NAWS 子协商、WILL SGA、
            // 对未支持选项的 WONT，以及自动填写的用户名。
            let reply = read_until(&mut sock, b"admin\r\n").await;
            assert!(reply.windows(3).any(|w| w == [crate::telnet::codec::IAC, WILL, OPT_TTYPE]));
            assert!(reply.windows(3).any(|w| w == [crate::telnet::codec::IAC, WILL, OPT_SGA]));
            assert!(reply.windows(3).any(|w| w == [crate::telnet::codec::IAC, WONT, 99]));

            // TTYPE 子协商：客户端应回报终端类型
            sock.write_all(&[
                crate::telnet::codec::IAC,
                250,
                OPT_TTYPE,
                TTYPE_SEND,
                crate::telnet::codec::IAC,
                240,
            ])
            .await
            .unwrap();
            let ttype = read_until(&mut sock, b"XTERM-256COLOR").await;
            assert!(ttype.windows("XTERM-256COLOR".len()).any(|w| w == b"XTERM-256COLOR"));

            // 密码提示 → 自动填写密码；随后输出应出现在事件流里
            sock.write_all(b"Password: ").await.unwrap();
            read_until(&mut sock, b"s3cret\r\n").await;
            sock.write_all(b"Welcome to Telnet\r\n").await.unwrap();
            sock.write_all(&[crate::telnet::codec::IAC, crate::telnet::codec::IAC])
                .await
                .unwrap();
            // 注意：真实的 Telnet 服务端在数据里碰到 0xFF 必须用 `IAC IAC` 转义，
            // 否则会被客户端当成命令前缀吃掉（这里按协议写法构造，顺便验证转义还原）。
            sock.write_all(b"escaped: ").await.unwrap();
            sock.write_all(&[crate::telnet::codec::IAC, crate::telnet::codec::IAC])
                .await
                .unwrap();
            sock.write_all(b" ok\r\n").await.unwrap();
            sock.shutdown().await.ok();
        });

        let stream = open_tcp("127.0.0.1", addr.port()).await.unwrap();
        let (cmd_tx, cmd_rx) = mpsc::unbounded_channel();
        let session = TelnetSession::new(
            "t1".into(),
            "127.0.0.1".into(),
            addr.port(),
            "admin".into(),
            None,
            1,
            cmd_tx,
        );
        let mut output_rx = session.subscribe("test").await;

        let driver = tokio::spawn(drive(
            "t1".into(),
            stream,
            cmd_rx,
            None,
            Some(LoginCredentials {
                username: "admin".into(),
                password: "s3cret".into(),
            }),
            default_size(),
            session.capture.clone(),
        ));

        // 输出流里应出现欢迎语；转义还原出的 0xFF 不是合法 UTF-8，按 lossy 变成替换符
        let mut seen = String::new();
        loop {
            match tokio::time::timeout(Duration::from_secs(5), output_rx.recv()).await {
                Ok(Some(text)) => {
                    seen.push_str(&text);
                    if seen.contains("\u{fffd} ok") {
                        break;
                    }
                }
                Ok(None) => panic!("输出通道提前关闭, seen={seen:?}"),
                Err(_) => panic!("等待输出超时, seen={seen:?}"),
            }
        }
        assert!(seen.contains("Welcome to Telnet"));

        let reason = driver.await.unwrap();
        assert!(reason.contains("远程关闭"), "断开原因: {reason}");
        server.await.unwrap();
    }
}
