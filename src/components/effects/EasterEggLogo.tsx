import { useCallback, useEffect, useRef, useState } from 'react';
import { APP_LOGO, APP_NAME } from '@/lib/constants';
import { prefersReducedMotion } from '@/lib/confetti';
import { createLogoBounce, jumpEnergy, type LogoBounce } from '@/lib/logoBounce';
import { useTapSequence } from '@/hooks/useTapSequence';
import { useSupremeEffectsStore } from '@/stores/supremeEffectsStore';
import UnlockCeremony from './UnlockCeremony';

/** 连点多少下触发彩蛋；相邻两下间隔不超过 CLICK_GAP_MS 才算「连续」。 */
const REQUIRED_CLICKS = 10;
const CLICK_GAP_MS = 1500;

/**
 * 关于页的应用图标：按下收缩、松开弹跳；连点十下，鹈鹕骑车登场、礼炮齐鸣，解锁「至尊无敌特效」。
 * 桌面与移动端的关于页共用这一个组件，样式差异只通过 `className`（作用在图片上）表达。
 *
 * 角色：manager —— 协调点击计数、弹簧动画、解锁仪式与解锁状态四件事；
 * 各自的逻辑都在独立模块里（useTapSequence / logoBounce / UnlockCeremony / supremeEffectsStore）。
 */
export default function EasterEggLogo({ className }: { className: string }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const bounceRef = useRef<LogoBounce | null>(null);
  const pressedRef = useRef(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const unlock = useSupremeEffectsStore((s) => s.unlock);

  useEffect(() => {
    const el = buttonRef.current;
    if (!el) return;
    const bounce = createLogoBounce(el, prefersReducedMotion);
    bounceRef.current = bounce;
    return () => {
      bounce.dispose();
      bounceRef.current = null;
    };
  }, []);

  const tap = useTapSequence(REQUIRED_CLICKS, CLICK_GAP_MS, () => {
    const el = buttonRef.current;
    // 仪式进行中不重复触发（连点是顺手的事，别叠出两只鹈鹕）
    if (!el) return;
    setAnchor((current) => current ?? el.getBoundingClientRect());
  });

  const handlePointerDown = useCallback(() => {
    pressedRef.current = true;
    bounceRef.current?.press();
  }, []);

  /** 按下后指针移出 / 被系统取消：没点成，松手但不起跳。 */
  const handleAbort = useCallback(() => {
    if (!pressedRef.current) return;
    pressedRef.current = false;
    bounceRef.current?.release(0);
  }, []);

  const handleClick = useCallback(() => {
    pressedRef.current = false;
    const count = tap();
    bounceRef.current?.release(jumpEnergy(count));
  }, [tap]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        // 纯彩蛋：不进 Tab 顺序，免得键盘用户 Tab 到一个没有用途的按钮
        tabIndex={-1}
        onPointerDown={handlePointerDown}
        onPointerCancel={handleAbort}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') handleAbort();
        }}
        onClick={handleClick}
        className="block cursor-pointer select-none rounded-3xl border-0 bg-transparent p-0 outline-none [-webkit-tap-highlight-color:transparent] touch-manipulation"
        style={{ transformOrigin: '50% 100%' }}
      >
        <img
          src={APP_LOGO}
          alt={`${APP_NAME} logo`}
          className={className}
          draggable={false}
        />
      </button>
      {anchor && (
        <UnlockCeremony
          anchor={anchor}
          onCannon={unlock}
          onDone={() => setAnchor(null)}
        />
      )}
    </>
  );
}
