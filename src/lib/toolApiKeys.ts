import * as tauri from '@/lib/tauri';
import { useSettingsStore } from '@/stores/settingsStore';
import type { WebSearchApiProvider } from './types';

/**
 * 联网工具的 API Key 槽位——桌面与移动端设置页共用这一份，后端 keychain 的槽位与之一一对应。
 *
 * - `search`：Brave / Tavily 的搜索 Key（后端 `web_search_api_key`）。
 * - `deepseek`：DeepSeek 的网页搜索与网页获取共用的 Key（后端 `deepseek_tools_api_key`）。
 * - `custom`：用户自备搜索服务的 Key（后端 `custom_search_api_key`），**可以不填**。
 * - `customFetch`：用户自备网页获取服务的 Key（后端 `custom_fetch_api_key`），**可以不填**；
 *   与 `custom` 分开，两个服务各指向各的地址，共用就是把一个服务的凭据发给另一个。
 * - `tavilyFetch`：Tavily 官方网页提取的 Key（后端 `tavily_fetch_api_key`）。**留空时**后端只在
 *   搜索提供商恰好是 Tavily 时沿用 `search` 槽位的那把——该槽位可能装着 Brave 的 Key，绝不能无条件借。
 *
 * 槽位分开是刻意的：「搜索提供商」与「网页获取方式」是两个互不相干的设置，若共用一份，
 * 选了 Brave 搜索 + DeepSeek 获取的人，Brave 的 Key 会被原样发给 DeepSeek；自定义地址同理，
 * 它的 Key 绝不能是别家官方的 Key，否则切到自定义就等于把官方 Key 交给一个任意主机。
 */
export type ToolApiKeySlot = 'search' | 'deepseek' | 'custom' | 'customFetch' | 'tavilyFetch';

/** 搜索 API 提供商用哪个槽位。与后端 `web_search::search_api_key` 必须一致。 */
export function searchProviderKeySlot(provider: WebSearchApiProvider): ToolApiKeySlot {
  if (provider === 'deepseek') return 'deepseek';
  if (provider === 'custom') return 'custom';
  return 'search';
}

/** 该槽位当前是否已存了 Key（只是布尔，原始 Key 永不回传前端）。 */
export function useHasToolApiKey(slot: ToolApiKeySlot): boolean {
  return useSettingsStore((s) => {
    if (slot === 'deepseek') return s.hasDeepseekToolsApiKey;
    if (slot === 'custom') return s.hasCustomSearchApiKey;
    if (slot === 'customFetch') return s.hasCustomFetchApiKey;
    if (slot === 'tavilyFetch') return s.hasTavilyFetchApiKey;
    return s.hasWebSearchApiKey;
  });
}

/**
 * 保存输入框里的 Key。空白或回显用的掩码占位（`********`）不算输入，原样忽略——
 * 失焦事件会在用户没改任何东西时也触发，不能把掩码写进密钥链。
 * 返回是否真的写入了。
 */
export async function saveToolApiKey(slot: ToolApiKeySlot, raw: string): Promise<boolean> {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes('******')) return false;
  try {
    if (slot === 'deepseek') {
      await tauri.saveDeepseekToolsApiKey(trimmed);
      useSettingsStore.setState({ hasDeepseekToolsApiKey: true });
    } else if (slot === 'customFetch') {
      await tauri.saveCustomFetchApiKey(trimmed);
      useSettingsStore.setState({ hasCustomFetchApiKey: true });
    } else if (slot === 'tavilyFetch') {
      await tauri.saveTavilyFetchApiKey(trimmed);
      useSettingsStore.setState({ hasTavilyFetchApiKey: true });
    } else if (slot === 'custom') {
      await tauri.saveCustomSearchApiKey(trimmed);
      useSettingsStore.setState({ hasCustomSearchApiKey: true });
    } else {
      await tauri.saveWebSearchApiKey(trimmed);
      useSettingsStore.setState({ hasWebSearchApiKey: true });
    }
    return true;
  } catch (err) {
    console.error('保存 API Key 失败:', err);
    return false;
  }
}

/** 清除该槽位的 Key。返回是否真的清除了。 */
export async function clearToolApiKey(slot: ToolApiKeySlot): Promise<boolean> {
  try {
    if (slot === 'deepseek') {
      await tauri.deleteDeepseekToolsApiKey();
      useSettingsStore.setState({ hasDeepseekToolsApiKey: false });
    } else if (slot === 'customFetch') {
      await tauri.deleteCustomFetchApiKey();
      useSettingsStore.setState({ hasCustomFetchApiKey: false });
    } else if (slot === 'tavilyFetch') {
      await tauri.deleteTavilyFetchApiKey();
      useSettingsStore.setState({ hasTavilyFetchApiKey: false });
    } else if (slot === 'custom') {
      await tauri.deleteCustomSearchApiKey();
      useSettingsStore.setState({ hasCustomSearchApiKey: false });
    } else {
      await tauri.deleteWebSearchApiKey();
      useSettingsStore.setState({ hasWebSearchApiKey: false });
    }
    return true;
  } catch (err) {
    console.error('清除 API Key 失败:', err);
    return false;
  }
}
