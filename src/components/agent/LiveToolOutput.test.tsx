// @vitest-environment jsdom
/**
 * 执行中输出的分段渲染：看起来必须和直接渲染文本一样（文字全量、顺序不变），
 * 只是内部切成了若干块。jsdom 不做布局，排版代价与滚动几何不在这里验证
 * （见 `scrollFollow.test.tsx` 的贴底跟随，以及真实浏览器里的计时）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import LiveToolOutput from './LiveToolOutput';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  container?.remove();
  container = null;
});

function mount(text: string): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<LiveToolOutput text={text} />);
  });
  return container;
}

function rerender(text: string) {
  act(() => {
    root?.render(<LiveToolOutput text={text} />);
  });
}

const row = (i: number) => `drwxr-xr-x 2 root root 4096 /var/lib/some/path/file_${i}.log\n`;

describe('LiveToolOutput', () => {
  it('短输出：文字原样显示', () => {
    const el = mount('line 1\nline 2\n');
    expect(el.textContent).toBe('line 1\nline 2\n');
  });

  it('长输出：被切成多块，但拼起来逐字符等于输入', () => {
    const text = Array.from({ length: 3000 }, (_, i) => row(i)).join('');
    expect(text.length).toBeGreaterThan(64 * 1024 * 2);
    const el = mount(text);
    expect(el.children.length).toBeGreaterThan(2);
    expect(el.textContent).toBe(text);
  });

  it('追加输出：封口块的 DOM 节点保持不动，只有末块在长', () => {
    const first = Array.from({ length: 2500 }, (_, i) => row(i)).join('');
    const el = mount(first);
    const sealedBefore = Array.from(el.children).slice(0, -1);
    expect(sealedBefore.length).toBeGreaterThan(0);

    const more = Array.from({ length: 200 }, (_, i) => row(10_000 + i)).join('');
    rerender(first + more);

    expect(el.textContent).toBe(first + more);
    sealedBefore.forEach((node, i) => {
      expect(el.children[i]).toBe(node);
    });
  });

  it('文本被换成别的内容时整体换新，不残留旧块', () => {
    const el = mount(Array.from({ length: 2500 }, (_, i) => row(i)).join(''));
    rerender('brand new\n');
    expect(el.textContent).toBe('brand new\n');
    expect(el.children.length).toBe(1);
  });

  it('空文本不渲染任何块', () => {
    const el = mount('');
    expect(el.children.length).toBe(0);
    expect(el.textContent).toBe('');
  });
});
