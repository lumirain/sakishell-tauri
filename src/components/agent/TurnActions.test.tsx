// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@/lib/types';
import type { TurnFooter } from '@/lib/turnTranscript';
import { resetBackHandlers } from '@/mobile/backHandler';
import TurnActions from './TurnActions';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const turn: AgentMessage[] = [
  { id: 'u1', role: 'user', content: '看看磁盘', timestamp: '2026-01-01T00:00:00.000Z' },
  {
    id: 't1',
    role: 'tool',
    content: '',
    timestamp: '2026-01-01T00:00:02.000Z',
    toolResult: {
      toolName: 'bash',
      summary: '',
      result: 'Filesystem 40G',
      success: true,
      blocked: false,
      arguments: { command: 'df -h' },
      toolCallId: 'c1',
    },
  },
  {
    id: 'a1',
    role: 'assistant',
    content: '还剩 40G',
    timestamp: '2026-01-01T00:00:09.000Z',
    reasoningContent: '不该被复制的思考',
  },
];
const footer = (elapsedMs: number | null = 134_000): TurnFooter => ({
  messageId: 'a1',
  turn,
  elapsedMs,
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetBackHandlers();
});

async function render(props: Partial<React.ComponentProps<typeof TurnActions>> = {}) {
  const onCopyText = props.onCopyText ?? vi.fn();
  await act(async () => {
    root.render(<TurnActions footer={footer()} onCopyText={onCopyText} {...props} />);
  });
  return onCopyText as ReturnType<typeof vi.fn>;
}
const copyButton = () => host.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement;
const menu = () => document.body.querySelector('[role="menu"]');
const menuItem = (label: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menu"] button')).find((b) =>
    b.textContent?.includes(label),
  )!;

