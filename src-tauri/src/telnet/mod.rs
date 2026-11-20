//! Telnet 支持（RFC 854 及 TTYPE / NAWS / SGA / ECHO 协商）。
//!
//! 设计目标：**不新建并行的会话体系**。Telnet 会话与 SSH 会话并排登记在
//! `SshManager` 里（`telnet` 那张表），`send_input` / `resize` / `disconnect` /
//! `list_sessions` 等对外方法同时看两张表，前端与 Agent 工具因此完全不用
//! 区分协议；只有在真正依赖 russh handle 的两处（exec 通道、SFTP）才分流：
//! - exec：走 [`exec::run`] 的「发命令 + 回显/哨兵」模拟；
//! - SFTP：明确拒绝（Telnet 没有文件传输子系统）。
//!
//! 子模块：
//! - [`codec`]：字节流 ↔ 协议事件（IAC 转义、协商、子协商、ANSI 清洗）；
//! - [`session`]：`TelnetSession` 与驱动任务（协商应答、输出事件、自动登录）；
//! - [`exec`]：Agent 命令的模拟执行与流式交付。

pub mod codec;
pub mod exec;
pub mod session;

pub use session::TelnetSession;
