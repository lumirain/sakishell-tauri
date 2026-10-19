import { describe, expect, it } from 'vitest';
import {
  isSyncedBrowserMode,
  resolveMobileFetchMode,
  resolveMobileSearchMode,
  selectMobileFetchMode,
  selectMobileSearchMode,
} from './MobileAgentToolsSection';

describe('resolveMobileSearchMode', () => {
  it('treats browser（桌面同步而来，本机不可用）as html', () => {
    expect(resolveMobileSearchMode('browser')).toBe('html');
    expect(resolveMobileSearchMode('html')).toBe('html');
    expect(resolveMobileSearchMode(undefined)).toBe('html');
  });

  it('keeps api as api', () => {
    expect(resolveMobileSearchMode('api')).toBe('api');
  });
});

describe('isSyncedBrowserMode', () => {
  it('detects browser values synced from desktop', () => {
    expect(isSyncedBrowserMode('browser')).toBe(true);
    expect(isSyncedBrowserMode('html')).toBe(false);
    expect(isSyncedBrowserMode('api')).toBe(false);
    expect(isSyncedBrowserMode(undefined)).toBe(false);
  });
});

describe('selectMobileSearchMode', () => {
  it('selecting api always writes api', () => {
    expect(selectMobileSearchMode('browser', 'api')).toEqual({ webSearchMode: 'api' });
    expect(selectMobileSearchMode('html', 'api')).toEqual({ webSearchMode: 'api' });
    expect(selectMobileSearchMode('api', 'api')).toEqual({ webSearchMode: 'api' });
  });

  it('selecting html only rewrites when stored is api', () => {
    expect(selectMobileSearchMode('api', 'html')).toEqual({ webSearchMode: 'html' });
  });

  it('selecting html keeps synced browser value untouched (no cloud overwrite)', () => {
    expect(selectMobileSearchMode('browser', 'html')).toEqual({});
    expect(selectMobileSearchMode('html', 'html')).toEqual({});
    expect(selectMobileSearchMode(undefined, 'html')).toEqual({});
  });
});

describe('resolveMobileFetchMode', () => {
  it('treats browser（桌面同步而来，本机不可用）as html', () => {
    expect(resolveMobileFetchMode('browser')).toBe('html');
    expect(resolveMobileFetchMode('html')).toBe('html');
    expect(resolveMobileFetchMode(undefined)).toBe('html');
  });

  it('keeps deepseek, which is plain HTTP and works on a phone', () => {
    expect(resolveMobileFetchMode('deepseek')).toBe('deepseek');
  });

  it('keeps custom, which is plain HTTP too', () => {
    expect(resolveMobileFetchMode('custom')).toBe('custom');
  });

  it('keeps tavily, which is plain HTTP too', () => {
    expect(resolveMobileFetchMode('tavily')).toBe('tavily');
  });
});

describe('selectMobileFetchMode', () => {
  it('selecting deepseek always writes deepseek', () => {
    expect(selectMobileFetchMode('browser', 'deepseek')).toEqual({ httpFetchMode: 'deepseek' });
    expect(selectMobileFetchMode('html', 'deepseek')).toEqual({ httpFetchMode: 'deepseek' });
    expect(selectMobileFetchMode(undefined, 'deepseek')).toEqual({ httpFetchMode: 'deepseek' });
  });

  it('selecting custom always writes custom', () => {
    expect(selectMobileFetchMode('browser', 'custom')).toEqual({ httpFetchMode: 'custom' });
    expect(selectMobileFetchMode('deepseek', 'custom')).toEqual({ httpFetchMode: 'custom' });
    expect(selectMobileFetchMode(undefined, 'custom')).toEqual({ httpFetchMode: 'custom' });
  });

  it('selecting tavily always writes tavily', () => {
    expect(selectMobileFetchMode('browser', 'tavily')).toEqual({ httpFetchMode: 'tavily' });
    expect(selectMobileFetchMode('custom', 'tavily')).toEqual({ httpFetchMode: 'tavily' });
    expect(selectMobileFetchMode(undefined, 'tavily')).toEqual({ httpFetchMode: 'tavily' });
  });

  it('selecting html only rewrites when stored is a server-side fetch (deepseek / tavily / custom)', () => {
    expect(selectMobileFetchMode('deepseek', 'html')).toEqual({ httpFetchMode: 'html' });
    expect(selectMobileFetchMode('tavily', 'html')).toEqual({ httpFetchMode: 'html' });
    expect(selectMobileFetchMode('custom', 'html')).toEqual({ httpFetchMode: 'html' });
  });

  it('selecting html keeps a synced browser value untouched (no cloud overwrite)', () => {
    expect(selectMobileFetchMode('browser', 'html')).toEqual({});
    expect(selectMobileFetchMode('html', 'html')).toEqual({});
    expect(selectMobileFetchMode(undefined, 'html')).toEqual({});
  });
});
