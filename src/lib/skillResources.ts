import type { SkillResource } from '@/lib/types';

/** 与后端 `skills::parser` 的 MAX_* 保持一致；后端仍会再校验一次。 */
export const MAX_RESOURCE_BYTES = 1024 * 1024;
export const MAX_TOTAL_RESOURCE_BYTES = 4 * 1024 * 1024;
export const MAX_RESOURCE_COUNT = 100;

const encoder = new TextEncoder();
export const byteLength = (s: string) => encoder.encode(s).length;

/** 路径规整：反斜杠转 `/`，去掉首尾空白与开头的 `./`。 */
export function normalizeResourcePath(raw: string): string {
  return raw.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

/**
 * 校验一个资源路径（规则同后端 `validate_resources`）。
 * `selfIndex` = 正在改名的那一项下标（不与自己比重复）。返回错误文案，合法则 null。
 */
export function validateResourcePath(
  path: string,
  resources: SkillResource[],
  selfIndex = -1,
): string | null {
  if (!path) return '请填写资源路径';
  if (path.startsWith('/')) return '资源路径必须是相对路径';
  if (path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) {
    return '资源路径含非法片段（空段 / . / ..）';
  }
  if (!path.toLowerCase().endsWith('.md')) return '只支持 .md 资源文件';
  if (path.toLowerCase() === 'skill.md') return '资源不能命名为 SKILL.md（它是 skill 的入口文件）';
  if (resources.some((r, i) => i !== selfIndex && r.path === path)) return '已有同名资源';
  return null;
}

/** 整组资源的体积 / 数量检查，返回错误文案或 null。 */
export function validateResourceBudget(resources: SkillResource[]): string | null {
  if (resources.length > MAX_RESOURCE_COUNT) return `资源数量超过上限（${MAX_RESOURCE_COUNT} 个）`;
  let total = 0;
  for (const r of resources) {
    const n = byteLength(r.content);
    if (n > MAX_RESOURCE_BYTES) return `${r.path} 超过单文件上限（${MAX_RESOURCE_BYTES / 1024} KB）`;
    total += n;
  }
  if (total > MAX_TOTAL_RESOURCE_BYTES) {
    return `资源合计超过上限（${MAX_TOTAL_RESOURCE_BYTES / 1024} KB）`;
  }
  return null;
}

/** 资源路径的目录部分（无目录 = 空串）。 */
export const resourceDir = (path: string) => {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
};

/** 现有资源用到的目录，按出现次数从多到少。 */
export function listResourceDirs(resources: SkillResource[]): string[] {
  const count = new Map<string, number>();
  for (const r of resources) {
    const dir = resourceDir(r.path);
    if (dir) count.set(dir, (count.get(dir) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([dir]) => dir);
}

/**
 * 把用户选的本地文件名 / 手填的简单文件名变成资源路径：去掉可能带的目录、
 * 扩展名统一成 `.md`（`.txt` / `.markdown` 视作 markdown），再拼上目录。
 */
export function buildResourcePath(dir: string, fileName: string): string {
  const base = fileName.replace(/\\/g, '/').split('/').pop()!.trim();
  const stem = base.replace(/\.(md|markdown|txt)$/i, '').trim() || 'untitled';
  const name = `${stem}.md`;
  return dir ? `${dir}/${name}` : name;
}

/** 与现有资源重名时在扩展名前加 `-2`、`-3`…，直到不冲突。 */
export function uniqueResourcePath(path: string, taken: ReadonlySet<string>): string {
  if (!taken.has(path)) return path;
  const stem = path.slice(0, -'.md'.length);
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}.md`;
    if (!taken.has(candidate)) return candidate;
  }
}

export interface ResourceFileNode {
  kind: 'file';
  /** 文件名（路径最后一段） */
  name: string;
  /** 完整资源路径 */
  path: string;
  /** 在 `resources` 数组里的下标 */
  index: number;
}

export interface ResourceDirNode {
  kind: 'dir';
  name: string;
  /** 目录路径；根为空串 */
  path: string;
  children: ResourceTreeNode[];
  /** 该目录（含子目录）下的文件总数 */
  fileCount: number;
}

export type ResourceTreeNode = ResourceFileNode | ResourceDirNode;

/**
 * 把资源路径列表还原成文件树。`extraDirs` 是用户刚建、还没放文件的空目录
 * （资源本身只有路径，空目录不会随 skill 保存，只在编辑界面里存在）。
 * 同级先目录后文件，各自按名字排序，保证渲染稳定。
 */
export function buildResourceTree(
  resources: SkillResource[],
  extraDirs: readonly string[] = [],
): ResourceDirNode {
  const root: ResourceDirNode = { kind: 'dir', name: '', path: '', children: [], fileCount: 0 };
  const ensureDir = (path: string): ResourceDirNode => {
    let cur = root;
    let acc = '';
    for (const seg of path.split('/').filter(Boolean)) {
      acc = acc ? `${acc}/${seg}` : seg;
      let next = cur.children.find((c): c is ResourceDirNode => c.kind === 'dir' && c.name === seg);
      if (!next) {
        next = { kind: 'dir', name: seg, path: acc, children: [], fileCount: 0 };
        cur.children.push(next);
      }
      cur = next;
    }
    return cur;
  };
  resources.forEach((r, index) => {
    const dir = ensureDir(resourceDir(r.path));
    dir.children.push({ kind: 'file', name: r.path.split('/').pop()!, path: r.path, index });
  });
  extraDirs.forEach((d) => ensureDir(d));

  const finish = (dir: ResourceDirNode): number => {
    dir.children.sort((a, b) =>
      a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name.localeCompare(b.name, 'zh'),
    );
    dir.fileCount = dir.children.reduce(
      (n, c) => n + (c.kind === 'dir' ? finish(c) : 1),
      0,
    );
    return dir.fileCount;
  };
  finish(root);
  return root;
}

/** 按路径找树里的目录节点（空串 = 根）；不存在返回 null。 */
export function findResourceDir(root: ResourceDirNode, path: string): ResourceDirNode | null {
  let cur = root;
  for (const seg of path.split('/').filter(Boolean)) {
    const next = cur.children.find((c): c is ResourceDirNode => c.kind === 'dir' && c.name === seg);
    if (!next) return null;
    cur = next;
  }
  return cur;
}

/** 目录路径是否存在于树里（根始终存在）。 */
export function resourceDirExists(root: ResourceDirNode, path: string): boolean {
  return findResourceDir(root, path) !== null;
}

/** 去掉某个文件夹（含子文件夹）下的全部资源，返回剩余的。 */
export function removeResourceDir(resources: SkillResource[], dir: string): SkillResource[] {
  const prefix = `${dir}/`;
  return resources.filter((r) => !r.path.startsWith(prefix));
}
