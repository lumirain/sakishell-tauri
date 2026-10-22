import { Bug, Terminal, Wand, Plug, Settings, Sparkles } from 'lucide-react';
import type { ViewProvider } from '@/lib/types';
import { useViewStore } from '@/stores/viewStore';

const BUILTIN_PLUGIN_ID = 'builtin';

// 注册内置视图。builtin 不会经过 pluginStore 的 disabledPlugins 过滤，因此不可禁用。
// 其中 builtin.terminal(center, order=10) 和 builtin.agent(agent, order=10) 会挤占
// 同 mount 的插件视图（App.tsx 只取 order 最小者），导致插件 center/agent 视图实际无法显示。
export function registerBuiltinViews(): void {
  const store = useViewStore.getState();
  const providers: ViewProvider[] = [
    {
      id: 'builtin.sessions',
      pluginId: BUILTIN_PLUGIN_ID,
      mount: 'sidebar',
      title: '连接',
      icon: { kind: 'react', node: <Terminal className="w-5 h-5" /> },
      navGroup: 'top',
      order: 10,
      component: async () => ({
        default: (await import('@/components/connection/ConnectionList')).default,
      }),
    },
    {
      // AI 工作台入口：左侧竖栏独立图标，点入后左栏显示 AI 终端 + AI 命令记录，
      // 右侧 agent 挂载点切换为外部调用面板（见 App.tsx），智能助手不跟随。
      id: 'builtin.ai',
      pluginId: BUILTIN_PLUGIN_ID,
      mount: 'sidebar',
      title: 'AI',
      icon: { kind: 'react', node: <Sparkles className="w-5 h-5" /> },
      navGroup: 'top',
      order: 15,
      component: async () => ({
        default: (await import('@/components/ai/AiPanel')).default,
      }),
    },
    {
      id: 'builtin.skills',
      pluginId: BUILTIN_PLUGIN_ID,
      mount: 'sidebar',
      title: 'Skill',
      icon: { kind: 'react', node: <Wand className="w-5 h-5" /> },
      navGroup: 'top',
      order: 20,
      component: async () => ({
        default: (await import('@/components/skill/SkillList')).default,
      }),
    },
    {
      id: 'builtin.mcp',
      pluginId: BUILTIN_PLUGIN_ID,
      mount: 'sidebar',
      title: '自定义 MCP',
      icon: { kind: 'react', node: <Plug className="w-5 h-5" /> },
      navGroup: 'top',
      order: 30,
      component: async () => ({
        default: (await import('@/components/mcp/McpList')).default,
      }),
    },
    {
      id: 'builtin.terminal',
      pluginId: BUILTIN_PLUGIN_ID,
      mount: 'center',
      title: '终端',
      icon: { kind: 'react', node: <Terminal className="w-5 h-5" /> },
      order: 10,
      component: async () => ({
        default: (await import('@/components/terminal/Terminal')).default,
      }),
    },
    {
      id: 'builtin.settings',
      pluginId: BUILTIN_PLUGIN_ID,
      mount: 'center',
      title: '设置',
      icon: { kind: 'react', node: <Settings className="w-5 h-5" /> },
      navGroup: 'bottom',
      order: 20,
      exclusive: true,
      component: async () => ({
        default: (await import('@/components/settings/Settings')).default,
      }),
    },
    {
      id: 'builtin.debug',
      pluginId: BUILTIN_PLUGIN_ID,
      mount: 'center',
      title: '调试',
      icon: { kind: 'react', node: <Bug className="w-5 h-5" /> },
      order: 30,
      exclusive: true,
      component: async () => ({
        default: (await import('@/components/debug/DebugPage')).default,
      }),
    },
    {
      // 智能助手：默认右侧 agent 面板。
      id: 'builtin.agent',
      pluginId: BUILTIN_PLUGIN_ID,
      mount: 'agent',
      title: 'Agent',
      icon: { kind: 'react', node: <Wand className="w-5 h-5" /> },
      order: 10,
      component: async () => ({
        default: (await import('@/components/agent/AgentPanel')).default,
      }),
    },
    {
      // 外部调用：仅在 AI 工作台（builtin.ai）激活时由 App.tsx 挂到 agent 面板，
      // 不再与智能助手挤在同一个 tab 里。
      id: 'builtin.external-mcp',
      pluginId: BUILTIN_PLUGIN_ID,
      mount: 'agent',
      title: '外部调用',
      icon: { kind: 'react', node: <Plug className="w-5 h-5" /> },
      order: 5,
      component: async () => ({
        default: (await import('@/components/mcp/ExternalMcpPanel')).default,
      }),
    },
  ];
  for (const p of providers) store.register(p);
}
