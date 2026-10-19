import { useMemo } from 'react';
import { useTaskStore } from '@/stores/taskStore';
import { useJobStore } from '@/stores/jobStore';
import { useTransferStore } from '@/stores/transferStore';
import { getActiveRunningTasks } from '@/stores/agentStatusSelectors';
import {
  collectBusyWork,
  isBusyJob,
  isBusyTransfer,
  type BusyWork,
} from '@/lib/quitGuard';

/** 此刻的「忙碌清单」（命令式读取：事件回调里要的是**当下**的值，不是上次渲染的）。 */
export function readBusyWork(): BusyWork {
  return collectBusyWork({
    tasks: useTaskStore.getState().tasks,
    jobs: useJobStore.getState().jobs,
    transfers: useTransferStore.getState().items,
  });
}

/**
 * 只关心「忙不忙」（常驻组件用，比如标题栏的更新药丸）。
 *
 * 选择器直接返回布尔：zustand 按值比较，任务进度、传输字节数这类**每个 tick 都在
 * 变**的更新不会唤醒订阅者，只有「忙 ↔ 不忙」翻转的那一刻才重渲。订阅整张表再在
 * 组件里派生，会让标题栏跟着每次传输进度刷新一遍。
 */
export function useIsBusy(): boolean {
  const task = useTaskStore((s) => getActiveRunningTasks(s.tasks).length > 0);
  const job = useJobStore((s) => Object.values(s.jobs).some(isBusyJob));
  const transfer = useTransferStore((s) => Object.values(s.items).some(isBusyTransfer));
  return task || job || transfer;
}

/**
 * 订阅「退出会中断什么」的**明细**：Agent 任务 / 后台作业 / 传输变化时重算。
 *
 * 只给真的要列清单的组件用（退出确认框，且只在它打开期间挂着）；只要布尔就用
 * {@link useIsBusy}。订阅的是三张表本身（引用稳定），派生在 `useMemo` 里做 —— 选择器
 * 若直接返回派生数组，每次都是新引用，每个 store 更新都会重渲一遍。
 */
export function useBusyWork(): BusyWork {
  const tasks = useTaskStore((s) => s.tasks);
  const jobs = useJobStore((s) => s.jobs);
  const transfers = useTransferStore((s) => s.items);
  return useMemo(() => collectBusyWork({ tasks, jobs, transfers }), [tasks, jobs, transfers]);
}
