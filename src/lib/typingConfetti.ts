import { getCaretViewportPoint } from './caretPosition';
import { fireConfetti } from './confetti';
import { isSupremeTypingActive } from '@/stores/supremeEffectsStore';

/** 两发礼炮的最小间隔：连发再快也不超过这个频率，粒子数才压得住。 */
const MIN_INTERVAL_MS = 35;
let lastFiredAt = 0;

/** 一次输入对应多少纸片：打一个字少、粘贴一大段多，但封顶。 */
export function confettiCountFor(insertedChars: number): number {
  return Math.min(42, 12 + Math.floor(Math.max(0, insertedChars - 1) / 2));
}

/**
 * 「至尊无敌特效」的输入框接入点：文本变长（有新内容进来）时，在光标处放一发小礼炮。
 * 删除 / 原地替换 / 特效没开都直接返回 —— 调用方每次输入变更都可以无脑调用。
 */
export function celebrateTyping(el: HTMLTextAreaElement, prevValue: string, nextValue: string): void {
  const inserted = nextValue.length - prevValue.length;
  if (inserted <= 0) return;
  if (!isSupremeTypingActive()) return;

  const now = performance.now();
  if (now - lastFiredAt < MIN_INTERVAL_MS) return;
  lastFiredAt = now;

  const { x, y } = getCaretViewportPoint(el);
  fireConfetti({
    x,
    y,
    angle: -90,
    spread: 70,
    count: confettiCountFor(inserted),
    speed: [320, 640],
    life: [0.9, 1.5],
    gravity: 1500,
    drag: 2.2,
    scale: 0.8,
  });
}
