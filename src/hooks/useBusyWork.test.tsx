// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentTask, JobInfo } from '@/lib/types';
import { useTaskStore } from '@/stores/taskStore';
import { useJobStore } from '@/stores/jobStore';
import { useTransferStore, type StoredTransferItem } from '@/stores/transferStore';
import { readBusyWork, useIsBusy } from './useBusyWork';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const task = (status: AgentTask['status']): AgentTask => ({
  id: 'a',
  sessionId: 's1',
  conversationId: 'c1',
  prompt: 'p',
  mode: 'agent' as AgentTask['mode'],
  status,
  createdAt: '2026-01-01T00:00:00.000Z',
});
const job = (status: JobInfo['status']): JobInfo => ({
  jobId: 'j',
  sessionId: 's1',
  taskId: null,
  description: 'd',
  command: 'c',
  status,
  ownerConversationId: null,
  detail: null,
  startedAtMillis: 0,
  finishedAtMillis: null,
  totalOutputBytes: 0,
});
const transfer = (written: number, status: StoredTransferItem['status'] = 'active'): StoredTransferItem => ({
  id: 't',
  kind: 'upload',
  sessionId: 's1',
  fileName: 'f',
  localPath: '/l',
  remotePath: '/r',
  written,
  total: 100,
  statusText: '',
  createdAt: 0,
  status,
});

let host: HTMLDivElement;
let root: Root;
let renders: number;
let lastBusy: boolean;

function Probe() {
  renders += 1;
  lastBusy = useIsBusy();
  return null;
}

beforeEach(async () => {
  renders = 0;
  useTaskStore.setState({ tasks: {}, activeTaskId: null });
  useJobStore.setState({ jobs: {} });
  useTransferStore.setState({ items: {}, order: [] });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('useIsBusy：给常驻组件订阅的布尔', () => {
  it('三类里任何一类开始 / 结束，布尔随之翻转', async () => {
    expect(lastBusy).toBe(false);
    await act(async () => useTaskStore.setState({ tasks: { a: task('executing') } }));
    expect(lastBusy).toBe(true);
    await act(async () => useTaskStore.setState({ tasks: { a: task('completed') } }));
    expect(lastBusy).toBe(false);

    await act(async () => useJobStore.setState({ jobs: { j: job('running') } }));
    expect(lastBusy).toBe(true);
    await act(async () => useJobStore.setState({ jobs: { j: job('interrupted') } }));
    expect(lastBusy).toBe(false);

    await act(async () => useTransferStore.setState({ items: { t: transfer(0) } }));
    expect(lastBusy).toBe(true);
    await act(async () => useTransferStore.setState({ items: { t: transfer(100, 'done') } }));
    expect(lastBusy).toBe(false);
  });

  it('忙着的时候任务进度 / 传输字节数每个 tick 都在变，不会唤醒订阅者', async () => {
    await act(async () =>
      useTaskStore.setState({ tasks: { a: task('executing') } }),
    );
    await act(async () => useTransferStore.setState({ items: { t: transfer(1) } }));
    const settled = renders;
    for (let written = 2; written <= 50; written += 1) {
      await act(async () => useTransferStore.setState({ items: { t: transfer(written) } }));
    }
    await act(async () =>
      useTaskStore.setState({ tasks: { a: { ...task('executing'), prompt: 'changed' } } }),
    );
    expect(renders).toBe(settled);
  });
});

describe('readBusyWork：事件回调里读此刻的值', () => {
  it('不依赖渲染，直接读三张表', async () => {
    expect(readBusyWork().tasks).toHaveLength(0);
    await act(async () => {
      useTaskStore.setState({ tasks: { a: task('waiting_approval') } });
      useJobStore.setState({ jobs: { j: job('running') } });
    });
    const work = readBusyWork();
    expect(work.tasks).toHaveLength(1);
    expect(work.jobs).toHaveLength(1);
    expect(work.transfers).toHaveLength(0);
  });
});
