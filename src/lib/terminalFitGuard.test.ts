import { describe, expect, it } from 'vitest';
import { isUsableFitSize, MIN_USABLE_COLS, MIN_USABLE_ROWS } from './terminalFitGuard';

describe('isUsableFitSize', () => {
  it('正常尺寸放行', () => {
    expect(isUsableFitSize({ cols: 120, rows: 30 })).toBe(true);
    expect(isUsableFitSize({ cols: MIN_USABLE_COLS, rows: MIN_USABLE_ROWS })).toBe(true);
  });

  it('最小化时 FitAddon 给出的 2 列 1 行（issue #21）被拦下', () => {
    expect(isUsableFitSize({ cols: 2, rows: 1 })).toBe(false);
  });

  it('只有一个维度塌缩也拦（窗口只剩一条细缝）', () => {
    expect(isUsableFitSize({ cols: 2, rows: 30 })).toBe(false);
    expect(isUsableFitSize({ cols: 120, rows: 1 })).toBe(false);
  });

  it('proposeDimensions 返回 undefined / NaN 时拦下', () => {
    expect(isUsableFitSize(undefined)).toBe(false);
    expect(isUsableFitSize(null)).toBe(false);
    expect(isUsableFitSize({ cols: NaN, rows: 30 })).toBe(false);
  });
});
