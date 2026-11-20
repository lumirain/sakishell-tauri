//! Telnet 上的「伪 exec」：发一条命令，靠回显与哨兵切出输出。
//!
//! Telnet 只有一条裸终端流，没有 exec 通道，也就没有退出码、没有 stdout/stderr
//! 分离。这里的做法是**在同一个 shell 里串一条可解析的命令**：
//!
//! ```text
//! printf '\n<MARK>\n'; { <command>
//! } 2>&1; printf '\n<MARK>:%d\n' "$?"
//! ```
//!
//! - 第一行 `<MARK>` 之前的一切（含 shell 回显的这行输入本身）全部丢弃；
//! - 中间是命令的真实输出（stderr 已并到 stdout）；
//! - 末尾 `<MARK>:<code>` 带回退出码，同时作为结束信号。
//!
//! 局限（写在这里，别让调用方误以为是真 exec）：
//! - 需要远端是一个 POSIX shell（bash/sh/busybox 之类）；路由器 CLI、
//!   网络设备那种非 shell 的 Telnet 服务在 Agent 执行路径上会拿不到输出；
//! - 输出按**行**交付：没有换行的进度条要等到下一个换行或结束才出现；
//! - 交互终端与 Agent 命令共用同一条流，命令执行期间用户的键盘输入会混进
//!   输出（与「手动在终端敲命令」的观感一致，属于 Telnet 的固有限制）。

use std::time::Duration;

use tauri::AppHandle;
use tokio::sync::watch;

use crate::command_exec::executor::{deliver, ExecExit, ExecOutcome, OutputSink};
use crate::command_exec::CancelReason;
use crate::error::AppError;

use super::session::TelnetSession;

/// 单条命令的默认上限（与 SSH 侧 `exec_command` 的 120 秒一致，由调用方传入）。
pub(crate) async fn run<O: OutputSink>(
    session: &TelnetSession,
    command: &str,
    timeout: Duration,
    streaming: Option<(&AppHandle, &str, &str)>,
    mut output: O,
    cancel: Option<&watch::Receiver<CancelReason>>,
) -> Result<ExecOutcome<O::Output>, AppError> {
    let marker = format!("__SakishellTelnet{}__", uuid::Uuid::new_v4().simple());
    let mut rx = session.subscribe(&marker).await;

    let script = build_script(&marker, command);
    if let Err(e) = session.send_input(script.as_bytes()) {
        session.unsubscribe(&marker).await;
        return Err(e);
    }

    let mut filter = LineFilter::new(&marker);
    let deadline = tokio::time::sleep(timeout);
    tokio::pin!(deadline);

    loop {
        tokio::select! {
            biased;
            // 取消优先：交回已经拿到的部分输出（与 SSH 侧的 Cancelled 同义）
            _ = async {
                match cancel {
                    Some(rx) => rx.clone().changed().await,
                    None => std::future::pending().await,
                }
            } => {
                session.unsubscribe(&marker).await;
                let reason = cancel.map(|rx| *rx.borrow()).unwrap_or(CancelReason::User);
                filter.finish_tail(&mut |chunk| deliver(&mut output, chunk, streaming));
                return Ok(ExecOutcome::Cancelled { reason });
            }
            chunk = rx.recv() => {
                match chunk {
                    Some(text) => {
                        filter.feed(&text, &mut |piece| deliver(&mut output, piece, streaming));
                        if filter.finished {
                            let code = filter.code;
                            session.unsubscribe(&marker).await;
                            return Ok(ExecOutcome::Completed {
                                output: output.finish(),
                                exit: ExecExit {
                                    code: code.map(|c| c.max(0) as u32),
                                    signal: None,
                                },
                            });
                        }
                    }
                    None => {
                        // 驱动侧关闭或连接断开：订阅者永远等不到结束标记了
                        session.unsubscribe(&marker).await;
                        return Err(AppError::Ssh("Telnet 连接已断开".into()));
                    }
                }
            }
            _ = &mut deadline => {
                session.unsubscribe(&marker).await;
                filter.finish_tail(&mut |chunk| deliver(&mut output, chunk, streaming));
                return Ok(ExecOutcome::TimedOut { output: output.finish() });
            }
        }
    }
}

