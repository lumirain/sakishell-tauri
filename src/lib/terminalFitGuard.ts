/**
 * 终端 fit 的塌缩守卫（桌面终端所有 `fit()` 的唯一入口判据）。
 *
 * 窗口最小化时 WebView 的尺寸会塌成接近 0；`FitAddon` 把负宽度钳到 0 后再按
 * `MINIMUM_COLS = 2` / `MINIMUM_ROWS = 1` 取下限，于是终端被缩成 2 列并经
 * `ssh_resize` 通知远端——shell 在 2 列宽上重绘提示符、缓冲被重排成两字符一行，
 * 恢复窗口后满屏错位字符。尺寸是塌缩造成的假象，不是用户真想要的布局，直接不 fit，
 * 保持最小化之前的行列数；恢复后 ResizeObserver 带着真实尺寸再 fit 一次。
 */

/** 低于它就认定是塌缩：正常的桌面终端区远大于此，用户也不可能拖出这么窄的终端。 */
export const MIN_USABLE_COLS = 8;
export const MIN_USABLE_ROWS = 2;

export function isUsableFitSize(
  dims: { cols: number; rows: number } | undefined | null,
): dims is { cols: number; rows: number } {
  if (!dims) return false;
  if (!Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return false;
  return dims.cols >= MIN_USABLE_COLS && dims.rows >= MIN_USABLE_ROWS;
}
