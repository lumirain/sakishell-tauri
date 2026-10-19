/**
 * 文件管理器「记住上次浏览的目录」的存取（桌面 FileManagerPanel / 移动
 * MobileFilesHost 共用，**目录记忆的唯一来源**）。
 *
 * 为什么不放进 AppSettings：它是**视图状态**，不是用户设置，而且每切一次目录就
 * 写一次。走 `settings.update` 要把整份设置序列化、fsync、重扫插件目录、广播
 * 「设置已变更」，之后订阅整份 settings 的组件（含文件管理器自己）还会整表重渲染
 * 一次——只为记一个路径。localStorage 是同步、本机、零广播的，足够。
 *
 * 兼容旧数据：旧版本把路径写在 `settings.fileManagerPath(s)`。这里**只读**它们作
 * 兜底（本机还没有记录的连接沿用旧记忆），不再写、也不清；一旦某个连接在本机
 * 有了新记录，以新记录为准。
 *
 * 取值顺序：本机该连接的记录 → 旧设置里该连接的记录 → 本机「最近一次」→ 旧设置
 * 里的「最近一次」→ `/`。「最近一次」是给没有记录的新连接用的起点。
 */

const STORAGE_KEY = 'marcel-file-manager-path-memory';

/** 供测试 / 排查用：这份数据落在 localStorage 的哪个 key 下。 */
export const FILE_MANAGER_PATH_MEMORY_STORAGE_KEY = STORAGE_KEY;

export interface PathMemory {
  /** 最近一次浏览的目录（任意连接）。 */
  last?: string;
  /** connectionKey → 该连接最近浏览的目录。 */
  byConnection: Record<string, string>;
}

/** 旧版本写在 AppSettings 里的记忆（只读兜底）。 */
export interface LegacyPathSettings {
  fileManagerPath?: string;
  fileManagerPaths?: Record<string, string>;
}

function usable(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** 读本机记忆；localStorage 不可用 / 数据损坏时返回空记忆（不报错、不清盘）。 */
export function readPathMemory(): PathMemory {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { byConnection: {} };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { byConnection: {} };
    const record = parsed as { last?: unknown; byConnection?: unknown };
    const byConnection: Record<string, string> = {};
    if (record.byConnection && typeof record.byConnection === 'object') {
      for (const [key, value] of Object.entries(record.byConnection)) {
        if (usable(value)) byConnection[key] = value;
      }
    }
    return { last: usable(record.last) ? record.last : undefined, byConnection };
  } catch {
    return { byConnection: {} };
  }
}

/** 纯函数：按取值顺序决定初始目录。 */
export function resolveRememberedPath(
  connectionKey: string | null,
  memory: PathMemory,
  legacy: LegacyPathSettings,
): string {
  if (connectionKey) {
    const own = memory.byConnection[connectionKey];
    if (usable(own)) return own;
    const legacyOwn = legacy.fileManagerPaths?.[connectionKey];
    if (usable(legacyOwn)) return legacyOwn;
  }
  if (usable(memory.last)) return memory.last;
  if (usable(legacy.fileManagerPath)) return legacy.fileManagerPath;
  return '/';
}

/** 面板初始化时调用：这个连接上次停在哪个目录。 */
export function loadRememberedPath(
  connectionKey: string | null,
  legacy: LegacyPathSettings,
): string {
  return resolveRememberedPath(connectionKey, readPathMemory(), legacy);
}

/**
 * 记下当前目录。同步写 localStorage，没有任何广播；值没变就不写。
 * 写失败（隐私模式 / 配额）静默忽略——记忆丢了只是下次从 `/` 开始，不能因此打断浏览。
 */
export function rememberPath(connectionKey: string | null, path: string): void {
  if (!usable(path)) return;
  try {
    const memory = readPathMemory();
    const unchanged =
      memory.last === path && (!connectionKey || memory.byConnection[connectionKey] === path);
    if (unchanged) return;
    const next: PathMemory = {
      last: path,
      byConnection: connectionKey
        ? { ...memory.byConnection, [connectionKey]: path }
        : memory.byConnection,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage 失败不阻止浏览
  }
}