/// 拼出「标记 ↔ 命令 ↔ 退出码」那一条 shell 脚本。
fn build_script(marker: &str, command: &str) -> String {
    // 末尾的 `\r\n` 是真正按下回车；`{{ ...\n}}` 是 bash 的复合命令，
    // 命令里有换行也能被当成一整块执行。
    format!(
        "printf '\\n{marker}\\n'; {{ {command}\n}} 2>&1; printf '\\n{marker}:%d\\n' \"$?\"\r\n"
    )
}

/// 行过滤器：丢掉标记之前的回显、标记之后的收尾，只交付中间的输出。
#[derive(Debug)]
struct LineFilter {
    marker: String,
    buf: String,
    started: bool,
    finished: bool,
    code: Option<i32>,
}

impl LineFilter {
    fn new(marker: &str) -> Self {
        Self {
            marker: marker.to_string(),
            buf: String::new(),
            started: false,
            finished: false,
            code: None,
        }
    }

    fn feed(&mut self, chunk: &str, emit: &mut dyn FnMut(&str)) {
        if self.finished {
            return;
        }
        // 先把 \r 处理掉：`\r\n` 归一成 `\n`，单独的 `\r`（进度条回退）直接去掉。
        // 逐行交付的语义下保留裸 \r 只会让输出出现「复写」的假象。
        let normalized = chunk.replace("\r\n", "\n").replace('\r', "");
        self.buf.push_str(&normalized);

        while let Some(pos) = self.buf.find('\n') {
            let line = self.buf[..pos].to_string();
            self.buf.drain(..=pos);

            if !self.started {
                if line.trim() == self.marker {
                    self.started = true;
                }
                continue;
            }
            if self.finished {
                continue;
            }
            let prefix = format!("{}:", self.marker);
            if let Some(rest) = line.trim().strip_prefix(&prefix) {
                if let Ok(code) = rest.trim().parse::<i32>() {
                    self.finished = true;
                    self.code = Some(code);
                    continue;
                }
            }
            emit(&format!("{}\n", line));
        }
    }

    /// 结束（超时 / 取消）时把还没等到换行的尾巴也交出去。
    fn finish_tail(&mut self, emit: &mut dyn FnMut(&str)) {
        if self.finished || !self.started {
            return;
        }
        let tail = std::mem::take(&mut self.buf);
        if !tail.trim().is_empty() {
            emit(&format!("{}\n", tail));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_echo_markers_and_returns_code() {
        let mut filter = LineFilter::new("MARK");
        let mut out = String::new();
        filter
            .feed(
                "printf '\\nMARK\\n'; { uname -a\r\n} 2>&1; printf '\\nMARK:%d\\n' \"$?\"\r\nMARK\r\nLinux box 6.1\r\nMARK:0\r\n",
                &mut |s| out.push_str(s),
            );
        assert!(filter.finished);
        assert_eq!(filter.code, Some(0));
        assert_eq!(out, "Linux box 6.1\n");
    }

    #[test]
    fn splits_across_chunks_on_line_boundaries() {
        let mut filter = LineFilter::new("MARK");
        let mut out = String::new();
        filter.feed("noise\r\nMARK\r\npar", &mut |s| out.push_str(s));
        assert_eq!(out, "");
        filter.feed("tial line\nMARK:2\n", &mut |s| out.push_str(s));
        assert_eq!(out, "partial line\n");
        assert_eq!(filter.code, Some(2));
        assert!(filter.finished);
    }

    #[test]
    fn non_zero_exit_code_is_reported() {
        let mut filter = LineFilter::new("M");
        filter.feed("M\nM:127\n", &mut |_| {});
        assert_eq!(filter.code, Some(127));
    }
}
