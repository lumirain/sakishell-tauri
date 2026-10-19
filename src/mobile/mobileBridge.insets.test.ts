// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { syncSystemInsets } from './mobileBridge';

afterEach(() => {
  delete window.AndroidBridge;
  document.documentElement.removeAttribute('style');
});

const root = () => document.documentElement.style;

describe('syncSystemInsets', () => {
  it('页面载入后从原生拉到当前高度，写进两个 CSS 变量', () => {
    window.AndroidBridge = { getInsetBottoms: () => '0px,48px' } as unknown as typeof window.AndroidBridge;
    syncSystemInsets();
    expect(root().getPropertyValue('--ime-bottom')).toBe('0px');
    expect(root().getPropertyValue('--nav-bar-bottom')).toBe('48px');
  });

  it('旧版 APK 没有这个方法 / 非 Android 环境：什么都不写，也不抛', () => {
    expect(() => syncSystemInsets()).not.toThrow();
    window.AndroidBridge = {} as unknown as typeof window.AndroidBridge;
    expect(() => syncSystemInsets()).not.toThrow();
    expect(root().getPropertyValue('--nav-bar-bottom')).toBe('');
  });

  it('原生抛异常：吞掉，不阻塞启动', () => {
    window.AndroidBridge = {
      getInsetBottoms: () => {
        throw new Error('boom');
      },
    } as unknown as typeof window.AndroidBridge;
    expect(() => syncSystemInsets()).not.toThrow();
  });
});
