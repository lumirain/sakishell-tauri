// 外部 MCP 会话的可视化状态。
//
// 外部 AI 客户端（Claude Code 等）经 HTTP MCP 服务调用 `ssh_execute` 时，
// 后端把每条命令的生命周期与实时输出推成两类事件：
//   - `mcp://external-exec`：命令开始 / 结束（含连接、命令、状态、退出码）
//   - `mcp://exec-output`：输出 chunk（`toolCallId = "mcp:{connectionId}:{seq}"`）
//
// 本 store 按连接分组维护**持久会话**（连接在，会话与命令历史就在），
// 与后端的「一个连接一个无头会话」缓存一一对应——这就是「AI 在 GUI 里
// 有一个单独持久连接」的界面侧落点。

import { create } from "zustand";
import { subscribeTauriEvent } from "@/lib/tauriEvent";
import { mcpExternalInput } from "@/lib/tauri";
import { getErrorMessage } from "@/lib/errors";
import type {
  McpExternalExecEvent,
  McpExternalExecChunk,
  McpExecOutput,
} from "@/lib/types";

export type ExternalExecStatus =
  | "running"
  | "completed"
  | "timed_out"
  | "cancelled"
  | "failed";

export interface ExternalExecCommand {
  seq: number;
  command: string;
  /** `external_mcp` → ai，`user` → 你在界面输入 */
  source: "ai" | "user";
  status: ExternalExecStatus;
  output: string;
  exitCode: number | null;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

export interface ExternalMcpSession {
  connectionId: string;
  connectionName: string;
  host: string;
  commands: ExternalExecCommand[];
}

interface ExternalMcpState {
  sessions: Record<string, ExternalMcpSession>;
  /** 事件监听已初始化（幂等）。 */
  ready: boolean;
  initEvents: () => void;
  /** 用户在会话里输入命令 → 同一连接的持久会话执行。 */
  sendInput: (connectionId: string, command: string) => Promise<McpExecOutput>;
  clearSession: (connectionId: string) => void;
}

const EXEC_EVENT = "mcp://external-exec";
const OUTPUT_EVENT = "mcp://exec-output";
const TOOL_CALL_PREFIX = "mcp:";

/** 解析 `mcp:{connectionId}:{seq}`；格式不符返回 null。 */
export function parseToolCallId(toolCallId: string): {
  connectionId: string;
  seq: number;
} | null {
  if (!toolCallId.startsWith(TOOL_CALL_PREFIX)) return null;
  const rest = toolCallId.slice(TOOL_CALL_PREFIX.length);
  const sep = rest.lastIndexOf(":");
  if (sep <= 0) return null;
  const seq = Number(rest.slice(sep + 1));
  if (!Number.isFinite(seq)) return null;
  return { connectionId: rest.slice(0, sep), seq };
}

function sourceOf(raw: "external_mcp" | "user"): ExternalExecCommand["source"] {
  return raw === "user" ? "user" : "ai";
}

function ensureSession(
  sessions: Record<string, ExternalMcpSession>,
  connectionId: string,
  connectionName: string,
  host: string,
): ExternalMcpSession {
  let session = sessions[connectionId];
  if (!session) {
    session = { connectionId, connectionName, host, commands: [] };
    sessions[connectionId] = session;
  }
  // 名称/主机跟随最新事件（连接可能被用户改过名）。
  session.connectionName = connectionName;
  session.host = host;
  return session;
}

/** 幂等初始化事件监听（模块级守卫；组件卸载不销毁——会话历史要跨面板持久）。 */
let eventsInited = false;

export const useExternalMcpStore = create<ExternalMcpState>((set, get) => {
  const initEvents = () => {
    if (eventsInited) return;
    eventsInited = true;

    subscribeTauriEvent<McpExternalExecEvent>(EXEC_EVENT, (payload) => {
      if (payload.phase === "started") {
        set((state) => {
          const sessions = { ...state.sessions };
          const session = ensureSession(
            sessions,
            payload.connectionId,
            payload.connectionName,
            payload.host,
          );
          // 同一连接理论上不会并发跑两条可见命令（exec 通道串行复用），
          // 但防御性地按 seq 去重：重复的 started 不叠新条目。
          if (session.commands.some((c) => c.seq === payload.seq)) {
            return state;
          }
          session.commands = [
            ...session.commands,
            {
              seq: payload.seq,
              command: payload.command,
              source: sourceOf(payload.source),
              status: "running",
              output: "",
              exitCode: null,
              startedAt: payload.startedAt,
            },
          ];
          return { sessions };
        });
      } else {
        set((state) => {
          const session = state.sessions[payload.connectionId];
          if (!session) return state;
          const idx = session.commands.findIndex((c) => c.seq === payload.seq);
          if (idx < 0) return state;
          const commands = [...session.commands];
          commands[idx] = {
            ...commands[idx],
            status: (payload.status ?? "failed") as ExternalExecStatus,
            exitCode: payload.exitCode ?? null,
            finishedAt: payload.finishedAt,
            error: payload.error ?? undefined,
          };
          return {
            sessions: {
              ...state.sessions,
              [payload.connectionId]: { ...session, commands },
            },
          };
        });
      }
    });

    subscribeTauriEvent<McpExternalExecChunk>(OUTPUT_EVENT, (payload) => {
      const target = parseToolCallId(payload.toolCallId);
      if (!target) return;
      set((state) => {
        const session = state.sessions[target.connectionId];
        if (!session) return state;
        const idx = session.commands.findIndex((c) => c.seq === target.seq);
        if (idx < 0) return state;
        const commands = [...session.commands];
        commands[idx] = { ...commands[idx], output: commands[idx].output + payload.chunk };
        return {
          sessions: {
            ...state.sessions,
            [target.connectionId]: { ...session, commands },
          },
        };
      });
    });

    set({ ready: true });
  };

  return {
    sessions: {},
    ready: false,
    initEvents,

    sendInput: async (connectionId, command) => {
      const trimmed = command.trim();
      if (!trimmed) {
        throw new Error("命令不能为空");
      }
      // 后端执行成功与否都会发 started/finished 事件，界面显示统一走事件；
      // 这里只负责把结果回传给调用方（输入框清空 / 报错提示）。
      return mcpExternalInput(connectionId, trimmed);
    },

    clearSession: (connectionId) => {
      set((state) => {
        const sessions = { ...state.sessions };
        delete sessions[connectionId];
        return { sessions };
      });
    },
  };
});

/** 兜底：错误消息可读化（后端文案已是中文，直接透传）。 */
export function externalInputErrorMessage(err: unknown): string {
  return getErrorMessage(err);
}
