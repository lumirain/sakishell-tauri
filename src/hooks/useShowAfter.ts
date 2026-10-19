import { useEffect, useState } from 'react';

/**
 * 「持续为真满 `delayMs` 才算真」：短暂闪过的 `active` 被整个吞掉。
 *
 * 用途是瞬态界面（命令执行中的实时输出、「模型审批中」）——它们存在的意义是让
 * 慢操作不显得卡死，对几十毫秒就结束的操作反而是噪音：刚弹出来就收回去，用户
 * 只看到一次抽动。让它们先观望一小会儿，结束得快就从头到尾不出现。
 *
 * 只延迟「出现」，不延迟「消失」：`active` 一变假，返回值同一次渲染里就变假
 * （收起动画由调用方的 `useAnimatedPresence` 接手，不在这里等）。
 */
export function useShowAfter(active: boolean, delayMs: number): boolean {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!active) {
      setSettled(false);
      return;
    }
    const timer = setTimeout(() => setSettled(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  // 与 active 相与：active 刚变假的那次渲染 settled 还是旧值，不能让它多撑一帧
  return active && settled;
}
