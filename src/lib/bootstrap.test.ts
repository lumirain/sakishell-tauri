import { beforeEach, describe, it, expect, vi } from 'vitest';
import { hydrateBootstrapData } from '@/lib/bootstrap';
import { useSettingsStore } from '@/stores/settingsStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useSkillStore } from '@/stores/skillStore';

const getBootstrapData = vi.fn();
const getSettings = vi.fn();

vi.mock('@/lib/tauri', () => ({
  getBootstrapData: () => getBootstrapData(),
  getSettings: () => getSettings(),
  getConnections: vi.fn().mockResolvedValue([]),
  getSkills: vi.fn().mockResolvedValue([]),
}));

/**
 * 启动快照是 `hasJevApiKey` 等密钥链状态的**唯一**来源：hydrate 会把 `loaded`
 * 置真，`settingsStore.load()` 随即短路，本会话内再没有别的路径能读到真值。
 * 所以「快照里的字段有没有被转发进 store」必须被测试钉住，而不是靠人眼看
 * `bootstrap.ts` 有没有漏抄一行。
 */
describe('hydrateBootstrapData', () => {
  beforeEach(() => {
    getBootstrapData.mockReset();
    getSettings.mockReset();
    useSettingsStore.setState({
      settings: useSettingsStore.getInitialState().settings,
      loaded: false,
      hasApiKey: false,
      hasWebSearchApiKey: false,
      hasDeepseekToolsApiKey: false,
      hasCustomSearchApiKey: false,
      hasCustomFetchApiKey: false,
      hasTavilyFetchApiKey: false,
      hasJevApiKey: false,
    });
    useConnectionStore.setState({ connections: [], loading: false, loaded: false, error: null });
    useSkillStore.setState({ skills: [], loading: false, error: null });
  });

  it('把快照里的 hasJevApiKey 转发进 store（配了 Key 时不误报未配置）', async () => {
    getBootstrapData.mockResolvedValue({
      settings: useSettingsStore.getInitialState().settings,
      hasApiKey: true,
      hasWebSearchApiKey: true,
      hasDeepseekToolsApiKey: true,
      hasCustomSearchApiKey: true,
      hasCustomFetchApiKey: true,
      hasTavilyFetchApiKey: false,
      hasJevApiKey: true,
      channelKeyStatus: [],
      connections: [],
      skills: [],
    });

    await hydrateBootstrapData();

    const state = useSettingsStore.getState();
    expect(state.hasJevApiKey).toBe(true);
    expect(state.hasWebSearchApiKey).toBe(true);
    // 启动快照是它的唯一来源：漏转发会让设置页把已配的 DeepSeek Key 显示成没配。
    expect(state.hasDeepseekToolsApiKey).toBe(true);
    expect(state.hasCustomSearchApiKey).toBe(true);
    expect(state.hasCustomFetchApiKey).toBe(true);
    // 没走降级路径：快照成功时不该再单独拉一次设置。
    expect(getSettings).not.toHaveBeenCalled();
  });

  it('快照没配 Key 时保持 false', async () => {
    getBootstrapData.mockResolvedValue({
      settings: useSettingsStore.getInitialState().settings,
      hasApiKey: false,
      hasWebSearchApiKey: false,
      hasDeepseekToolsApiKey: false,
      hasCustomSearchApiKey: false,
      hasCustomFetchApiKey: false,
      hasTavilyFetchApiKey: false,
      hasJevApiKey: false,
      channelKeyStatus: [],
      connections: [],
      skills: [],
    });

    await hydrateBootstrapData();

    expect(useSettingsStore.getState().hasJevApiKey).toBe(false);
  });

  it('快照里没有连接时也把连接标成已读回（让界面画空态而不是一直转圈）', async () => {
    getBootstrapData.mockResolvedValue({
      settings: useSettingsStore.getInitialState().settings,
      hasApiKey: false,
      hasWebSearchApiKey: false,
      hasDeepseekToolsApiKey: false,
      hasCustomSearchApiKey: false,
      hasCustomFetchApiKey: false,
      hasTavilyFetchApiKey: false,
      hasJevApiKey: false,
      channelKeyStatus: [],
      connections: [],
      skills: [],
    });

    await hydrateBootstrapData();

    expect(useConnectionStore.getState().loaded).toBe(true);
  });
});
