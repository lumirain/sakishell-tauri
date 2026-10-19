// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentTask, JobInfo } from '@/lib/types';
import { useTaskStore } from '@/stores/taskStore';
import { useJobStore } from '@/stores/jobStore';
import { useTransferStore } from '@/stores/transferStore';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

type CloseHandler = (event: { preventDefault: () => void }) => void | Promise<void>;
const windowMock = vi.hoisted(() => ({
  handler: null as CloseHandler | null,
  unlisten: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (handler: CloseHandler) => {
      windowMock.handler = handler;
      return windowMock.unlisten;
    },
    destroy: windowMock.destroy,
  }),
}));

import QuitGuard from './QuitGuard';

const task = (id: string, status: AgentTask['status'], prompt = `prompt ${id}`): AgentTask => ({
  id,
  sessionId: 's1',
  conversationId: 'c1',
  prompt,
  mode: 'agent' as AgentTask['mode'],
  status,
  createdAt: '2026-01-01T00:00:00.000Z',
});
const job = (id: string, status: JobInfo['status'], description = `job ${id}`): JobInfo => ({
  jobId: id,
  sessionId: 's1',
  taskId: null,
  description,
  command: `cmd ${id}`,
  status,
  ownerConversationId: null,
  detail: null,
  startedAtMillis: 0,
  finishedAtMillis: null,
  totalOutputBytes: 0,
});

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  windowMock.handler = null;
  windowMock.unlisten.mockReset();
  windowMock.destroy.mockReset().mockResolvedValue(undefined);
  await seed(() => useTaskStore.setState({ tasks: {}, activeTaskId: null }));
  await seed(() => useJobStore.setState({ jobs: {} }));
  await seed(() => useTransferStore.setState({ items: {}, order: [] }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<QuitGuard />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

/** 改 store 要包在 act 里：QuitGuard 订阅了这几张表，组件会跟着重渲。 */
async function seed(fn: () => void) {
  await act(async () => {
    fn();
  });
}

/** 模拟用户点关闭：返回这次事件有没有被否决。 */
async function requestClose(): Promise<boolean> {
  let prevented = false;
  await act(async () => {
    await windowMock.handler!({ preventDefault: () => (prevented = true) });
  });
  return prevented;
}
const dialog = () => document.body.querySelector('[data-testid="quit-guard"]');
const button = (label: string) =>
  Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.trim() === label)!;

describe('QuitGuard：关闭窗口前的退出确认', () => {
  it('挂载时向窗口登记关闭拦截，卸载时撤掉', async () => {
    expect(windowMock.handler).not.toBeNull();
    await act(async () => root.unmount());
    expect(windowMock.unlisten).toHaveBeenCalled();
    root = createRoot(host); // 交给 afterEach 正常卸载
  });

  it('没有任务在跑：不拦，窗口照常关闭', async () => {
    expect(await requestClose()).toBe(false);
    expect(dialog()).toBeNull();
  });

  it('只有已结束的任务 / 作业 / 传输：同样不拦', async () => {
    await seed(() => useTaskStore.setState({ tasks: { a: task('a', 'completed') } }));
    await seed(() => useJobStore.setState({ jobs: { j: job('j', 'completed'), k: job('k', 'interrupted') } }));
    expect(await requestClose()).toBe(false);
    expect(dialog()).toBeNull();
  });

  it('有 Agent 任务在跑：拦下并询问，写明会中断什么', async () => {
    await seed(() => useTaskStore.setState({ tasks: { a: task('a', 'executing', '重启 nginx') } }));
    expect(await requestClose()).toBe(true);
    expect(dialog()).not.toBeNull();
    const text = dialog()!.textContent!;
    expect(document.body.textContent).toContain('还有任务在运行');
    expect(text).toContain('现在退出会中断以下任务');
    expect(text).toContain('重启 nginx');
    expect(text).toContain('Agent 任务会被中止');
    expect(windowMock.destroy).not.toHaveBeenCalled();
  });

  it('只有后台作业在跑：同样拦', async () => {
    await seed(() => useJobStore.setState({ jobs: { j: job('j', 'running', 'tail -f app.log') } }));
    expect(await requestClose()).toBe(true);
    expect(document.body.textContent).toContain('还有任务在运行');
    expect(dialog()!.textContent).toContain('tail -f app.log');
  });

  it('等待审批的任务也算在跑，并点明在等审批', async () => {
    await seed(() => useTaskStore.setState({ tasks: { a: task('a', 'waiting_approval') } }));
    expect(await requestClose()).toBe(true);
    expect(dialog()!.textContent).toContain('等待审批');
  });

  it('「继续使用」：关掉对话框，应用继续运行', async () => {
    await seed(() => useTaskStore.setState({ tasks: { a: task('a', 'executing') } }));
    await requestClose();
    await act(async () => button('继续使用').click());
    expect(windowMock.destroy).not.toHaveBeenCalled();
    // Modal 有退出动画：直接看关闭状态由 Modal 管，这里只确认没有退出
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(dialog()).toBeNull();
  });

  it('「仍然退出」：强制销毁窗口（走 destroy，不再触发一次关闭请求）', async () => {
    await seed(() => useTaskStore.setState({ tasks: { a: task('a', 'executing') } }));
    await requestClose();
    await act(async () => button('仍然退出').click());
    expect(windowMock.destroy).toHaveBeenCalledTimes(1);
  });

  it('销毁失败：不假装退出了，原地给出原因，可以再试', async () => {
    windowMock.destroy.mockRejectedValueOnce({ kind: 'Internal', message: '窗口句柄失效' });
    await seed(() => useTaskStore.setState({ tasks: { a: task('a', 'executing') } }));
    await requestClose();
    await act(async () => button('仍然退出').click());
    expect(dialog()!.textContent).toContain('窗口句柄失效');
    expect(button('仍然退出')).toBeDefined();
  });

  it('默认焦点在安全的一侧（继续使用）', async () => {
    await seed(() => useTaskStore.setState({ tasks: { a: task('a', 'executing') } }));
    await requestClose();
    expect(document.activeElement).toBe(button('继续使用'));
  });

  it('对话框开着时又点了关闭：仍然只有一个对话框', async () => {
    await seed(() => useTaskStore.setState({ tasks: { a: task('a', 'executing') } }));
    expect(await requestClose()).toBe(true);
    expect(await requestClose()).toBe(true);
    expect(document.body.querySelectorAll('[data-testid="quit-guard"]')).toHaveLength(1);
  });

  it('清单超过四条：只列前四条，其余折成「另有 N 项」', async () => {
    const tasks = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`t${i}`, task(`t${i}`, 'executing')]),
    );
    await seed(() => useTaskStore.setState({ tasks }));
    await requestClose();
    expect(document.body.querySelectorAll('[data-testid="quit-guard-items"] li')).toHaveLength(5);
    expect(dialog()!.textContent).toContain('另有 2 项');
  });

  it('对话框开着期间任务全跑完了：就地改口「可以放心退出了」，不再拿过期清单吓人', async () => {
    await seed(() => useTaskStore.setState({ tasks: { a: task('a', 'executing') } }));
    await requestClose();
    expect(dialog()!.textContent).toContain('现在退出会中断');
    await seed(() => useTaskStore.setState({ tasks: { a: task('a', 'completed') } }));
    const text = dialog()!.textContent!;
    expect(document.body.textContent).toContain('任务都已结束'); // 标题在 Modal 头部，不在 body 里
    expect(text).toContain('可以放心退出了');
    expect(text).not.toContain('现在退出会中断');
    expect(button('退出')).toBeDefined();
    await act(async () => button('退出').click());
    expect(windowMock.destroy).toHaveBeenCalledTimes(1);
  });
});
