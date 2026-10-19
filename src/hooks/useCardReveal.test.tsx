// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  REVEAL_STAGGER_MAX_STEPS,
  REVEAL_STAGGER_MS,
  revealDelayMs,
  useCardReveal,
} from './useCardReveal';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** 把每张卡的入场判定渲染成 DOM（类名 + 行内 --reveal-delay），测的就是调用方会拿到的东西。 */
function Harness({ ready, ids }: { ready: boolean; ids: string[] }) {
  const revealOf = useCardReveal(ready);
  return (
    <ul>
      {ids.map((id, i) => {
        const reveal = revealOf(id, i);
        return (
          <li
            key={id}
            data-id={id}
            className={reveal.className}
            style={reveal.style}
          />
        );
      })}
    </ul>
  );
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(props: { ready: boolean; ids: string[] }) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Harness {...props} />));
}

function update(props: { ready: boolean; ids: string[] }) {
  act(() => root!.render(<Harness {...props} />));
}

function card(id: string): HTMLElement {
  const el = container!.querySelector<HTMLElement>(`[data-id="${id}"]`);
  if (!el) throw new Error(`没有这张卡：${id}`);
  return el;
}

const revealing = (id: string) => card(id).classList.contains('card-reveal');
const delayOf = (id: string) => card(id).style.getPropertyValue('--reveal-delay');

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('revealDelayMs', () => {
  it('按序号线性错开，并封顶', () => {
    expect(revealDelayMs(0)).toBe(0);
    expect(revealDelayMs(2)).toBe(2 * REVEAL_STAGGER_MS);
    expect(revealDelayMs(REVEAL_STAGGER_MAX_STEPS + 20)).toBe(
      REVEAL_STAGGER_MAX_STEPS * REVEAL_STAGGER_MS,
    );
    expect(revealDelayMs(-3)).toBe(0);
  });
});

describe('useCardReveal', () => {
  it('挂载时数据已就绪：在场的卡不播入场（容器自己有动画，避免双重动效）', () => {
    mount({ ready: true, ids: ['a', 'b'] });

    expect(revealing('a')).toBe(false);
    expect(revealing('b')).toBe(false);
  });

  it('挂载时未就绪、随后整批到齐：依次错开浮现', () => {
    mount({ ready: false, ids: [] });
    update({ ready: true, ids: ['a', 'b', 'c'] });

    expect(revealing('a')).toBe(true);
    expect(delayOf('a')).toBe('0ms');
    expect(delayOf('b')).toBe(`${REVEAL_STAGGER_MS}ms`);
    expect(delayOf('c')).toBe(`${2 * REVEAL_STAGGER_MS}ms`);
  });

  it('整批浮现之后新增的卡：只淡入上浮，不排队', () => {
    mount({ ready: false, ids: [] });
    update({ ready: true, ids: ['a', 'b'] });
    update({ ready: true, ids: ['a', 'b', 'c'] });

    expect(revealing('c')).toBe(true);
    expect(delayOf('c')).toBe('0ms');
  });

  it('挂载时已就绪，之后新增的卡同样播入场（新建连接）', () => {
    mount({ ready: true, ids: ['a'] });
    update({ ready: true, ids: ['a', 'b'] });

    expect(revealing('a')).toBe(false);
    expect(revealing('b')).toBe(true);
    expect(delayOf('b')).toBe('0ms');
  });

  it('已在场的卡重渲染时不会补上入场类（否则会被当成新动画重播）', () => {
    // 加载前就在场的占位项（如调试服务器）
    mount({ ready: false, ids: ['debug'] });
    expect(revealing('debug')).toBe(false);

    update({ ready: true, ids: ['debug', 'a'] });
    update({ ready: true, ids: ['debug', 'a', 'b'] });

    expect(revealing('debug')).toBe(false);
  });

  it('一张卡的延迟只在首次出现时定下，之后重渲染不改（动画途中改延迟会跳帧）', () => {
    mount({ ready: false, ids: [] });
    update({ ready: true, ids: ['a', 'b', 'c'] });
    const before = delayOf('c');

    // 整批提交后列表顺序变了：c 的序号从 2 变成 0，延迟不该跟着变
    update({ ready: true, ids: ['c', 'a', 'b'] });

    expect(delayOf('c')).toBe(before);
  });

  it('错开有上限：卡片再多，末尾的卡也不会等得更久', () => {
    const ids = Array.from({ length: 30 }, (_, i) => `n${i}`);
    mount({ ready: false, ids: [] });
    update({ ready: true, ids });

    expect(delayOf('n29')).toBe(`${REVEAL_STAGGER_MAX_STEPS * REVEAL_STAGGER_MS}ms`);
  });
});
