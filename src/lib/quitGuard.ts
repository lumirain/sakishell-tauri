/**
 * quitGuard.ts —— 「现在退出会中断什么」的判定与文案（纯函数，不碰 store）。
 *
 * 退出前要不要拦、拦的时候怎么跟用户说，都以这里的 {@link BusyWork} 为准：
 * 退出确认框（`QuitGuard`）与安装更新前的确认（`UpdatePill`）共用同一份定义，
 * 否则两处对「还有任务」的口径迟早漂开（更新那边曾经只看当前激活的那一个任务）。
 *
 * 口径与界面上用户看得见的数字一致：Agent 任务沿用「任务与作业中心」胶囊的
 * 口径（`getActiveRunningTasks`，含等待审批；排除重启恢复的占位任务），作业只数
 * `running`（`interrupted` 是上次退出留下的，已经断了，不欠「现在退出」的账）。
 *
 * 新增一类「退出会丢的东西」时：在 {@link BusyWork} 加一个字段，并在
 * {@link collectBusyWork} / {@link busyItems} / {@link busyConsequences} 里各补
 * 一处 —— 三处都是穷举同一份字段，漏哪一处，确认框就会少说一件事。
 */

import type { AgentTask, JobInfo } from '@/lib/types';
import { getActiveRunningTasks } from '@/stores/agentStatusSelectors';
import { isFinished, type StoredTransferItem } from '@/stores/transferStore';

export interface BusyWork {
  /** 运行中（含等待审批）的 Agent 任务。 */
  tasks: AgentTask[];
  /** 仍在运行的后台作业。 */
  jobs: JobInfo[];
  /** 排队中 / 传输中的 SFTP 传输（含 Agent 发起的）。 */
  transfers: StoredTransferItem[];
}

export const NO_BUSY_WORK: BusyWork = Object.freeze({ tasks: [], jobs: [], transfers: [] }) as BusyWork;

/**
 * 逐类的「算不算在忙」谓词。`collectBusyWork`（要明细）与 `useIsBusy`（只要一个
 * 布尔，给标题栏这类常驻组件订阅用）都经过它们，口径只有这一份。
 */
export function isBusyJob(job: JobInfo): boolean {
  return job.status === 'running';
}

/** `cancelling` 已经在收尾（用户点了取消），不再算「会被退出打断的」。 */
export function isBusyTransfer(item: StoredTransferItem): boolean {
  return !isFinished(item.status) && item.status !== 'cancelling';
}

export function collectBusyWork(sources: {
  tasks: Record<string, AgentTask>;
  jobs: Record<string, JobInfo>;
  transfers: Record<string, StoredTransferItem>;
}): BusyWork {
  return {
    tasks: getActiveRunningTasks(sources.tasks),
    jobs: Object.values(sources.jobs).filter(isBusyJob),
    transfers: Object.values(sources.transfers).filter(isBusyTransfer),
  };
}

export function busyCount(work: BusyWork): number {
  return work.tasks.length + work.jobs.length + work.transfers.length;
}

export function isBusy(work: BusyWork): boolean {
  return busyCount(work) > 0;
}

/** 「退出会怎样」：每类各一句，只写有的那几类。 */
export function busyConsequences(work: BusyWork): string[] {
  const lines: string[] = [];
  if (work.tasks.length > 0) lines.push('Agent 任务会被中止，已完成的步骤保留在对话里。');
  if (work.jobs.length > 0) {
    lines.push('后台作业会断开连接，远端进程不一定会停。');
  }
  if (work.transfers.length > 0) lines.push('没传完的文件会中断。');
  return lines;
}

/** 列给用户看的具体条目（每条一行）。 */
export interface BusyItem {
  key: string;
  kind: '任务' | '作业' | '传输';
  text: string;
  /** 附加状态（如「等待审批」），没有为 `null`。 */
  note: string | null;
}

function firstLine(text: string, max = 48): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

export function busyItems(work: BusyWork): BusyItem[] {
  return [
    ...work.tasks.map((t) => ({
      key: `task:${t.id}`,
      kind: '任务' as const,
      text: firstLine(t.prompt) || '（无描述）',
      note: t.status === 'waiting_approval' ? '等待审批' : null,
    })),
    ...work.jobs.map((j) => ({
      key: `job:${j.jobId}`,
      kind: '作业' as const,
      text: firstLine(j.description || j.command) || j.jobId,
      note: null,
    })),
    ...work.transfers.map((t) => ({
      key: `transfer:${t.id}`,
      kind: '传输' as const,
      text: firstLine(t.fileName) || t.remotePath,
      note: t.status === 'queued' ? '排队中' : null,
    })),
  ];
}
