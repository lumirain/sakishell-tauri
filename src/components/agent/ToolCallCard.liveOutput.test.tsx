// @vitest-environment jsdom
/**
 * 执行中实时输出的出入场回归测试。
 *
 * 背景：输出区原先是条件渲染——第一行输出一到，一整块（最高 120px）瞬间顶出来，
 * 命令一结束又靠 `hidden` 瞬间消失，卡片下面的内容上下各跳一次。命令快的时候两次
 * 跳动挨在一起，用户看到的就是「突然弹起来，又突然没了」。
 *
 * 本测试锁定：
 *  1. 快命令（观望时间内就结束）输出区从头到尾不挂载——没有可抽动的东西；
 *  2. 慢命令连续有输出满观望时间后才挂载，且走进场动画类；
 *  3. 命令结束后不当场拔掉：先走退场动画（类名切换、aria-hidden），播完才卸载；
 *  4. 退场期间内容定格在最后一帧实时输出，不会中途换成最终结果文本；
 *  5. 「模型审批中…」同属瞬态块，同样不对快审批闪一下。
 *
 * jsdom 不会自己派发 animationend：卸载的兜底路径（useAnimatedPresence 的超时）和
 * 「动画播完」路径（Simulate.animationEnd）分别覆盖。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import type { AgentMessage } from '@/lib/types';
import ToolCallCard from '@/components/agent/ToolCallCard';
import { TRANSIENT_REVEAL_DELAY_MS } from '@/components/agent/TransientReveal';

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector?: (s: unknown) => unknown) =>
    selector?.({ settings: {} }) ?? { settings: {} },
}));

vi.mock('@/stores/conversationStore', () => ({
  useConversationStore: (selector?: (s: unknown) => unknown) => {
    const state = { openSubConversation: vi.fn() };
    return selector?.(state) ?? state;
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  vi.useRealTimers();
});

function bash(
  result: string,
  isExecuting: boolean,
  modelApproval?: AgentMessage['modelApproval'],
): AgentMessage {
  return {
    id: 'bash-1',
    role: 'tool',
    content: '',
    timestamp: '2026-01-01T00:00:00Z',
    isExecuting,
    modelApproval,
    toolResult: {
      toolName: 'bash',
      summary: 'bash',
      result,
      success: true,
      blocked: false,
      arguments: { command: 'make build' },
    },
  };
}

function mount(message: AgentMessage): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<ToolCallCard message={message} />);
  });
  return container;
}

function rerender(message: AgentMessage) {
  act(() => {
    root?.render(<ToolCallCard message={message} />);
  });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

const panel = () => container?.querySelector<HTMLElement>('.transient-reveal') ?? null;

describe('执行中实时输出的出入场', () => {
  it('快命令：观望时间内就结束，输出区从头到尾不挂载', () => {
    mount(bash('ok\n', true));
    expect(panel()).toBeNull();

    advance(TRANSIENT_REVEAL_DELAY_MS - 50);
    expect(panel()).toBeNull();

    rerender(bash('ok\n', false));
    advance(TRANSIENT_REVEAL_DELAY_MS * 2);
    expect(panel()).toBeNull();
    expect(container?.textContent).not.toContain('ok');
  });

  it('没有输出就没有输出区，输出来了才开始计观望时间', () => {
    mount(bash('', true));
    advance(TRANSIENT_REVEAL_DELAY_MS * 3);
    expect(panel()).toBeNull();

    rerender(bash('first\n', true));
    expect(panel()).toBeNull();
    advance(TRANSIENT_REVEAL_DELAY_MS);
    expect(panel()?.className).toContain('transient-reveal-enter');
    expect(panel()?.textContent).toContain('first');
  });

  it('慢命令：连续有输出满观望时间后挂载并走进场动画', () => {
    mount(bash('building…\n', true));
    expect(panel()).toBeNull();

    advance(TRANSIENT_REVEAL_DELAY_MS);
    const el = panel();
    expect(el).not.toBeNull();
    expect(el?.className).toContain('transient-reveal-enter');
    expect(el?.getAttribute('aria-hidden')).toBeNull();
    expect(el?.textContent).toContain('building…');
    // 旧写法的残留：结束后靠 hidden 类瞬间拔掉
    expect(container?.querySelector('.hidden')).toBeNull();
  });

  it('命令结束：先走退场动画，播完才卸载，不当场消失', () => {
    mount(bash('step 1\n', true));
    advance(TRANSIENT_REVEAL_DELAY_MS);
    expect(panel()).not.toBeNull();

    rerender(bash('step 1\nstep 2\ndone', false));
    const el = panel();
    expect(el).not.toBeNull();
    expect(el?.className).toContain('transient-reveal-exit');
    expect(el?.getAttribute('aria-hidden')).toBe('true');

    // 动画播完（真实浏览器会派发 animationend；jsdom 里 React 监听的是带前缀的事件名，
    // 手动 dispatchEvent 触达不到，用 Simulate 直接触发 React 的 onAnimationEnd）
    act(() => {
      Simulate.animationEnd(el!);
    });
    expect(panel()).toBeNull();
  });

  it('动画事件没来也会兜底卸载（减少动态效果 / 不可见祖先）', () => {
    mount(bash('step 1\n', true));
    advance(TRANSIENT_REVEAL_DELAY_MS);
    rerender(bash('step 1\ndone', false));
    expect(panel()).not.toBeNull();

    advance(1000);
    expect(panel()).toBeNull();
  });

  it('退场期间内容定格在最后一帧实时输出，不换成最终结果', () => {
    mount(bash('live line\n', true));
    advance(TRANSIENT_REVEAL_DELAY_MS);
    expect(panel()?.textContent).toContain('live line');

    rerender(bash('FINAL SUMMARY: exit code 0', false));
    expect(panel()?.textContent).toContain('live line');
    expect(panel()?.textContent).not.toContain('FINAL SUMMARY');
  });

  it('命令结束后卡片折叠，不再留任何输出', () => {
    mount(bash('x\n', true));
    advance(TRANSIENT_REVEAL_DELAY_MS);
    rerender(bash('x\ndone', false));
    advance(1000);
    expect(panel()).toBeNull();
    expect(container?.querySelector('pre')).toBeNull();
  });
});

describe('「模型审批中…」瞬态行', () => {
  it('快审批不闪；慢审批观望后进场，结束后退场', () => {
    mount(bash('', true, { status: 'checking' }));
    expect(container?.textContent).not.toContain('模型审批中');

    advance(TRANSIENT_REVEAL_DELAY_MS);
    expect(container?.textContent).toContain('模型审批中');
    expect(panel()?.className).toContain('transient-reveal-enter');

    rerender(bash('', true, { status: 'done', decision: 'approve' }));
    expect(panel()?.className).toContain('transient-reveal-exit');
    advance(1000);
    expect(container?.textContent).not.toContain('模型审批中');
  });

  it('审批在观望时间内就完成：从头到尾不出现', () => {
    mount(bash('', true, { status: 'checking' }));
    advance(TRANSIENT_REVEAL_DELAY_MS - 100);
    rerender(bash('', true, { status: 'done', decision: 'approve' }));
    advance(TRANSIENT_REVEAL_DELAY_MS * 2);
    expect(container?.textContent).not.toContain('模型审批中');
    expect(panel()).toBeNull();
  });
});
