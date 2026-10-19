//! 元数据 SFTP 会话的复用（`SshManager::with_shared_sftp` 的底座）。
//!
//! ## 为什么
//!
//! 文件管理器每一次导航（`list_dir`、树展开、`mkdir`、`rename`、删除、`stat`）
//! 过去都要**现开一条 SFTP 通道**：开通道 → 请求 `sftp` 子系统 → SFTP `init`，三个
//! 往返之后才发出真正的第一个请求。RTT 100 ms 的服务器上，每次点开目录白等约
//! 300 ms。同一条 SSH 连接上缓存一条「元数据 SFTP 会话」，这三个往返只付一次。
//!
//! ## 范围（刻意收窄）
//!
//! - **只给短小的元数据操作用**。上传 / 下载 / 读写文件正文仍然各自独占一条通道
//!   （[`SshManager::open_sftp`]）：大传输和取消语义不能挤占元数据请求的队伍。
//! - **每个 [`SshConnection`] 一个槽位**，槽位随连接一起生灭：重连是新的
//!   `SshConnection`，天然是新的空槽，不需要任何「代数」记账。
//! - `russh_sftp` 按请求 id 多路复用，同一条会话上可以并发多个请求。
//!
//! ## 失效与恢复
//!
//! 缓存的会话可能在我们不知情时死掉（对端关了子系统通道、空闲回收竞态）。判据只
//! 有两条，都以 `russh_sftp` 的**实际行为**为准（有测试钉住，升级依赖时会先红）：
//!
//! - 请求**发出之前**就失败（通道早已关闭，错误 `session closed`）：任何操作都可以
//!   安全地换一条新会话重试一次——对端根本没收到过这个请求；
//! - 请求发出后失败（超时 / I/O）：结果未知，**不重试**（`rename`、`mkdir` 可能已经
//!   生效），但缓存要丢掉，下一次操作会重建。服务器对某个请求的正常拒绝（权限不足、
//!   不存在……）不影响会话，缓存照旧。
//!
//! ## 占用
//!
//! 每个 SFTP 会话在服务器上是一个 `sftp-server` 进程 + 一个通道名额（sshd 默认
//! `MaxSessions` 10）。所以空闲 [`IDLE_EVICTION`] 之后自动回收，不长期占着。

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use russh_sftp::client::error::Error as SftpError;
use russh_sftp::protocol::StatusCode;
use tokio::sync::Mutex;
use tokio::time::Instant;

/// 共享会话空闲多久后回收（释放服务器上的 `sftp-server` 进程与通道名额）。
pub(crate) const IDLE_EVICTION: Duration = Duration::from_secs(180);

struct Entry<T> {
    value: Arc<T>,
    /// 这份缓存的「世代」：失效与回收都按它认人，不会误伤别人刚建好的新会话。
    epoch: u64,
    last_used: Instant,
}

struct State<T> {
    entry: Option<Entry<T>>,
    /// 已发出的世代号（单调递增）。
    epochs: u64,
}

/// 一个可按需创建、可失效、可空闲回收的共享值槽位。
///
/// 泛型于被缓存的类型，只因为这样才能脱离真实 SFTP 服务器做单测；生产里恒为
/// `SftpSession`。
pub(crate) struct SharedSlot<T> {
    state: Mutex<State<T>>,
}

/// 从槽位借出的一份值。
pub(crate) struct Lease<T> {
    pub(crate) value: Arc<T>,
    pub(crate) epoch: u64,
    /// 这次调用刚创建了它（调用方据此给这一世代挂上空闲回收）。
    pub(crate) created: bool,
}

/// [`SharedSlot::reap`] 的结果。
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Reap {
    /// 这一世代已经不在槽位里（已回收、已失效或已被替换）：回收任务可以结束。
    Gone,
    /// 还没闲够，等这么久再看。
    Wait(Duration),
}

impl<T> SharedSlot<T> {
    pub(crate) fn new() -> Self {
        Self {
            state: Mutex::new(State {
                entry: None,
                epochs: 0,
            }),
        }
    }

