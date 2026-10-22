// HTTP 常驻服务的「启动程序时自动开启」偏好持久化。
//
// 后端不保存 bind/port/token（每次启动由前端传入），所以这里用 localStorage
// 记住用户的自启开关与上次使用的监听配置；App 启动时若开关为开，就按这份
// 配置静默拉起服务，失败（端口占用等）不打扰用户。

import { mcpServerStartHttp } from '@/lib/tauri';

const STORAGE_KEY = 'sakishell.mcpHttpAutoStart';

export interface McpHttpSavedConfig {
  autoStart: boolean;
  bind: string;
  port: number;
  token: string;
}

const DEFAULTS: McpHttpSavedConfig = {
  autoStart: false,
  bind: '0.0.0.0',
  port: 8765,
  token: '',
};

export function readMcpHttpSaved(): McpHttpSavedConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<McpHttpSavedConfig>;
    return {
      autoStart: parsed.autoStart === true,
      bind: typeof parsed.bind === 'string' && parsed.bind ? parsed.bind : DEFAULTS.bind,
      port:
        typeof parsed.port === 'number' && Number.isFinite(parsed.port) && parsed.port > 0
          ? parsed.port
          : DEFAULTS.port,
      token: typeof parsed.token === 'string' ? parsed.token : '',
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** 合并写入（只更新传入的字段）。 */
export function writeMcpHttpSaved(patch: Partial<McpHttpSavedConfig>): void {
  const next = { ...readMcpHttpSaved(), ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 存储不可用（隐私模式等）静默忽略：自启只是便利项，不该打断使用
  }
}

/** App 启动时调用：开关为开则静默拉起 HTTP 服务，任何失败都吞掉。 */
export async function autoStartMcpHttpIfEnabled(): Promise<void> {
  const saved = readMcpHttpSaved();
  if (!saved.autoStart) return;
  try {
    await mcpServerStartHttp(saved.bind, saved.port, saved.token || undefined);
  } catch {
    // 端口占用 / 地址非法等：启动时静默失败，用户可在设置里手动处理
  }
}
