// 「外部调用」面板：外部 AI 客户端经 MCP 服务执行命令的实时可见视图。
//
// 布局：左侧是连接会话列表（一个连接 = 一个持久会话，对应后端无头会话缓存），
// 右侧是选中会话的命令流（命令 + 实时输出 + 状态 + 退出码），底部输入框
// 让你在同一连接上手动补命令（与 AI 的执行同流显示）。
//
// 数据源：`stores/externalMcpStore.ts` 订阅 `mcp://external-exec` 与
// `mcp://exec-output` 事件维护会话状态——本组件纯展示，不直接接触后端。

import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import {
  useExternalMcpStore,
  type ExternalExecCommand,
  type ExternalMcpSession,
} from "@/stores/externalMcpStore";
import { getErrorMessage } from "@/lib/errors";

const STATUS_LABEL: Record<ExternalExecCommand["status"], string> = {
  running: "运行中",
  completed: "完成",
  timed_out: "超时",
  cancelled: "已取消",
  failed: "失败",
};

const STATUS_COLOR: Record<ExternalExecCommand["status"], string> = {
  running: "text-sky-400",
  completed: "text-emerald-400",
  timed_out: "text-amber-400",
  cancelled: "text-zinc-400",
  failed: "text-red-400",
};

function formatTime(millis: number): string {
  if (!millis) return "";
  const d = new Date(millis);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function CommandEntry({
  cmd,
  maximized,
}: {
  cmd: ExternalExecCommand;
  maximized: boolean;
}) {
  const running = cmd.status === "running";
  return (
    <div className="rounded-md border border-zinc-700/60 bg-zinc-800/40">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-700/40">
        <span
          className={`flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
            cmd.source === "ai"
              ? "bg-indigo-500/20 text-indigo-300"
              : "bg-zinc-500/20 text-zinc-300"
          }`}
        >
          {cmd.source === "ai" ? "AI" : "你"}
        </span>
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-100">
          {cmd.command}
        </code>
        <span className={`flex-shrink-0 text-[10px] ${STATUS_COLOR[cmd.status]}`}>
          {STATUS_LABEL[cmd.status]}
        </span>
        <span className="flex-shrink-0 text-[10px] text-zinc-500 tabular-nums">
          {formatTime(cmd.startedAt)}
        </span>
      </div>
      {cmd.output.trim().length > 0 && (
        <pre
          className={`px-3 py-2 font-mono text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap break-all overflow-auto ${
            maximized ? "max-h-[70vh]" : "max-h-64"
          }`}
        >
          {cmd.output}
        </pre>
      )}
      {(cmd.finishedAt || cmd.exitCode != null || cmd.error) && (
        <div className="flex items-center gap-2 px-3 py-1 text-[10px] text-zinc-500 border-t border-zinc-700/40">
          {cmd.exitCode != null && <span>退出码 {cmd.exitCode}</span>}
          {cmd.error && <span className="text-red-400">{cmd.error}</span>}
          {cmd.finishedAt && (
            <span className="ml-auto tabular-nums">{formatTime(cmd.finishedAt)}</span>
          )}
          {running && <span className="ml-auto animate-pulse">●</span>}
        </div>
      )}
    </div>
  );
}

function SessionInput({ connectionId }: { connectionId: string }) {
  const sendInput = useExternalMcpStore((s) => s.sendInput);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sendInput(connectionId, trimmed);
      setValue("");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-zinc-800 px-3 py-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="在此输入命令，将在同一连接上执行（对 AI 可见）"
          className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-indigo-500 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !value.trim()}
          className="flex-shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          {busy ? "执行中…" : "执行"}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}

function SessionStream({
  session,
  maximized,
}: {
  session: ExternalMcpSession;
  maximized: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const lastRunning = session.commands.some((c) => c.status === "running");

  // 用户滚离底部时暂停跟随；滚回底部恢复。
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = dist < 24;
  };

  useEffect(() => {
    if (lastRunning && stickToBottomRef.current) {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [session.commands, lastRunning]);

  if (session.commands.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        <p>该连接还没有外部调用记录。外部 AI 在此连接上执行命令后会显示在这里。</p>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-auto px-3 py-3 space-y-2"
    >
      {session.commands.map((cmd) => (
        <CommandEntry key={cmd.seq} cmd={cmd} maximized={maximized} />
      ))}
    </div>
  );
}

export default function ExternalMcpPanel() {
  const sessions = useExternalMcpStore((s) => s.sessions);
  const initEvents = useExternalMcpStore((s) => s.initEvents);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 最大化：覆盖整个应用窗口查看命令与输出，Esc / 按钮还原。 */
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    initEvents();
  }, [initEvents]);

  useEffect(() => {
    if (!maximized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMaximized(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximized]);

  // 会话按最后活动时间排序；默认选中最近的一个。
  const ordered = useMemo(
    () =>
      Object.values(sessions).sort((a, b) => {
        const lastA = a.commands[a.commands.length - 1]?.startedAt ?? 0;
        const lastB = b.commands[b.commands.length - 1]?.startedAt ?? 0;
        return lastB - lastA;
      }),
    [sessions],
  );

  useEffect(() => {
    if (selectedId && !sessions[selectedId]) {
      setSelectedId(null);
    }
    if (!selectedId && ordered.length > 0) {
      setSelectedId(ordered[0].connectionId);
    }
  }, [selectedId, sessions, ordered]);

  const selected = selectedId ? sessions[selectedId] : null;

  if (ordered.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-zinc-900 px-6 text-center">
        <p className="text-sm font-medium text-zinc-400">暂无外部调用</p>
        <p className="max-w-sm text-xs leading-relaxed text-zinc-500">
          在设置中启用 HTTP MCP 服务后，外部 AI 客户端（如 Claude Code）通过
          <code className="mx-1 rounded bg-zinc-800 px-1 py-0.5 font-mono">ssh_execute</code>
          在已保存连接上执行命令时，命令与输出会实时显示在这里。
        </p>
      </div>
    );
  }

  return (
    <div
      className={`flex bg-zinc-900 ${
        maximized ? "fixed inset-0 z-50" : "h-full"
      }`}
    >
      {/* 会话列表 */}
      <div className="flex w-56 flex-shrink-0 flex-col border-r border-zinc-800">
        <div className="px-3 py-2 text-xs font-semibold text-zinc-400">外部 AI 会话</div>
        <div className="flex-1 overflow-auto px-2 pb-2 space-y-1">
          {ordered.map((s) => {
            const last = s.commands[s.commands.length - 1];
            const active = s.connectionId === selectedId;
            return (
              <button
                key={s.connectionId}
                type="button"
                onClick={() => setSelectedId(s.connectionId)}
                className={`block w-full rounded-md px-2.5 py-2 text-left transition-colors ${
                  active ? "bg-indigo-600/20" : "hover:bg-zinc-800"
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="min-w-0 truncate text-sm font-medium text-zinc-200">
                    {s.connectionName}
                  </span>
                  <span className="flex-shrink-0 text-[10px] text-zinc-500">
                    {s.commands.length}
                  </span>
                </div>
                <div className="truncate text-[11px] text-zinc-500">
                  {s.host}
                  {last && ` · ${STATUS_LABEL[last.status]}`}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* 命令流 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <>
            <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
              <span className="text-sm font-medium text-zinc-200">
                {selected.connectionName}
              </span>
              <span className="text-[11px] text-zinc-500">{selected.host}</span>
              <span className="ml-auto text-[11px] text-zinc-500">
                {selected.commands.length} 条命令
              </span>
              <button
                type="button"
                onClick={() => setMaximized((v) => !v)}
                title={maximized ? "还原（Esc）" : "最大化"}
                aria-label={maximized ? "还原" : "最大化"}
                className="flex-shrink-0 rounded-md border border-zinc-700 bg-zinc-800/60 p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-100"
              >
                {maximized ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <SessionStream session={selected} maximized={maximized} />
            <SessionInput connectionId={selected.connectionId} />
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            <p>选择左侧会话查看命令流。</p>
          </div>
        )}
      </div>
    </div>
  );
}
