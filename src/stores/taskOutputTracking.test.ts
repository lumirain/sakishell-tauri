import { describe, it, expect, beforeEach, vi } from 'vitest';
import { newTaskOutputEntry, useTaskStore } from '@/stores/taskStore';
import { useConversationStore } from '@/stores/conversationStore';
import { createDefaultStreamHandler } from '@/stores/storeStreamAdapter';
import type { ContextUsageEvent, ConversationUsage } from '@/lib/types';

vi.mock('@/lib/tauri', () => ({}));
vi.mock('@/stores/agentStreamManager', () => ({
  attachStreamListener: vi.fn(),
  attachPlanListener: vi.fn(),
  cleanupTaskListeners: vi.fn(),
}));

function usage(completionTokens: number): ConversationUsage {
  return { promptTokens: 0, completionTokens, totalTokens: completionTokens };
}

function contextEvent(completionTokens: number): ContextUsageEvent {
  return {
    type: 'contextUsage',
    promptTokens: 100,
    completionTokens,
    totalTokens: 100 + completionTokens,
    contextWindow: 0,
    usedTokens: 100,
    estimated: false,
    systemTokens: 1,
    toolsTokens: 1,
    messageTokens: 98,
  };
}

/** 状态条读的就是这个数：已结算 + 当前轮估算。 */
function shownOutput(conversationId: string): number {
  const e = useTaskStore.getState().taskOutputByConversation[conversationId];
  return e ? Math.round(e.settled + e.live) : 0;
}

describe('任务输出 token 计数', () => {
  beforeEach(() => {
    useTaskStore.setState({
      tasks: {},
      taskOutputByConversation: {},
      usageByConversation: {},
    });
    useConversationStore.setState({ conversations: {}, messages: {}, activeConversationId: null });
  });

  describe('newTaskOutputEntry（计数起点）', () => {
    it('事件值优先，落库兜底，都没有则为 0', () => {
      expect(newTaskOutputEntry('c').base).toBe(0);

      useConversationStore.setState({
        conversations: { c: { id: 'c', usage: usage(300) } as never },
      });
      expect(newTaskOutputEntry('c').base).toBe(300);

      useTaskStore.setState({ usageByConversation: { c: { usage: usage(500), windowTokens: 0 } } });
      expect(newTaskOutputEntry('c').base).toBe(500);
    });
  });

  describe('流事件累计', () => {
    it('没有条目（不是在跑的任务）时增量与用量事件都不留痕', () => {
      useTaskStore.getState().recordOutputDelta('c', 'hello world');
      useTaskStore.getState().recordContextUsage('c', contextEvent(50));
      expect(useTaskStore.getState().taskOutputByConversation.c).toBeUndefined();
    });

    it('流式增量先给估算，用量事件到达后换成精确值（减去任务起点）', () => {
      useTaskStore.setState({ taskOutputByConversation: { c: { base: 1000, settled: 0, live: 0 } } });

      useTaskStore.getState().recordOutputDelta('c', 'a'.repeat(40)); // 40 字符 ≈ 10 token
      expect(shownOutput('c')).toBe(10);

      useTaskStore.getState().recordContextUsage('c', contextEvent(1000 + 12));
      expect(shownOutput('c')).toBe(12);
    });

    it('provider 没报输出用量时，估算并入已结算，数字不回落', () => {
      useTaskStore.setState({ taskOutputByConversation: { c: { base: 200, settled: 0, live: 0 } } });

      useTaskStore.getState().recordOutputDelta('c', 'a'.repeat(80)); // ≈ 20
      useTaskStore.getState().recordContextUsage('c', contextEvent(200)); // 增量 0 = 没报
      expect(shownOutput('c')).toBe(20);

      useTaskStore.getState().recordOutputDelta('c', 'a'.repeat(40)); // 再 ≈ 10
      expect(shownOutput('c')).toBe(30);
    });
  });

  describe('子 agent', () => {
    const registerSub = (status: string) =>
      createDefaultStreamHandler().registerSubTask({
        id: 'sub-task',
        sessionId: 's1',
        conversationId: 'sub-conv',
        prompt: 'p',
        mode: 'plan',
        status,
        parentTaskId: 'parent-task',
      });

    it('登记运行中的子任务就建好自己的计数条目：增量与用量事件都进子会话的桶', () => {
      registerSub('planning');
      expect(useTaskStore.getState().taskOutputByConversation['sub-conv']).toEqual({
        base: 0,
        settled: 0,
        live: 0,
      });

      useTaskStore.getState().recordOutputDelta('sub-conv', 'a'.repeat(40));
      expect(shownOutput('sub-conv')).toBe(10);

      useTaskStore.getState().recordContextUsage('sub-conv', contextEvent(37));
      expect(shownOutput('sub-conv')).toBe(37);
    });

    it('子 agent 的输出不会串进别的会话的桶', () => {
      useTaskStore.setState({ taskOutputByConversation: { parent: { base: 0, settled: 5, live: 0 } } });
      registerSub('planning');
      useTaskStore.getState().recordOutputDelta('sub-conv', 'a'.repeat(40));
      expect(shownOutput('parent')).toBe(5);
    });

    it('已是终态的子任务（重启恢复兜底登记）不建条目', () => {
      registerSub('completed');
      expect(useTaskStore.getState().taskOutputByConversation['sub-conv']).toBeUndefined();
    });
  });
});