describe('任务收尾条', () => {
  it('显示本任务用时', async () => {
    await render();
    expect(host.querySelector('[data-testid="turn-elapsed"]')!.textContent).toBe('用时 2 分 14 秒');
  });

  it('用时算不出来：不显示，也不编一个', async () => {
    await render({ footer: footer(null) });
    expect(host.querySelector('[data-testid="turn-elapsed"]')).toBeNull();
    expect(copyButton()).not.toBeNull();
  });

  it('点复制：弹出两项菜单，而且开着的菜单不会被这次点击自己关掉', async () => {
    await render();
    await act(async () => copyButton().click());
    expect(menu()).not.toBeNull();
    expect(menuItem('复制最后一条回复')).toBeDefined();
    expect(menuItem('复制整个任务')).toBeDefined();
    // 每项带一句话说明，讲清各自复制什么
    expect(menu()!.textContent).toContain('不含思考过程');
  });

  it('复制最后一条回复：只写那段话', async () => {
    const onCopyText = await render();
    await act(async () => copyButton().click());
    await act(async () => menuItem('复制最后一条回复').click());
    expect(onCopyText).toHaveBeenCalledWith('还剩 40G');
    expect(menu()).toBeNull();
    expect(copyButton().getAttribute('aria-label')).toBe('已复制');
  });

  it('复制整个任务：用户、工具调用与返回、模型回复都在，思维链不在', async () => {
    const onCopyText = await render();
    await act(async () => copyButton().click());
    await act(async () => menuItem('复制整个任务').click());
    const text = onCopyText.mock.calls[0][0] as string;
    expect(text).toContain('看看磁盘');
    expect(text).toContain('df -h');
    expect(text).toContain('Filesystem 40G');
    expect(text).toContain('还剩 40G');
    expect(text).not.toContain('不该被复制的思考');
  });

  it('写剪贴板失败：如实告诉用户，不显示「已复制」', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onCopyText = vi.fn().mockRejectedValue(new Error('denied'));
    await render({ onCopyText });
    await act(async () => copyButton().click());
    await act(async () => menuItem('复制最后一条回复').click());
    expect(copyButton().getAttribute('aria-label')).toBe('复制失败');
    spy.mockRestore();
  });

  it('提示一会儿后恢复成「复制」', async () => {
    vi.useFakeTimers();
    try {
      await render();
      await act(async () => copyButton().click());
      await act(async () => menuItem('复制最后一条回复').click());
      expect(copyButton().getAttribute('aria-label')).toBe('已复制');
      await act(async () => {
        vi.advanceTimersByTime(1400);
      });
      expect(copyButton().getAttribute('aria-label')).toBe('复制');
    } finally {
      vi.useRealTimers();
    }
  });

  it('点菜单外面 / 按 Esc 收起；再点一次按钮也收起', async () => {
    await render();
    await act(async () => copyButton().click());
    await act(async () => document.body.click());
    expect(menu()).toBeNull();

    await act(async () => copyButton().click());
    expect(menu()).not.toBeNull();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(menu()).toBeNull();

    await act(async () => copyButton().click());
    await act(async () => copyButton().click());
    expect(menu()).toBeNull();
  });

  it('列表一滚动菜单就收起（fixed 定位的菜单不能悬在错的位置）', async () => {
    await render();
    await act(async () => copyButton().click());
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(menu()).toBeNull();
  });

  describe('菜单朝哪边弹', () => {
    const placeButton = (top: number, bottom: number) => {
      copyButton().getBoundingClientRect = () =>
        ({ top, bottom, left: 20, right: 60, width: 40, height: bottom - top, x: 20, y: top, toJSON() {} }) as DOMRect;
    };

    it('下面放得下：上边缘贴在按钮下方 4px，从左上角展开', async () => {
      await render();
      placeButton(100, 120);
      await act(async () => copyButton().click());
      const el = menu() as HTMLElement;
      expect(el.style.top).toBe('124px');
      expect(el.style.bottom).toBe('');
      expect(el.style.transformOrigin).toBe('');
    });

    it('下面放不下（最后一条消息贴着面板底部）：下边缘贴在按钮上方 4px，从左下角展开', async () => {
      await render();
      const bottom = window.innerHeight - 20;
      placeButton(bottom - 20, bottom);
      await act(async () => copyButton().click());
      const el = menu() as HTMLElement;
      // 用下边缘定位：菜单实际多高都紧贴按钮，不靠估算高度去推上边缘。
      expect(el.style.bottom).toBe(`${window.innerHeight - (bottom - 20 - 4)}px`);
      expect(el.style.top).toBe('');
      expect(el.style.transformOrigin).toBe('bottom left');
    });
  });

  it('按钮不带 aria-expanded（列表把它当成折叠开关，会取消贴底跟随）', async () => {
    await render();
    expect(copyButton().hasAttribute('aria-expanded')).toBe(false);
  });

  it('桌面：hover 才浮现；菜单开着或刚复制完时保持可见（鼠标进了菜单就离开了消息）', async () => {
    await render();
    const bar = host.querySelector('[data-testid="turn-actions"]')!;
    expect(bar.className).toContain('opacity-0');
    expect(bar.className).toContain('group-hover/turn:opacity-100');
    await act(async () => copyButton().click());
    expect(bar.className).toContain('opacity-100');
    expect(bar.className).not.toContain('opacity-0');
  });

  it('手机：常显；复制走底部面板，选项照样复制', async () => {
    const onCopyText = await render({ mobile: true });
    const bar = host.querySelector('[data-testid="turn-actions"]')!;
    expect(bar.className).not.toContain('opacity-0');

    await act(async () => copyButton().click());
    expect(menu()).toBeNull(); // 没有桌面浮层菜单
    const option = Array.from(document.body.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('复制整个任务'),
    )!;
    expect(option).toBeDefined();
    await act(async () => option.click());
    expect(onCopyText).toHaveBeenCalledTimes(1);
    expect(onCopyText.mock.calls[0][0]).toContain('df -h');
  });
});
