// 「AI 会话」面板：左侧栏切换到 AI 模式后显示的独立窗口。
//
// 界面分两大块：
// 1. **AI 终端**（图一形态）：外部 AI 调用拉起的 SSH 终端连接列表
//    （sessionStore 中 kind="ai" 的会话，标签带 AI 徽标、独立标签组）。
//    点击 → 打开/激活对应终端。
// 2. **AI 命令**（图二形态）：AI 执行过的命令记录列表（外部 AI 会话），
//    用户后续查询。点击 → 打开右侧「外部调用」面板并选中该连接。
//
// 与「已保存的连接」互不挤占：普通连接会话仍在原连接界面管理。

import { useEffect, useMemo, useState } from "react";
import { History, Sparkles } from "lucide-react";
import { useSessionStore } from "@/stores/sessionStore";
import { useConnectionStore } from "@/stores/connectionStore";
import {
  useExternalMcpStore,
  openConnectionTerminalById,
} from "@/stores/externalMcpStore";
import type { Session } from "@/lib/types";

/** 通知右侧 AgentPanel 切到「外部调用」并选中该连接（跨组件解耦）。 */
export function focusExternalMcp(connectionId: string): void {
  window.dispatchEvent(
    new CustomEvent("sakishell:focus-external-mcp", {
      detail: { connectionId },
    }),
  );
}

const STATUS_DOT: Record<Session["status"], string> = {
  connected: "bg-emerald-500",
  connecting: "bg-amber-500 animate-pulse",
  error: "bg-red-500",
  disconnected: "bg-zinc-600",
};

function AiTerminalList() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const connections = useConnectionStore((s) => s.connections);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const aiSessions = useMemo(
    () =>
      Object.values(sessions)
        .filter((s) => s.kind === "ai")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [sessions],
  );

  const nameOf = (s: Session) => {
    const saved = s.configId
      ? connections.find((c) => c.id === s.configId)
      : null;
    return saved?.name || s.connectionId || "未命名";
  };

  /** 点击：已打开则激活；没有则用已保存连接配置打开（AI 徽标终端）。 */
  const handleOpen = async (s: Session) => {
    if (s.status === "connected" || s.status === "connecting") {
      setActiveSession(s.id);
      return;
    }
    if (!s.configId) return;
    setOpening(s.configId);
    setError(null);
    try {
      const sessionId = await openConnectionTerminalById(s.configId);
      if (sessionId) setActiveSession(sessionId);
      else setError("打开失败：需要密码或密钥，请先在「连接」面板连接一次。");
    } catch {
      setError("打开失败，请尝试从「连接」面板手动连接。");
    } finally {
      setOpening(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-zinc-400">
        <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
        AI 终端
        <span className="ml-auto rounded bg-indigo-600/30 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-indigo-300">
          AI
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2 space-y-1">
        {aiSessions.length === 0 ? (
          <p className="px-2 py-3 text-[11px] leading-relaxed text-zinc-500">
            暂无 AI 专属终端。外部 AI 调用执行命令时，会自动在此打开对应连接的
            SSH 终端标签页（连接保持复用）。
          </p>
        ) : (
          aiSessions.map((s) => {
            const active = s.id === activeSessionId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => void handleOpen(s)}
                className={`block w-full rounded-md px-2.5 py-2 text-left transition-colors ${
                  active ? "bg-indigo-600/20" : "hover:bg-zinc-800"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                      STATUS_DOT[s.status]
                    }`}
                  />
                  <span className="flex-shrink-0 rounded bg-indigo-600/30 px-1 py-px text-[8px] font-bold uppercase tracking-wide text-indigo-300">
                    AI
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-200">
                    {nameOf(s)}
                  </span>
                </div>
                <div className="truncate pl-4 text-[11px] text-zinc-500">
                  {s.status === "connected"
                    ? "已连接 · 会话保持复用"
                    : s.status === "connecting"
                      ? "连接中…"
                      : s.status === "error"
                        ? "连接出错，点击重连"
                        : "未连接，点击重连"}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function AiCommandList() {
  const extSessions = useExternalMcpStore((s) => s.sessions);
  const [error, setError] = useState<string | null>(null);

  const ordered = useMemo(
    () =>
      Object.values(extSessions).sort((a, b) => {
        const lastA = a.commands[a.commands.length - 1]?.startedAt ?? 0;
        const lastB = b.commands[b.commands.length - 1]?.startedAt ?? 0;
        return lastB - lastA;
      }),
    [extSessions],
  );

  const lastStatusLabel = (connectionId: string): string => {
    const s = extSessions[connectionId];
    const last = s?.commands[s.commands.length - 1];
    if (!last) return "";
    const labels: Record<string, string> = {
      running: "运行中",
      completed: "完成",
      timed_out: "超时",
      cancelled: "已取消",
      failed: "失败",
    };
    return labels[last.status] ?? "";
  };

  const handleClick = (connectionId: string) => {
    setError(null);
    focusExternalMcp(connectionId);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-zinc-800">
      <div className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-zinc-400">
        <History className="h-3.5 w-3.5 text-indigo-400" />
        AI 命令记录
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-2 space-y-1">
        {ordered.length === 0 ? (
          <p className="px-2 py-3 text-[11px] leading-relaxed text-zinc-500">
            暂无 AI 命令记录。外部 AI 执行过的命令会在此留档，点击可查看完整
            命令与输出。
          </p>
        ) : (
          ordered.map((s) => (
            <button
              key={s.connectionId}
              type="button"
              onClick={() => handleClick(s.connectionId)}
              className="block w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-zinc-800"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="min-w-0 truncate text-sm font-medium text-zinc-200">
                  {s.connectionName}
                </span>
                <span className="flex-shrink-0 text-[10px] text-zinc-500">
                  {s.commands.length} 条
                </span>
              </div>
              <div className="truncate text-[11px] text-zinc-500">
                {s.host}
                {lastStatusLabel(s.connectionId) &&
                  ` · ${lastStatusLabel(s.connectionId)}`}
              </div>
            </button>
          ))
        )}
      </div>
      {error && (
        <p className="border-t border-zinc-800 px-3 py-1.5 text-[11px] text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export default function AiPanel() {
  const initEvents = useExternalMcpStore((s) => s.initEvents);

  useEffect(() => {
    initEvents();
  }, [initEvents]);

  return (
    <div className="flex h-full flex-col bg-zinc-900">
      <div className="px-3 py-2 text-xs font-semibold text-zinc-400">
        AI 会话
        <span className="ml-1.5 rounded bg-indigo-600/30 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-indigo-300">
          AI
        </span>
      </div>
      <AiTerminalList />
      <AiCommandList />
    </div>
  );
}
