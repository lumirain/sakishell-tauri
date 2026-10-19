import { memo, useEffect, useRef, useState } from 'react';

/**
 * 滚动文字（纯功能）：文本变化时，**变了的那几位**各自上滚替换 —— 旧字向上滑出并渐渐模糊，
 * 新字从下方滑入并由糊变清；没变的位保持原地不动。
 *
 * - 位按**从右往左**对齐（个位 / 小数点 / 单位永远在同一个槽里），所以 `1.9K → 2.0K`
 *   只有变了的位在动；
 * - 增长场景（计数只增不减）方向固定为上滚，读起来是「数字在往上涨」；
 * - 首帧不播动画；`prefers-reduced-motion` 下直接替换；
 * - 动画只用 transform / opacity / filter，不触发布局。
 * 样式见 globals.css 的 `.rolling-*`。
 */
function RollingChar({ char, enter }: { char: string; enter: boolean }) {
  const [cur, setCur] = useState(char);
  const [prev, setPrev] = useState<string | null>(null);
  // 首帧之后才出现的新槽（位数增长）也要滑入；首帧的槽静止
  const [rollingIn, setRollingIn] = useState(enter);
  const seen = useRef(char);

  useEffect(() => {
    if (char === seen.current) return;
    seen.current = char;
    setPrev(cur);
    setCur(char);
    setRollingIn(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cur 只用来取「变化前」的旧字
  }, [char]);

  return (
    <span className="rolling-slot">
      {/* 不可见的占位字：撑出稳定的槽宽（数字等宽，字母以新字为准） */}
      <span className="rolling-sizer">{cur || ' '}</span>
      {prev !== null && (
        <span key={`out-${prev}-${cur}`} className="rolling-out" aria-hidden="true" onAnimationEnd={() => setPrev(null)}>
          {prev}
        </span>
      )}
      <span
        key={`in-${cur}`}
        className={rollingIn ? 'rolling-in' : 'rolling-static'}
        onAnimationEnd={() => setRollingIn(false)}
      >
        {cur}
      </span>
    </span>
  );
}

export default memo(function RollingText({ text, className = '' }: { text: string; className?: string }) {
  // 从右往左给槽编号：槽 id 稳定，位数变化时只在最左侧增减槽
  const chars = Array.from(text);
  const rendered = useRef(false);
  useEffect(() => { rendered.current = true; }, []);
  return (
    <span className={`rolling-text ${className}`} aria-label={text} role="text">
      {chars.map((ch, i) => {
        const fromRight = chars.length - 1 - i;
        return <RollingChar key={fromRight} char={ch} enter={rendered.current} />;
      })}
    </span>
  );
});
