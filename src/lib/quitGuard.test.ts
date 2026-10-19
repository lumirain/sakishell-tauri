import { describe, expect, it } from 'vitest';
import type { AgentTask, JobInfo } from '@/lib/types';
import type { StoredTransferItem } from '@/stores/transferStore';
import {
  busyConsequences,
  busyCount,
  busyItems,
  collectBusyWork,
  isBusy,
  NO_BUSY_WORK,
} from './quitGuard';

const task = (id: string, status: AgentTask['status'], over: Partial<AgentTask> = {}): AgentTask => ({
  id,
  sessionId: 's1',
  conversationId: 'c1',
  prompt: `prompt ${id}`,
  mode: 'agent' as AgentTask['mode'],
  status,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});
const job = (id: string, status: JobInfo['status']): JobInfo => ({
  jobId: id,
  sessionId: 's1',
  taskId: null,
  description: `job ${id}`,
  command: `cmd ${id}`,
  status,
  ownerConversationId: null,
  detail: null,
  startedAtMillis: 0,
  finishedAtMillis: null,
  totalOutputBytes: 0,
});
const transfer = (id: string, status: StoredTransferItem['status']): StoredTransferItem => ({
  id,
  kind: 'upload',
  sessionId: 's1',
  fileName: `${id}.bin`,
  localPath: `/l/${id}`,
  remotePath: `/r/${id}`,
  written: 0,
  total: 10,
  statusText: '',
  createdAt: 0,
  status,
});
const map = <T extends { id?: string; jobId?: string }>(items: T[]) =>
  Object.fromEntries(items.map((i) => [i.id ?? i.jobId!, i]));

describe('collectBusyWork：什么算「退出会被打断」', () => {
  it('Agent 任务：规划 / 执行 / 等审批都算；已结束的不算', () => {
    const work = collectBusyWork({
      tasks: map([
        task('a', 'planning'),
        task('b', 'executing'),
        task('c', 'waiting_approval'),
        task('d', 'completed'),
        task('e', 'failed'),
        task('f', 'cancelled'),
      ]),
      jobs: {},
      transfers: {},
    });
    expect(work.tasks.map((t) => t.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('重启恢复的占位任务（sessionId 为空）不算真任务', () => {
    const work = collectBusyWork({
      tasks: map([task('ghost', 'executing', { sessionId: '' })]),
      jobs: {},
      transfers: {},
    });
    expect(work.tasks).toHaveLength(0);
  });

  it('后台作业：只数 running（interrupted 是上次退出留下的，早就断了）', () => {
    const work = collectBusyWork({
      tasks: {},
      jobs: map([
        job('j1', 'running'),
        job('j2', 'completed'),
        job('j3', 'killed'),
        job('j4', 'failed'),
        job('j5', 'interrupted'),
      ]),
      transfers: {},
    });
    expect(work.jobs.map((j) => j.jobId)).toEqual(['j1']);
  });

  it('传输：排队中 / 传输中算；已结束和正在取消的不算', () => {
    const work = collectBusyWork({
      tasks: {},
      jobs: {},
      transfers: map([
        transfer('t1', 'queued'),
        transfer('t2', 'active'),
        transfer('t3', 'cancelling'),
        transfer('t4', 'done'),
        transfer('t5', 'error'),
        transfer('t6', 'cancelled'),
      ]),
    });
    expect(work.transfers.map((t) => t.id).sort()).toEqual(['t1', 't2']);
  });

  it('什么都没有：不忙', () => {
    const work = collectBusyWork({ tasks: {}, jobs: {}, transfers: {} });
    expect(isBusy(work)).toBe(false);
    expect(busyCount(work)).toBe(0);
    expect(isBusy(NO_BUSY_WORK)).toBe(false);
  });

  it('任何一类有就算忙', () => {
    expect(isBusy(collectBusyWork({ tasks: map([task('a', 'executing')]), jobs: {}, transfers: {} }))).toBe(true);
    expect(isBusy(collectBusyWork({ tasks: {}, jobs: map([job('j', 'running')]), transfers: {} }))).toBe(true);
    expect(isBusy(collectBusyWork({ tasks: {}, jobs: {}, transfers: map([transfer('t', 'active')]) }))).toBe(true);
  });
});

describe('文案', () => {
  const all = collectBusyWork({
    tasks: map([task('a', 'executing'), task('b', 'waiting_approval')]),
    jobs: map([job('j', 'running')]),
    transfers: map([transfer('t', 'queued')]),
  });

  it('后果也只写有的类别，一类一句', () => {
    expect(busyConsequences(all)).toHaveLength(3);
    expect(
      busyConsequences(collectBusyWork({ tasks: {}, jobs: {}, transfers: map([transfer('t', 'active')]) })),
    ).toEqual(['没传完的文件会中断。']);
  });

  it('条目：等待审批 / 排队中会点明；长描述只取第一行并截断', () => {
    const items = busyItems(all);
    expect(items.find((i) => i.key === 'task:b')!.note).toBe('等待审批');
    expect(items.find((i) => i.key === 'task:a')!.note).toBeNull();
    expect(items.find((i) => i.key === 'transfer:t')!.note).toBe('排队中');

    const long = collectBusyWork({
      tasks: map([task('x', 'executing', { prompt: `${'很长'.repeat(40)}\n第二行` })]),
      jobs: {},
      transfers: {},
    });
    const text = busyItems(long)[0].text;
    expect(text.endsWith('…')).toBe(true);
    expect(text).not.toContain('第二行');
  });

  it('作业没有描述时回落到命令；任务没有描述时有兜底', () => {
    const j = { ...job('j', 'running'), description: '' };
    expect(busyItems(collectBusyWork({ tasks: {}, jobs: map([j]), transfers: {} }))[0].text).toBe('cmd j');
    const t = task('a', 'executing', { prompt: '  ' });
    expect(busyItems(collectBusyWork({ tasks: map([t]), jobs: {}, transfers: {} }))[0].text).toBe('（无描述）');
  });
});
