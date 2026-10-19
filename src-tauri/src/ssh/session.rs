use std::sync::Arc;

use russh::client;
use russh::{Channel, ChannelMsg};
use tauri::AppHandle;
use tokio::sync::mpsc;

use super::client::Client;
use crate::emit_event;
use crate::utf8_carry::Utf8Carry;

/// Commands sent to the per-session driver task.
pub(crate) enum SessionCommand {
    Input(Vec<u8>),
    Resize { cols: u32, rows: u32 },
    Disconnect,
}

/// An active SSH session. The session is owned by a single driver task that
/// services both incoming channel data and outgoing user commands. The manager
/// communicates with the driver task via an mpsc channel — this avoids any
/// locking on the russh `Channel`, which cannot be used concurrently for both
/// reads and writes.
pub struct SshConnection {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub connection_id: Option<String>,
    /// Monotonic generation counter — incremented each time a new connection
    /// is created for the same session_id (reconnect). Used by cleanup to
    /// prevent a stale driver task from removing a newer connection.
    pub generation: u64,
    /// Sender to the per-session driver task (for the interactive shell).
    pub(crate) cmd_tx: mpsc::UnboundedSender<SessionCommand>,
    /// Shared russh Handle — used to open additional exec channels for
    /// Agent tool calls (separate from the interactive PTY channel).
    pub(crate) handle: Arc<tokio::sync::Mutex<client::Handle<Client>>>,
    /// Jump host handle kept alive for the lifetime of the target session so
    /// the direct-tcpip tunnel does not close. `None` for direct connections.
    #[allow(dead_code)]
    pub(crate) jump_handle: Option<Arc<tokio::sync::Mutex<client::Handle<Client>>>>,
    /// 元数据 SFTP 会话的共享槽位（`list_dir` / `mkdir` / `rename` 等短操作复用，
    /// 省掉每次现开通道的三个往返）。随连接一起生灭，见 `sftp_shared`。
    pub(crate) sftp_meta: super::sftp_shared::SharedSlot<russh_sftp::client::SftpSession>,
}

/// 把一块终端输出发给前端；空块（解码器把半截字符暂存时）不发事件。
fn emit_output(app: &AppHandle, event_name: &str, text: &str) {
    if !text.is_empty() {
        emit_event(app, event_name, text);
    }
}

/// Drive a single SSH session: multiplex incoming channel messages
/// and outgoing user commands on the same task. This guarantees there is
/// exactly one owner of the channel and avoids any locking deadlocks.
///
/// Returns a user-facing disconnect reason for the status event.
///
/// 泛型于 handler 只为测试：`handle` 在这里只用来收尾断开，生产里恒为
/// `Handle<Client>`，测试可以塞一个不依赖 known_hosts 的最小 handler。
pub(crate) async fn drive_session<H: client::Handler>(
    session_id: String,
    mut channel: Channel<russh::client::Msg>,
    handle: Arc<tokio::sync::Mutex<client::Handle<H>>>,
    mut cmd_rx: mpsc::UnboundedReceiver<SessionCommand>,
    app: AppHandle,
) -> String {
    let event_name = format!("ssh://output/{}", session_id);
    // 终端输出按字节流逐包到达，一个汉字（3 字节）可能被包边界切成两半：
    // 逐包 lossy 解码会把它变成两个 U+FFFD，所以半截前缀要留到下一包再解。
    // stdout / stderr 各持一份，互不粘连。
    let mut stdout_decoder = Utf8Carry::default();
    let mut stderr_decoder = Utf8Carry::default();
    let reason = loop {
        tokio::select! {
            // Incoming data from the SSH server
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => {
                        emit_output(&app, &event_name, &stdout_decoder.decode(&data));
                    }
                    Some(ChannelMsg::ExtendedData { data, .. }) => {
                        // stderr — forward to same stream
                        emit_output(&app, &event_name, &stderr_decoder.decode(&data));
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => {
                        log::info!("SSH session {} closed by remote", session_id);
                        break "远程关闭了连接".to_string();
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        log::info!(
                            "SSH session {} shell exited with status {}",
                            session_id,
                            exit_status
                        );
                    }
                    Some(_) => { /* ignore other messages */ }
                    None => {
                        // Channel ended
                        break "连接已关闭".to_string();
                    }
                }
            }

            // Outgoing commands from the user
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(SessionCommand::Input(data)) => {
                        if let Err(e) = channel.data(&data[..]).await {
                            log::warn!("写入 SSH 通道失败: {:?}", e);
                            break format_io_reason(&e);
                        }
                    }
                    Some(SessionCommand::Resize { cols, rows }) => {
                        if let Err(e) = channel.window_change(cols, rows, 0, 0).await {
                            log::warn!("调整窗口大小失败: {:?}", e);
                        }
                    }
                    Some(SessionCommand::Disconnect) => {
                        log::info!("SSH session {} disconnect requested", session_id);
                        let _ = channel.eof().await;
                        let _ = channel.close().await;
                        break "已主动断开连接".to_string();
                    }
                    None => {
                        // All senders dropped — connection was force-removed
                        log::info!("SSH session {} command channel closed", session_id);
                        break "已主动断开连接".to_string();
                    }
                }
            }
        }
    };
    // 流结束时解码器里若还留着半截前缀，按 lossy 交出去而不是吞掉。
    emit_output(&app, &event_name, &stdout_decoder.flush());
    emit_output(&app, &event_name, &stderr_decoder.flush());
    // Best-effort: close the underlying SSH session
    let _ = handle
        .lock()
        .await
        .disconnect(russh::Disconnect::ByApplication, "client disconnect", "")
        .await;
    reason
}