    /// 取缓存值；没有就用 `create` 建一个并缓存。
    ///
    /// 创建期间持有槽位的锁：并发的第一批调用（面板挂载时列表与目录树同时请求）
    /// 会排队等同一次创建，而不是各开一条。创建失败不缓存，下次调用重新来过。
    pub(crate) async fn get_or_create<E, F, Fut>(&self, create: F) -> Result<Lease<T>, E>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, E>>,
    {
        let mut state = self.state.lock().await;
        if let Some(entry) = state.entry.as_mut() {
            entry.last_used = Instant::now();
            return Ok(Lease {
                value: entry.value.clone(),
                epoch: entry.epoch,
                created: false,
            });
        }
        let value = Arc::new(create().await?);
        state.epochs += 1;
        let epoch = state.epochs;
        state.entry = Some(Entry {
            value: value.clone(),
            epoch,
            last_used: Instant::now(),
        });
        Ok(Lease {
            value,
            epoch,
            created: true,
        })
    }

    /// 丢弃 `epoch` 这一世代的缓存。槽位里已经是更新的世代时什么也不做。
    pub(crate) async fn invalidate(&self, epoch: u64) {
        let mut state = self.state.lock().await;
        if state.entry.as_ref().is_some_and(|e| e.epoch == epoch) {
            state.entry = None;
        }
    }

    /// 空闲回收的一步：`epoch` 这一世代闲置超过 `idle` 就丢弃。
    pub(crate) async fn reap(&self, epoch: u64, idle: Duration) -> Reap {
        let mut state = self.state.lock().await;
        let Some(entry) = state.entry.as_ref().filter(|e| e.epoch == epoch) else {
            return Reap::Gone;
        };
        let idle_for = entry.last_used.elapsed();
        if idle_for >= idle {
            state.entry = None;
            Reap::Gone
        } else {
            Reap::Wait(idle - idle_for)
        }
    }
}

/// 请求在发出之前就失败了（共享会话的通道早已关闭）。对端没收到过这个请求，所以
/// 任何操作——包括 `rename` / `mkdir` 这类非幂等的——都可以安全地换新会话重试。
///
/// 依据 `russh_sftp` 在 `tx.is_closed()` 时返回的 `UnexpectedBehavior("session
/// closed")`；测试 `closed_session_fails_before_the_request_is_sent` 用真实会话钉住它。
pub(crate) fn failed_before_send(error: &SftpError) -> bool {
    matches!(error, SftpError::UnexpectedBehavior(message) if message == "session closed")
}

