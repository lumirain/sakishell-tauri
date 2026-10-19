import { useCallback, useEffect, useRef, type CSSProperties } from 'react';

/** 相邻两张卡片的入场间隔。 */
export const REVEAL_STAGGER_MS = 40;
/** 错开最多排几档：卡片再多，整批也要在半秒内收完，别让末尾的卡等得发愣。 */
export const REVEAL_STAGGER_MAX_STEPS = 6;

export interface CardReveal {
  /** 入场动画类名（`globals.css` 的 `.card-reveal`）；这张卡不该有入场时为空串。 */
  className: string;
  /** 只携带 `--reveal-delay`；调用方与自己已有的行内样式合并，不能整个替换。 */
  style?: CSSProperties;
}

const NONE: CardReveal = { className: '' };

export function revealDelayMs(index: number): number {
  return Math.min(Math.max(index, 0), REVEAL_STAGGER_MAX_STEPS) * REVEAL_STAGGER_MS;
}

function revealOf(delayMs: number): CardReveal {
  return {
    className: 'card-reveal',
    style: { ['--reveal-delay' as string]: `${delayMs}ms` } as CSSProperties,
  };
}

/**
 * 列表卡片的入场判定（**纯功能**：只回答"这张卡要不要播入场、延迟多少"，不管列表本身）。
 *
 * `ready` = 数据已读回（连接列表用 `connectionStore.loaded`）。三种出现方式，各有各的做法：
 *
 * 1. **挂载时数据已就绪**（再次打开列表）：卡片本来就在场，容器自己有入场动画，
 *    卡片再动一遍是双重动效，不播。
 * 2. **挂载时还没就绪，随后数据整批到齐**（冷启动）：转圈 → 卡片，按序号依次浮现，
 *    这是它存在的主要原因——让"空 → 有内容"是一次连续的揭晓，而不是硬切。
 * 3. **之后单张新增**（新建连接）：只淡入上浮，不排队。
 *
 * 决定**一张卡只做一次**并记下来：入场靠类名触发，已在场的卡重渲染时若又拿到类名，
 * 会被当成新动画重播；延迟在动画途中被改也会让它跳帧。
 */
export function useCardReveal(ready: boolean): (id: string, index: number) => CardReveal {
  const mountedRef = useRef(false);
  /** 「数据到齐的那一整批」是否已经提交过；之后新来的都按单张处理。 */
  const batchDoneRef = useRef(false);
  const decidedRef = useRef(new Map<string, CardReveal>());

  useEffect(() => {
    mountedRef.current = true;
  }, []);

  useEffect(() => {
    if (ready) batchDoneRef.current = true;
  }, [ready]);

  return useCallback(
    (id, index) => {
      const decided = decidedRef.current.get(id);
      if (decided) return decided;

      let reveal: CardReveal;
      if (!mountedRef.current) {
        // 首次渲染就在场：已就绪 = 情形 1；未就绪时在场的只可能是占位项（如调试服务器）。
        reveal = NONE;
      } else if (ready && !batchDoneRef.current) {
        reveal = revealOf(revealDelayMs(index));
      } else {
        reveal = revealOf(0);
      }
      decidedRef.current.set(id, reveal);
      return reveal;
    },
    [ready],
  );
}
