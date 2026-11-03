import { useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import { readBusyWork, useBusyWork, useIsBusy } from '@/hooks/useBusyWork';
import { getErrorMessage } from '@/lib/errors';
import { busyConsequences, busyItems, isBusy } from '@/lib/quitGuard';

/** 清单最多列几条；多出来的折成一句「另有 N 项」，别把对话框撑成一页。 */
const MAX_LISTED = 4;

/** 托盘「退出 SakiShell」事件：Rust 侧托盘菜单点击后广播，本组件统一处理退出确认。 */
const TRAY_QUIT_EVENT = 'sakishell://quit';

/**
 * 退出确认（桌面）+ 关闭驻留后台。
 *
 * **关闭主窗口（自定义标题栏 × / Alt+F4 / 任务栏关闭）一律进后台**：拦截默认的
 * 关窗（销毁窗口 = 退出进程），改为隐藏窗口驻留系统托盘。此时无论有没有任务在跑
 * 都不再询问 —— 后台运行本来就不中断 Agent 任务 / 后台作业 / 传输。
 *
 * **真正的「退出」只有一条路：托盘菜单「退出 SakiShell」**。Rust 侧广播
 * {@link TRAY_QUIT_EVENT} 到这里，如果还有任务在跑（`lib/quitGuard` 的口径，三张表
 * 的汇总），先把窗口带回来弹确认框问一句；空闲则直接 `destroy()` 退出。
 *
 * 这是个 **manager**：它不拥有任何任务，只把「关闭 / 退出意图」与「忙碌清单」接在
 * 一起，判定全部在 `lib/quitGuard`，这里只负责拦截时机与对话框。
 *
 * 确认后用 `destroy()` 强制关闭 —— 走 `close()` 会再次触发 `CloseRequested`，把自己
 * 拦在门口（进后台而不是退出）。
 *
 * 对话框开着时点了窗口关闭：视作放弃退出，对话框就地关掉、窗口进后台。
 * 对话框开着期间任务全跑完了：就地改口成「可以放心退出了」，而不是对着一份
 * 过期的清单问「确定要中断吗」。
 *
 * 订阅分两层：常驻的这一层只订阅一个布尔（`useIsBusy`，任务进度 / 传输字节数
 * 每个 tick 的更新不会唤醒它）；要列明细的 {@link QuitDialogBody} 只在对话框打开
 * 期间才挂载，明细订阅也就只在那时存在。
 *
 * **版式必须与应用里其他确认框同款**（对照 `HostKeyMismatchModal`）：`Modal` 自带的
 * 标题栏、`p-4 space-y-4` 的正文、`text-sm` 文字、右下「ghost 取消 + danger 确认」。
 * 试过圆形图标 + 大标题 + 带分隔线的内嵌清单卡片，结果在一众朴素的弹窗里格外突兀、
 * 被判定为更丑 —— 别再往里加图标、卡片、分隔线之类的装饰；清单就是几行纯文字。
 */
export default function QuitGuard() {
  const [open, setOpen] = useState(false);
  const [quitting, setQuitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useIsBusy();

  useEffect(() => {
    let disposed = false;
    const cleanups: (() => void)[] = [];

    // 关闭主窗口：一律拦截默认关窗，隐藏窗口驻留后台。
    // 有任务在跑也不再询问 —— 后台运行不中断任务；退出只走托盘菜单（下方监听）。
    void getCurrentWindow()
      .onCloseRequested((event) => {
        event.preventDefault();
        // 退出确认框正开着时点关闭 = 放弃退出，直接进后台。
        setOpen(false);
        setError(null);
        void getCurrentWindow().hide();
      })
      .then((fn) => {
        if (disposed) fn();
        else cleanups.push(fn);
      });

    // 托盘「退出 SakiShell」：忙碌时把窗口带回来弹确认，空闲直接销毁退出。
    // 与关闭路径共享同一份 busy 口径（lib/quitGuard）。
    void listen(TRAY_QUIT_EVENT, () => {
      if (isBusy(readBusyWork())) {
        void getCurrentWindow().show();
        setError(null);
        setOpen(true);
      } else {
        void getCurrentWindow().destroy();
      }
    }).then((fn) => {
      if (disposed) fn();
      else cleanups.push(fn);
    });

    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
    };
  }, []);

  const drained = open && !busy;

  const cancel = () => {
    if (quitting) return;
    setOpen(false);
    setError(null);
  };

  const quit = async () => {
    setQuitting(true);
    setError(null);
    try {
      await getCurrentWindow().destroy();
    } catch (e) {
      setQuitting(false);
      setError(getErrorMessage(e));
    }
  };

  return (
    <Modal open={open} onClose={cancel} size="sm" title={drained ? '任务都已结束' : '还有任务在运行'}>
      <div className="p-4 space-y-4" data-testid="quit-guard">
        <QuitDialogBody drained={drained} />

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          {/* 默认焦点给「继续使用」：回车 / 误触都落在安全的一侧 */}
          <Button variant="ghost" onClick={cancel} disabled={quitting} autoFocus>
            {drained ? '取消' : '继续使用'}
          </Button>
          <Button
            variant={drained ? 'primary' : 'danger'}
            onClick={() => void quit()}
            loading={quitting}
          >
            {drained ? '退出' : '仍然退出'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** 对话框正文：忙碌清单与后果（纯文字）。只在对话框挂载期间订阅明细。 */
function QuitDialogBody({ drained }: { drained: boolean }) {
  const work = useBusyWork();
  // 清单回落到空的那一刻（任务跑完了 / 关闭动画还在淡出）内容不能跟着空掉，
  // 否则会闪出一份空清单 —— 留一份最近一次非空的快照。
  const lastBusy = useRef(work);
  if (isBusy(work)) lastBusy.current = work;

  if (drained) {
    return <p className="text-sm text-zinc-300">刚才的任务已经跑完，现在可以放心退出了。</p>;
  }

  const view = isBusy(work) ? work : lastBusy.current;
  const items = busyItems(view);
  const listed = items.slice(0, MAX_LISTED);
  return (
    <>
      <p className="text-sm text-zinc-300">现在退出会中断以下任务：</p>
      <ul className="space-y-1.5" data-testid="quit-guard-items">
        {listed.map((item) => (
          <li key={item.key} className="flex items-baseline gap-3 text-sm">
            <span className="w-8 flex-shrink-0 text-xs text-zinc-500">{item.kind}</span>
            <span className="min-w-0 flex-1 truncate text-zinc-200" title={item.text}>
              {item.text}
            </span>
            {item.note && <span className="flex-shrink-0 text-xs text-amber-300">{item.note}</span>}
          </li>
        ))}
        {items.length > listed.length && (
          <li className="pl-11 text-xs text-zinc-500">另有 {items.length - listed.length} 项</li>
        )}
      </ul>
      <div className="space-y-1">
        {busyConsequences(view).map((line) => (
          <p key={line} className="text-sm text-zinc-500">
            {line}
          </p>
        ))}
      </div>
    </>
  );
}
