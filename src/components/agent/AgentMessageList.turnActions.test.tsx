// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage, AgentTask } from '@/lib/types';
import { useConversationStore } from '@/stores/conversationStore';
import { useTaskStore } from '@/stores/taskStore';
import { useTurnFoldStore } from '@/stores/turnFoldStore';
import AgentMessageList from './AgentMessageList';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('./AgentMessage', () => ({
  default: ({ message }: { message: AgentMessage }) => <p>{message.content}</p>,
}));
vi.mock('./ToolCallCard', () => ({
  default: ({ message }: { message: AgentMessage }) => <p>tool:{message.toolResult?.toolName}</p>,
}));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) =>
    selector({ settings: { foldCompletedTurns: false } }),
}));

const ts = (sec: number) => new Date(Date.parse('2026-01-01T00:00:00.000Z') + sec * 1000).toISOString();
const msg = (id: string, role: AgentMessage['role'], content: string, sec: number): AgentMessage => ({
  id,
  role,
  content,
  timestamp: ts(sec),
});
const toolMsg = (id: string, sec: number): AgentMessage => ({
  ...msg(id, 'tool', '', sec),
  toolResult: { toolName: 'bash', summary: '', result: 'ok', success: true, blocked: false, toolCallId: id },
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useConversationStore.setState(useConversationStore.getInitialState(), true);
  useTaskStore.setState(useTaskStore.getInitialState(), true);
  useTurnFoldStore.setState({ expanded: {} });
  host = document.createElement('div');
  const viewport = document.createElement('div');
  viewport.className = 'overflow-y-auto';
  viewport.append(host);
  document.body.append(viewport);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.parentElement!.remove();
});

const finished: AgentMessage[] = [
  msg('u1', 'user', '第一个问题', 0),
  msg('a1', 'assistant', '第一个回答', 5),
  msg('u2', 'user', '第二个问题', 10),
  msg('a2', 'assistant', '我来查', 12),
  toolMsg('t1', 13),
  msg('a3', 'assistant', '查完了', 75),
];

/** `onCopyText: null` = 显式不传（默认参数会吞掉 undefined，所以用 null 表达「没有」）。 */
async function render(messages: AgentMessage[], onCopyText: ((t: string) => void) | null = vi.fn()) {
  await act(async () => {
    root.render(
      <AgentMessageList messages={messages} conversationId="c1" onCopyText={onCopyText ?? undefined} />,
    );
  });
}
const barsUnder = () =>
  Array.from(host.querySelectorAll('[data-testid="turn-actions"]')).map(
    (bar) => bar.closest('[data-message-id]')!.getAttribute('data-message-id'),
  );

describe('消息列表里的任务收尾条', () => {
  it('每个已结束的任务，在它最后一段话下面挂一条（中间的工具卡下面不挂）', async () => {
    await render(finished);
    expect(barsUnder()).toEqual(['a1', 'a3']);
  });

  it('带着用时：a3 所在任务 10s → 75s 共 1 分 5 秒', async () => {
    await render(finished);
    const bars = host.querySelectorAll('[data-testid="turn-actions"]');
    expect(bars[0].textContent).toContain('用时 5 秒');
    expect(bars[1].textContent).toContain('用时 1 分 5 秒');
  });

  it('所在消息行是 hover 范围（group/turn），hover 整条消息就能唤出，不必瞄准小按钮', async () => {
    await render(finished);
    const row = host.querySelector('[data-message-id="a3"]')!;
    expect(row.className).toContain('group/turn');
    expect(host.querySelector('[data-message-id="a2"]')!.className).not.toContain('group/turn');
  });

  it('任务还在跑：尾回合不挂条，之前已结束的任务照挂', async () => {
    const task: AgentTask = {
      id: 'task1',
      sessionId: 's1',
      conversationId: 'c1',
      prompt: '第二个问题',
      mode: 'agent' as AgentTask['mode'],
      status: 'executing',
      createdAt: ts(10),
    };
    useTaskStore.setState({ tasks: { task1: task } });
    await render(finished);
    expect(barsUnder()).toEqual(['a1']);
  });

  it('没传 onCopyText（拿不到剪贴板）：整个列表都不挂条', async () => {
    await render(finished, null);
    expect(barsUnder()).toEqual([]);
  });

  it('任务在工具中途被停止（最后一段话之后跟着工具）：那个任务不挂条', async () => {
    await render([...finished.slice(0, 3), finished[3], toolMsg('t9', 14)]);
    expect(barsUnder()).toEqual(['a1']);
  });
});
