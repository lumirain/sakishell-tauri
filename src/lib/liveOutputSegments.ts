/**
 * 执行中工具输出的分段：把一路追加的长文本切成「封口段 + 活动尾段」，让界面每次
 * 只需要重排**新增的那一小段**，而不是把整串输出重新交给浏览器排版。
 *
 * 为什么需要：前台命令（`cat` 大日志、`find /`、`journalctl`……）的输出可以有几十
 * MB，执行卡片原先每帧把整串文字重新塞进同一个 `<pre>`，耗时随已累计的输出线性
 * 增长（实测 1MB 约 80ms/帧、10MB 约 470ms/帧）。数据一行都不能少，所以不能靠
 * 截断解决，只能让每帧的排版代价只跟「这一帧新到的量」有关。
 *
 * 规则：
 * - 封口只发生在 `\n` 之后：每个封口段都以换行结尾，段与段之间不会把一行劈成两半
 *   （显示成相邻的块，行与行之间正好是原来的换行）。
 * - 一行长到超过段长（没有换行可切，例如压成一行的 JSON）时不强行切，该段继续长；
 *   这种极端输入退化为原先的行为，但不会更差。
 * - 封口后的段内容不再变化，调用方可以放心 memo。
 *
 * 输入文本在执行期间只会**在末尾追加**。检测到不是追加（变短，或已吃进去的末尾
 * 与记录的探针不一致）就整体重建，宁可多算一次也不显示错内容。
 */

/** 单段的目标长度（字符数）。 */
export const SEGMENT_CHARS = 64 * 1024;

/** 续接校验用的探针长度：已吃进去的文本的最后这么多个字符。 */
const PROBE_CHARS = 32;

export interface LiveSegments {
  /** 已封口的段：每段以 `\n` 结尾，之后不再变化。 */
  readonly sealed: readonly string[];
  /** 还在增长的最后一段（可能为空串）。 */
  readonly tail: string;
  /** 已经吃进来的文本长度（字符）。 */
  readonly consumed: number;
  /** 已吃进来的文本末尾若干字符，用来确认下一次输入确实是在它后面续写。 */
  readonly probe: string;
}

export function emptySegments(): LiveSegments {
  return { sealed: [], tail: '', consumed: 0, probe: '' };
}

/**
 * 复制出一份与原字符串底层存储无关的新字符串。
 *
 * 必须这么做：V8 里 `slice()` 出来的字符串（≥13 字符）只是指向原字符串的视图，会把
 * **整个原字符串**钉在内存里。这里的原字符串是「截至当前帧的全部输出」，每一帧
 * 都是一份新的整串（拼接后按需展平），如果封口段直接引用它，第 k 个封口段就会钉住
 * 第 k 帧时那份几 MB 的整串，总占用变成输出量的平方级（实测 8MB 输出留住 480MB）。
 * 拼上一个字符再切掉，会迫使引擎先展平成一份只有这一小段大小的新串，切出来的
 * 视图指向的就是这份小串。
 */
function detach(text: string): string {
  return (text + '\n').slice(0, -1);
}

/** 把 `base` 从 `from` 起尽可能多地封口，返回新封口段与剩余起点。 */
function seal(
  base: string,
  from: number,
  segmentChars: number,
): { sealed: string[]; start: number } {
  const sealed: string[] = [];
  let start = from;
  while (base.length - start >= segmentChars) {
    const newline = base.indexOf('\n', start + segmentChars - 1);
    if (newline === -1) break;
    sealed.push(base.slice(start, newline + 1));
    start = newline + 1;
  }
  return { sealed, start };
}

/**
 * 把新的完整文本 `text` 并入分段状态。没有变化时原样返回 `prev`（引用不变）。
 */
export function advanceSegments(
  prev: LiveSegments,
  text: string,
  segmentChars: number = SEGMENT_CHARS,
): LiveSegments {
  const continues =
    text.length >= prev.consumed &&
    (prev.consumed === 0 ||
      text.slice(prev.consumed - prev.probe.length, prev.consumed) === prev.probe);
  if (continues && text.length === prev.consumed) return prev;
  const base = continues ? prev : emptySegments();

  // 活动尾段 + 新到的部分，从尾段起点开始找换行封口；封口不会回头动已封口的段。
  const merged = base.tail + detach(text.slice(base.consumed));
  const { sealed: fresh, start } = seal(merged, 0, segmentChars);

  return {
    sealed: fresh.length === 0 ? base.sealed : [...base.sealed, ...fresh],
    tail: start === 0 ? merged : merged.slice(start),
    consumed: text.length,
    probe: detach(text.slice(Math.max(0, text.length - PROBE_CHARS))),
  };
}
