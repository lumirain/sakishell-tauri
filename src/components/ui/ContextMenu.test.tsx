// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ContextMenu, { type ContextMenuItem } from './ContextMenu';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

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
});

const items: ContextMenuItem[] = [
  { label: '复制最后一条回复', description: '只复制模型说的最后一段话', onClick: vi.fn() },
  { label: '复制整个任务', description: '含工具调用与返回，不含思考过程', onClick: vi.fn() },
];

async function render(props: Partial<React.ComponentProps<typeof ContextMenu>> = {}) {
  await act(async () => {
    root.render(<ContextMenu x={10} y={20} items={items} onClose={vi.fn()} {...props} />);
  });
  return document.body.querySelector('[role="menu"]') as HTMLElement;
}
const buttons = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menu"] button'));

// jsdom 不做布局，量不出宽高与圆角；下面钉住的是各自的「原因」。
describe('ContextMenu 版式', () => {
  it('每一项都是块级：菜单宽度取最宽一项，而不是各项并排之和', async () => {
    // <button> 默认 inline-block，fixed 菜单按收缩宽度排版时会把它们并排在一行，菜单就被
    // 撑成各项宽度之和（带说明文字的两项曾因此撑出一条比内容宽近一倍的菜单）。
    await render();
    expect(buttons()).toHaveLength(2);
    for (const button of buttons()) expect(button.classList.contains('block')).toBe(true);
  });

  it('菜单自己裁切圆角、容器不留上下内边距：悬停高亮铺到边，方角也不会戳出圆角', async () => {
    // 容器留 py-1 时，整行的方块高亮上下各空一截、四个角又戳出圆角轮廓。
    // 这段间距改由首项 / 末项自己的内边距承担，文字位置和菜单总高度不变。
    const el = await render();
    expect(el.classList.contains('overflow-hidden')).toBe(true);
    expect(el.classList.contains('rounded-xl')).toBe(true);
    expect(el.classList.contains('py-1')).toBe(false);
    for (const button of buttons()) {
      expect(button.classList.contains('first:pt-2.5')).toBe(true);
      expect(button.classList.contains('last:pb-2.5')).toBe(true);
    }
  });
});

describe('ContextMenu 定位', () => {
  it('默认 below：y 是上边缘，原点在左上', async () => {
    const el = await render({ x: 10, y: 20 });
    expect(el.style.top).toBe('20px');
    expect(el.style.left).toBe('10px');
    expect(el.style.bottom).toBe('');
    expect(el.style.transformOrigin).toBe('');
  });

  it('above：y 是下边缘（菜单往上长），展开原点在左下', async () => {
    const el = await render({ x: 10, y: 300, anchor: 'above' });
    expect(el.style.bottom).toBe(`${window.innerHeight - 300}px`);
    expect(el.style.top).toBe('');
    expect(el.style.transformOrigin).toBe('bottom left');
  });
});
