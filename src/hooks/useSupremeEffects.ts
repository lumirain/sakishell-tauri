import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/lib/confetti";
import { useSupremeEffectsStore } from "@/stores/supremeEffectsStore";

/**
 * 关于页「至尊无敌特效」开关行的显示控制（桌面与移动端共用）。
 *
 * - `unlocked`：未解锁时界面上根本不该有这一行。
 * - `justRevealed`：本次页面停留期间刚解锁 —— 这一行是「新长出来」的，要给入场动画并滚到视野里，
 *   否则用户在图标那边看礼炮，完全不知道开关出现在页面下方哪里。重新进入页面时它早已解锁，
 *   就当普通一行直接显示，不再演。
 */
export function useSupremeEffects() {
  const unlocked = useSupremeEffectsStore((s) => s.unlocked);
  const enabled = useSupremeEffectsStore((s) => s.enabled);
  const setEnabled = useSupremeEffectsStore((s) => s.setEnabled);
  const unlockedAtMount = useRef(unlocked);
  const rowRef = useRef<HTMLDivElement>(null);
  const justRevealed = unlocked && !unlockedAtMount.current;

  useEffect(() => {
    if (!justRevealed) return;
    // 等入场动画起步后再滚，避免滚动目标还在 translateY 偏移里
    const id = window.setTimeout(() => {
      rowRef.current?.scrollIntoView?.({
        block: "nearest",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }, 120);
    return () => window.clearTimeout(id);
  }, [justRevealed]);

  return { unlocked, enabled, setEnabled, justRevealed, rowRef };
}