fn format_io_reason(err: &impl std::fmt::Display) -> String {
    let msg = err.to_string();
    let lower = msg.to_lowercase();
    if lower.contains("connection reset")
        || lower.contains("broken pipe")
        || lower.contains("forcibly closed")
        || lower.contains("connection aborted")
    {
        "网络连接已中断".to_string()
    } else if lower.contains("timed out") || lower.contains("timeout") {
        "连接超时".to_string()
    } else if lower.contains("not connected") || lower.contains("disconnected") {
        "连接已断开".to_string()
    } else if msg.chars().count() > 120 {
        format!("{}…", msg.chars().take(120).collect::<String>())
    } else {
        msg
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use parking_lot::Mutex;
    use tauri::Listener;

    use super::*;
    use crate::ssh::test_support::test_channels;

    enum Packet {
        Stdout(Vec<u8>),
        Stderr(Vec<u8>),
    }

    /// 起一个无窗口的 Tauri 宿主，把 `packets` 逐个作为 SSH 数据包喂给真实的
    /// `drive_session`，返回前端会依次收到的终端输出事件和断连原因。
    fn drive_with_packets(packets: Vec<Packet>) -> (Vec<String>, String) {
        let app = tauri::Builder::default()
            .any_thread()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("windowless Tauri host");
        let events: Arc<Mutex<Vec<String>>> = Arc::default();
        let captured = events.clone();
        app.listen("ssh://output/terminal-test", move |event| {
            captured.lock().push(
                serde_json::from_str::<String>(event.payload()).expect("终端输出事件是一个字符串"),
            );
        });
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        let reason = runtime.block_on(async {
            let (client, channel, peer) = test_channels().await;
            let (_cmd_tx, cmd_rx) = mpsc::unbounded_channel();
            let driver = tokio::spawn(drive_session(
                "terminal-test".to_string(),
                channel,
                Arc::new(tokio::sync::Mutex::new(client)),
                cmd_rx,
                app.handle().clone(),
            ));
            for packet in packets {
                match packet {
                    Packet::Stdout(bytes) => peer.data(&bytes[..]).await.unwrap(),
                    Packet::Stderr(bytes) => peer.extended_data(1, &bytes[..]).await.unwrap(),
                }
            }
            peer.eof().await.unwrap();
            driver.await.unwrap()
        });
        let received = events.lock().clone();
        (received, reason)
    }

    /// 回归：中文输出被 SSH 数据包边界切在汉字中间时，前端收到的必须是完整的字，
    /// 而不是两个 U+FFFD。
    #[test]
    fn a_chinese_character_split_across_packets_reaches_the_frontend_whole() {
        let you = "你".as_bytes();
        let (events, reason) = drive_with_packets(vec![
            Packet::Stdout([b"a".as_slice(), &you[..1]].concat()),
            Packet::Stdout([&you[1..], b"b".as_slice()].concat()),
        ]);
        assert_eq!(reason, "远程关闭了连接");
        assert_eq!(events.concat(), "a你b");
        assert!(
            events.iter().all(|chunk| !chunk.is_empty()),
            "半截字符暂存期间不应向前端发空事件：{events:?}"
        );
    }

    /// stdout 与 stderr 交错时，各自的半截字符不能粘到对方身上。
    #[test]
    fn split_characters_on_stdout_and_stderr_do_not_mix() {
        let you = "你".as_bytes();
        let hao = "好".as_bytes();
        let (events, _) = drive_with_packets(vec![
            Packet::Stdout(you[..2].to_vec()),
            Packet::Stderr(hao[..1].to_vec()),
            Packet::Stdout(you[2..].to_vec()),
            Packet::Stderr(hao[1..].to_vec()),
        ]);
        assert_eq!(events.concat(), "你好");
    }

    /// 连接在多字节字符中间结束：残缺尾巴按 lossy 交出去，不被吞掉。
    #[test]
    fn a_session_ending_mid_character_flushes_the_tail() {
        let (events, _) = drive_with_packets(vec![Packet::Stdout("你".as_bytes()[..2].to_vec())]);
        assert_eq!(events.concat(), "\u{fffd}");
    }
}
