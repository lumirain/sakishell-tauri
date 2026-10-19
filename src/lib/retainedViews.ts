/**
 * 手机端对话列表里最多同时保持挂载的专属 view（交互可视化 iframe）个数。
 *
 * 每个 iframe 是一份完整的页面（脚本、画布、图表库），逛过的永不卸载在桌面上
 * 可以接受，手机上翻几十轮对话就会把内存吃光。超出后最久没看的会卸载，
 * 滚回去时重建（高度由列表的 view 缓存记住，不会跳）。
 */
export const MOBILE_MAX_RETAINED_VIEWS = 4;

/**
 * 记下刚被看到的专属 view，返回新的保留集合。
 *
 * - `limit` 为空：不设上限，只追加（桌面行为，顺序无意义，已有则原样返回）。
 * - 有上限：按「最近一次挂载」排序，超出时丢掉最久的。集合保持插入顺序，
 *   最旧的在最前面。
 */
export function retainRecent(
  old: ReadonlySet<string>,
  key: string,
  limit?: number,
): ReadonlySet<string> {
  if (limit === undefined) return old.has(key) ? old : new Set([...old, key]);
  let newest: string | undefined;
  for (const item of old) newest = item;
  if (newest === key && old.size <= limit) return old;
  const next = new Set(old);
  next.delete(key);
  next.add(key);
  for (const item of next) {
    if (next.size <= limit) break;
    next.delete(item);
  }
  return next;
}
