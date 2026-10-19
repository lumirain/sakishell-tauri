import { create } from "zustand";

/**
 * 「至尊无敌特效」的本机状态：是否已解锁（关于页图标连点彩蛋）、是否开启。
 *
 * 只存在本机 localStorage，不进后端 AppSettings —— 这是纯展示性偏好，没有任何需要
 * 跨进程、跨设备同步的东西（与 debugStore 同一套路）。存储不可用时退化为仅本次运行有效。
 */

const UNLOCKED_KEY = "marcel.supremeEffects.unlocked";
const ENABLED_KEY = "marcel.supremeEffects.enabled";

function readFlag(key: string): boolean {
  try {
    return globalThis.localStorage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    if (on) globalThis.localStorage?.setItem(key, "1");
    else globalThis.localStorage?.removeItem(key);
  } catch {
    // 隐私模式的 WebView 可能禁用存储；内存里的开关照常工作
  }
}

interface SupremeEffectsState {
  unlocked: boolean;
  enabled: boolean;
  /** 解锁资格（幂等）。不会自动打开开关：开不开是用户的事。 */
  unlock: () => void;
  /** 未解锁时忽略：开关本来就不该出现在界面上。 */
  setEnabled: (enabled: boolean) => void;
}

export const useSupremeEffectsStore = create<SupremeEffectsState>((set, get) => ({
  unlocked: readFlag(UNLOCKED_KEY),
  // 读取时就与 unlocked 对齐：手改 localStorage 造出「没解锁却开着」的状态也不会生效
  enabled: readFlag(UNLOCKED_KEY) && readFlag(ENABLED_KEY),
  unlock: () => {
    if (get().unlocked) return;
    writeFlag(UNLOCKED_KEY, true);
    set({ unlocked: true });
  },
  setEnabled: (enabled) => {
    if (!get().unlocked) return;
    writeFlag(ENABLED_KEY, enabled);
    set({ enabled });
  },
}));

/** 输入框特效现在是否应该放（非 React 场景直接读，不订阅）。 */
export function isSupremeTypingActive(): boolean {
  const { unlocked, enabled } = useSupremeEffectsStore.getState();
  return unlocked && enabled;
}
