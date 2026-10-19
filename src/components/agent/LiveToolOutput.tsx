import { memo, useRef } from 'react';
import { advanceSegments, emptySegments, type LiveSegments } from '@/lib/liveOutputSegments';

/**
 * 执行中工具输出的内容（放在工具卡片那个固定高度的 `<pre>` 里）。
 *
 * 文字原样、全量显示，和直接渲染 `{text}` 看起来一模一样（贴底跟随、上翻、选中复制
 * 都不变）；区别只在内部：输出按换行切成若干块，已封口的块被 memo 住不再重排，
 * 每帧只有最后一块跟着新输出增长。这样重排代价只跟「这一帧新到的量」有关，不再
 * 随已累计的总量线性变慢。分段规则与取舍见 `lib/liveOutputSegments.ts`。
 *
 * `text` 在执行期间只会在末尾追加；分段状态放在 ref 里按文本推进（渲染期间的
 * 推进是幂等的：同一个 `text` 再算一次直接返回同一份状态，StrictMode 双渲染安全）。
 */
function LiveToolOutput({ text }: { text: string }) {
  const segmentsRef = useRef<LiveSegments>(emptySegments());
  segmentsRef.current = advanceSegments(segmentsRef.current, text);
  const { sealed, tail } = segmentsRef.current;
  return (
    <>
      {sealed.map((segment, index) => (
        <SealedSegment key={index} text={segment} />
      ))}
      {tail !== '' && <span className="block">{tail}</span>}
    </>
  );
}

/** 已封口的一块：内容永不再变，`text` 引用不变时 React 直接跳过。 */
const SealedSegment = memo(function SealedSegment({ text }: { text: string }) {
  return <span className="block">{text}</span>;
});

export default LiveToolOutput;
