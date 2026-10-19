/**
 * 终端休眠的纯逻辑：快照打包、休眠期输出缓冲、何时该休眠的判定。
 *
 * 背景：xterm 的回滚缓冲每个单元格占 12 字节，200 列写满 10000 行约 24 MB；多个
 * 标签都写满就是几百 MB。后台标签没人看，却一直占着。休眠 = 把整份缓冲（含颜色
 * 与回滚）序列化后 gzip 存在内存里，释放 xterm 实例与它的 WebGL 上下文；切回时
 * 重建并原样写回。实测（200 列、10040 行彩色日志）：序列化 ≈67 ms、gzip ≈26 ms、
 * 体积 79 KB（最坏的逐字符变色也只有 2.2 MB）、还原 ≈50 ms，文本与前景色逐行一致。
 * 所以不落盘——体积小到没必要，也就没有终端内容明文留在磁盘上的问题。
 *
 * 这里只放与 xterm / DOM 无关的部分，便于单测；生命周期编排在
 * `components/terminal/TerminalInstanceManager.ts`。
 */

/** 标签被切走并且这么久没有输出，才进入休眠；短时间来回切标签不会触发。 */
export const HIBERNATE_AFTER_MS = 60_000;

/** 休眠期间积压的输出超过这个字符数就提前唤醒，避免后台缓冲无限涨。 */
export const PENDING_WAKE_CHARS = 1024 * 1024;

/** 休眠扫描间隔。 */
export const HIBERNATE_SWEEP_MS = 15_000;

export interface HibernationCandidate {
  /** 当前是否在屏幕上显示。 */
  visible: boolean;
  /** 实例是否正醒着（有 xterm、没在休眠或休眠流程中）。 */
  awake: boolean;
  /** 被切走的时刻；可见时无意义。 */
  hiddenSince: number;
  /** 最近一次收到输出（含本地横幅）的时刻。 */
  lastActivityAt: number;
  now: number;
}

/** 该不该开始休眠这个标签：已隐藏、醒着、且隐藏与输出两者都已静默足够久。 */
export function shouldHibernate(c: HibernationCandidate): boolean {
  if (c.visible || !c.awake) return false;
  const quietSince = Math.max(c.hiddenSince, c.lastActivityAt);
  return c.now - quietSince >= HIBERNATE_AFTER_MS;
}

/**
 * 休眠期间到达的输出。保持到达顺序，唤醒时按序写回快照之后。
 * 只记数不解析：休眠期间不应该有任何终端状态在变化。
 */
export class PendingOutput {
  private chunks: string[] = [];
  private total = 0;

  push(text: string): void {
    if (!text) return;
    this.chunks.push(text);
    this.total += text.length;
  }

  /** 累计字符数（UTF-16 单元），用来判定是否该提前唤醒。 */
  get chars(): number {
    return this.total;
  }

  get isEmpty(): boolean {
    return this.chunks.length === 0;
  }

  /** 取走全部并清空；返回的块保持到达顺序。 */
  take(): string[] {
    const out = this.chunks;
    this.chunks = [];
    this.total = 0;
    return out;
  }
}

/** 打包后的快照。`raw` 只在运行环境没有 CompressionStream 时出现。 */
export type PackedSnapshot =
  | { kind: 'gzip'; bytes: Uint8Array }
  | { kind: 'raw'; bytes: Uint8Array };

function hasCompressionStreams(): boolean {
  return (
    typeof CompressionStream !== 'undefined' &&
    typeof DecompressionStream !== 'undefined'
  );
}

async function pipeThrough(
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 把序列化文本压成字节。失败时退回未压缩的 UTF-8，不丢快照。 */
export async function packSnapshot(text: string): Promise<PackedSnapshot> {
  const raw = new TextEncoder().encode(text);
  if (!hasCompressionStreams()) return { kind: 'raw', bytes: raw };
  try {
    return { kind: 'gzip', bytes: await pipeThrough(raw, new CompressionStream('gzip')) };
  } catch {
    return { kind: 'raw', bytes: raw };
  }
}

export async function unpackSnapshot(packed: PackedSnapshot): Promise<string> {
  const bytes =
    packed.kind === 'gzip'
      ? await pipeThrough(packed.bytes, new DecompressionStream('gzip'))
      : packed.bytes;
  return new TextDecoder().decode(bytes);
}
