// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FILE_MANAGER_PATH_MEMORY_STORAGE_KEY,
  loadRememberedPath,
  readPathMemory,
  rememberPath,
  resolveRememberedPath,
} from './fileManagerPathMemory';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('resolveRememberedPath', () => {
  const empty = { byConnection: {} };

  it('prefers the local record of this connection', () => {
    expect(
      resolveRememberedPath(
        'cfg-1',
        { last: '/last', byConnection: { 'cfg-1': '/local' } },
        { fileManagerPath: '/legacy-last', fileManagerPaths: { 'cfg-1': '/legacy' } },
      ),
    ).toBe('/local');
  });

  it('falls back to the legacy per-connection record when nothing is stored locally', () => {
    expect(
      resolveRememberedPath('cfg-1', empty, {
        fileManagerPath: '/legacy-last',
        fileManagerPaths: { 'cfg-1': '/legacy' },
      }),
    ).toBe('/legacy');
  });

  it('a connection with no record starts from the most recent directory, local before legacy', () => {
    expect(
      resolveRememberedPath(
        'cfg-new',
        { last: '/last', byConnection: {} },
        { fileManagerPath: '/legacy-last', fileManagerPaths: {} },
      ),
    ).toBe('/last');
    expect(
      resolveRememberedPath('cfg-new', empty, { fileManagerPath: '/legacy-last' }),
    ).toBe('/legacy-last');
  });

  it('uses / when there is nothing to go on', () => {
    expect(resolveRememberedPath('cfg-1', empty, {})).toBe('/');
    expect(resolveRememberedPath(null, empty, {})).toBe('/');
  });

  it('ignores blank records instead of restoring an empty path', () => {
    expect(
      resolveRememberedPath(
        'cfg-1',
        { last: '  ', byConnection: { 'cfg-1': '' } },
        { fileManagerPath: '/tmp', fileManagerPaths: { 'cfg-1': '   ' } },
      ),
    ).toBe('/tmp');
  });

  it('without a connection key it still uses the most recent directory', () => {
    expect(
      resolveRememberedPath(null, empty, {
        fileManagerPath: '/home',
        fileManagerPaths: { 'cfg-1': '/var' },
      }),
    ).toBe('/home');
  });
});

describe('rememberPath / loadRememberedPath', () => {
  it('round-trips per connection and keeps the other connections', () => {
    rememberPath('a', '/var/log');
    rememberPath('b', '/etc');
    expect(loadRememberedPath('a', {})).toBe('/var/log');
    expect(loadRememberedPath('b', {})).toBe('/etc');
    // 没有记录的新连接从最近一次开始。
    expect(loadRememberedPath('c', {})).toBe('/etc');
  });

  it('never touches the settings: reading legacy values is read-only', () => {
    const legacy = { fileManagerPath: '/x', fileManagerPaths: { a: '/legacy' } };
    const snapshot = JSON.stringify(legacy);
    expect(loadRememberedPath('a', legacy)).toBe('/legacy');
    rememberPath('a', '/new');
    expect(loadRememberedPath('a', legacy)).toBe('/new');
    expect(JSON.stringify(legacy)).toBe(snapshot);
  });

  it('does not rewrite storage when the path did not change', () => {
    rememberPath('a', '/same');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    rememberPath('a', '/same');
    expect(setItem).not.toHaveBeenCalled();
    rememberPath('a', '/other');
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it('ignores blank paths', () => {
    rememberPath('a', '/keep');
    rememberPath('a', '   ');
    expect(loadRememberedPath('a', {})).toBe('/keep');
  });

  it('without a connection key only the most recent directory is recorded', () => {
    rememberPath(null, '/solo');
    expect(readPathMemory()).toEqual({ last: '/solo', byConnection: {} });
  });

  it('survives corrupted storage and drops only the bad entries', () => {
    localStorage.setItem(FILE_MANAGER_PATH_MEMORY_STORAGE_KEY, '{not json');
    expect(readPathMemory()).toEqual({ byConnection: {} });
    expect(loadRememberedPath('a', { fileManagerPath: '/legacy' })).toBe('/legacy');

    localStorage.setItem(
      FILE_MANAGER_PATH_MEMORY_STORAGE_KEY,
      JSON.stringify({ last: 5, byConnection: { good: '/ok', bad: 7, blank: '' } }),
    );
    expect(readPathMemory()).toEqual({ last: undefined, byConnection: { good: '/ok' } });

    // 写一次就把坏数据覆盖成合法形状。
    rememberPath('a', '/fresh');
    expect(readPathMemory()).toEqual({
      last: '/fresh',
      byConnection: { good: '/ok', a: '/fresh' },
    });
  });

  it('does not throw when localStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => rememberPath('a', '/x')).not.toThrow();
    expect(loadRememberedPath('a', { fileManagerPath: '/legacy' })).toBe('/legacy');
  });
});