/// 这个错误说明**会话本身**已经不可用（而不是服务器对某个请求的正常拒绝）：缓存要
/// 丢掉，下一次操作重建。
pub(crate) fn session_unusable(error: &SftpError) -> bool {
    match error {
        // 服务器的正常答复：权限不足、不存在、不支持……会话好好的。
        // 只有两个「连接丢了」的伪状态码例外（规范规定只有客户端本地才会产生）。
        SftpError::Status(status) => matches!(
            status.status_code,
            StatusCode::NoConnection | StatusCode::ConnectionLost
        ),
        // 超过服务器声明的上限：请求本身的问题。
        SftpError::Limited(_) => false,
        // 超时 / I/O / 通道已关 / 协议错乱：会话不可信。
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use russh_sftp::client::SftpSession;
    use russh_sftp::protocol::Attrs;
    use russh_sftp::server;

    use super::*;

    // ── 槽位本身（用 u32 当被缓存的值，不依赖任何 SFTP 实现） ──────────────

    #[tokio::test]
    async fn concurrent_first_callers_share_a_single_creation() {
        let slot = Arc::new(SharedSlot::<u32>::new());
        let created = Arc::new(AtomicUsize::new(0));
        let mut tasks = Vec::new();
        for _ in 0..16 {
            let slot = slot.clone();
            let created = created.clone();
            tasks.push(tokio::spawn(async move {
                slot.get_or_create(|| async {
                    created.fetch_add(1, Ordering::SeqCst);
                    // 创建途中让出，给其余调用者机会（它们必须排队而不是各建一份）。
                    tokio::task::yield_now().await;
                    Ok::<_, ()>(7)
                })
                .await
                .unwrap()
            }));
        }
        let mut fresh = 0;
        for task in tasks {
            let lease = task.await.unwrap();
            assert_eq!(*lease.value, 7);
            fresh += usize::from(lease.created);
        }
        assert_eq!(
            created.load(Ordering::SeqCst),
            1,
            "并发的第一批调用只许创建一次"
        );
        assert_eq!(fresh, 1, "只有真正创建的那一次标记 created");
    }

    #[tokio::test]
    async fn later_calls_reuse_the_cached_value() {
        let slot = SharedSlot::<u32>::new();
        let first = slot
            .get_or_create(|| async { Ok::<_, ()>(1) })
            .await
            .unwrap();
        let second = slot
            .get_or_create(|| async { panic!("命中缓存时不许再创建") })
            .await
            .unwrap_or_else(|_: ()| unreachable!());
        assert!(first.created && !second.created);
        assert!(Arc::ptr_eq(&first.value, &second.value));
        assert_eq!(first.epoch, second.epoch);
    }

    #[tokio::test]
    async fn a_failed_creation_is_not_cached() {
        let slot = SharedSlot::<u32>::new();
        let failed = slot.get_or_create(|| async { Err::<u32, _>("boom") }).await;
        assert_eq!(failed.err(), Some("boom"));
        let ok = slot
            .get_or_create(|| async { Ok::<_, &str>(5) })
            .await
            .unwrap();
        assert!(ok.created, "失败不留痕迹，下一次重新创建");
    }

    #[tokio::test]
    async fn invalidate_only_drops_the_matching_epoch() {
        let slot = SharedSlot::<u32>::new();
        let old = slot
            .get_or_create(|| async { Ok::<_, ()>(1) })
            .await
            .unwrap();
        slot.invalidate(old.epoch).await;
        let new = slot
            .get_or_create(|| async { Ok::<_, ()>(2) })
            .await
            .unwrap();
        assert!(new.created);
        assert_ne!(old.epoch, new.epoch);

        // 持有旧世代的调用者迟到地上报失败：不能把别人刚建好的新会话弄丢。
        slot.invalidate(old.epoch).await;
        let again = slot
            .get_or_create(|| async { panic!("新世代应当还在") })
            .await
            .unwrap_or_else(|_: ()| unreachable!());
        assert!(Arc::ptr_eq(&new.value, &again.value));
    }

    #[tokio::test(start_paused = true)]
    async fn idle_entries_are_reaped_and_active_ones_are_kept() {
        let slot = SharedSlot::<u32>::new();
        let lease = slot
            .get_or_create(|| async { Ok::<_, ()>(1) })
            .await
            .unwrap();
        let idle = Duration::from_secs(60);

        tokio::time::advance(Duration::from_secs(40)).await;
        assert_eq!(
            slot.reap(lease.epoch, idle).await,
            Reap::Wait(Duration::from_secs(20))
        );

        // 期间被用过一次：闲置计时从头来。
        slot.get_or_create(|| async { panic!("不应重建") })
            .await
            .unwrap_or_else(|_: ()| unreachable!());
        tokio::time::advance(Duration::from_secs(40)).await;
        assert_eq!(
            slot.reap(lease.epoch, idle).await,
            Reap::Wait(Duration::from_secs(20))
        );

        tokio::time::advance(Duration::from_secs(20)).await;
        assert_eq!(slot.reap(lease.epoch, idle).await, Reap::Gone);
        let rebuilt = slot
            .get_or_create(|| async { Ok::<_, ()>(2) })
            .await
            .unwrap();
        assert!(rebuilt.created, "回收之后下一次使用会重建");
    }

    #[tokio::test(start_paused = true)]
    async fn a_reaper_of_a_replaced_epoch_stops_without_touching_the_new_one() {
        let slot = SharedSlot::<u32>::new();
        let old = slot
            .get_or_create(|| async { Ok::<_, ()>(1) })
            .await
            .unwrap();
        slot.invalidate(old.epoch).await;
        let new = slot
            .get_or_create(|| async { Ok::<_, ()>(2) })
            .await
            .unwrap();

        // 旧世代的回收任务醒来：槽位里已经是新世代，它该直接结束，而且不能把
        // 新世代带走（新世代有自己的回收任务）。
        tokio::time::advance(Duration::from_secs(50)).await;
        let idle = Duration::from_secs(60);
        assert_eq!(slot.reap(old.epoch, idle).await, Reap::Gone);
        assert_eq!(
            slot.reap(new.epoch, idle).await,
            Reap::Wait(Duration::from_secs(10))
        );
    }

    // ── 错误分类：用真实的 russh_sftp 会话钉住它的实际行为 ──────────────────

    /// 最小 SFTP 服务端：握手后对一切请求回「不支持」（服务器的正常拒绝）。
    struct Refuses;

    impl server::Handler for Refuses {
        type Error = StatusCode;

        fn unimplemented(&self) -> Self::Error {
            StatusCode::OpUnsupported
        }
    }

    /// 握手正常，但永远不回 `stat` 的服务端（模拟请求发出后连接卡死）。
    struct Stalls;

    impl server::Handler for Stalls {
        type Error = StatusCode;

        fn unimplemented(&self) -> Self::Error {
            StatusCode::OpUnsupported
        }

        fn stat(
            &mut self,
            _id: u32,
            _path: String,
        ) -> impl Future<Output = Result<Attrs, Self::Error>> + Send {
            async { std::future::pending().await }
        }
    }

    async fn connect<H>(handler: H) -> SftpSession
    where
        H: server::Handler + Send + 'static,
    {
        let (client_io, server_io) = tokio::io::duplex(64 * 1024);
        server::run(server_io, handler).await;
        SftpSession::new(client_io).await.expect("SFTP 握手")
    }

    #[tokio::test(start_paused = true)]
    async fn closed_session_fails_before_the_request_is_sent() {
        let sftp = connect(Refuses).await;
        sftp.close().await.unwrap();
        // 给读写任务一点时间收尾（暂停的时钟在全员空闲时自动推进）。
        tokio::time::sleep(Duration::from_millis(10)).await;

        let error = sftp.metadata("/").await.expect_err("会话已关闭");
        assert!(
            failed_before_send(&error),
            "russh_sftp 的「通道已关闭」错误变了，重试判据要跟着改：{error:?}"
        );
        assert!(session_unusable(&error));
    }

    #[tokio::test(start_paused = true)]
    async fn a_normal_refusal_keeps_the_session() {
        let sftp = connect(Refuses).await;
        let error = sftp.metadata("/").await.expect_err("服务端拒绝");
        assert!(matches!(error, SftpError::Status(_)), "{error:?}");
        assert!(!session_unusable(&error), "服务器的正常拒绝不该丢掉缓存");
        assert!(!failed_before_send(&error));
    }

    #[tokio::test(start_paused = true)]
    async fn a_request_that_times_out_drops_the_session_but_is_not_retried() {
        let sftp = connect(Stalls).await;
        sftp.set_timeout(1);
        let error = sftp.metadata("/x").await.expect_err("服务端不回应");
        assert!(matches!(error, SftpError::Timeout), "{error:?}");
        assert!(session_unusable(&error));
        assert!(
            !failed_before_send(&error),
            "请求已经发出去了，结果未知，不能重试（rename / mkdir 可能已生效）"
        );
    }

    #[test]
    fn local_connection_lost_statuses_are_unusable_but_refusals_are_not() {
        let status = |code| {
            SftpError::Status(russh_sftp::protocol::Status {
                id: 1,
                status_code: code,
                error_message: String::new(),
                language_tag: String::new(),
            })
        };
        assert!(session_unusable(&status(StatusCode::ConnectionLost)));
        assert!(session_unusable(&status(StatusCode::NoConnection)));
        assert!(!session_unusable(&status(StatusCode::PermissionDenied)));
        assert!(!session_unusable(&status(StatusCode::NoSuchFile)));
        assert!(!session_unusable(&SftpError::Limited("x".into())));
        assert!(session_unusable(&SftpError::IO("x".into())));
        assert!(session_unusable(&SftpError::UnexpectedPacket));
    }
}
