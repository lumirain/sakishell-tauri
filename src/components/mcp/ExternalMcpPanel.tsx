// 「外部调用」面板：外部 AI 客户端经 MCP 服务执行命令的实时可见视图。
//
// 布局：左侧是连接会话列表（一个连接 = 一个持久会话；点击会话项会像左侧
// 标签一样打开/激活对应连接的 SSH 终端标签页，AI 命令就在那个终端里执行），
// 右侧是选中会话的命令流（命令 + 实时输出 + 状态 + 退出码），底部输入框
// 让你在同一连接上手动补命令（与 AI 的执行同流显示）。
//
// 交互：
// - 每条命令头部有放大按钮：单独把该命令与输出全屏查看（Esc / 按钮还原）；
// - 会话列表与命令流之间可拖拽调节宽度；
// - 会话项右上角终端按钮：直接打开该连接的终端标签页。
//
// 数据源：`stores/externalMcpStore.ts` 订阅 `mcp://external-exec`、
// `mcp://exec-output` 与 `mcp://open-terminal` 事件维护会话状态——
// 本组件纯展示 + 触发「打开终端」，不直接接触后端。

import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, Terminal, X } from "lucide-react";
import {
  useExternalMcpStore,
  openConnectionTerminalById,
  type ExternalExecCommand,
  type ExternalMcpSession,
} from "@/stores/externalMcpStore";
import { useSessionStore } from "@/stores/sessionStore";
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
  onMaximize,
}: {
  cmd: ExternalExecCommand;
  onMaximize: (seq: number) => void;
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
        <button
          type="button"
          onClick={() => onMaximize(cmd.seq)}
          title="放大查看该命令与输出"
          aria-label="放大"
          className="flex-shrink-0 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-700 hover:text-zinc-100"
        >
          <Maximize2 className="h-3 w-3" />
        </button>
      </div>
      {cmd.output.trim().length > 0 && (
        <pre className="px-3 py-2 font-mono text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap break-all overflow-auto max-h-64">
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
  onMaximize,
}: {
  session: ExternalMcpSession;
  onMaximize: (seq: number) => void;
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
        <CommandEntry key={cmd.seq} cmd={cmd} onMaximize={onMaximize} />
      ))}
    </div>
  );
}

export default function ExternalMcpPanel() {
  const sessions = useExternalMcpStore((s) => s.sessions);
  const initEvents = useExternalMcpStore((s) => s.initEvents);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 单条命令放大：只覆盖该命令与输出（Esc / 按钮还原）。
  const [maximizedSeq, setMaximizedSeq] = useState<number | null>(null);
  const [terminalBusyId, setTerminalBusyId] = useState<string | null>(null);
  const [terminalError, setTerminalError] = useState<string | null>(null);

  useEffect(() => {
    initEvents();
  }, [initEvents]);

  useEffect(() => {
    if (maximizedSeq == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMaximizedSeq(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [maximizedSeq]);

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
  const maximizedCmd = selected?.commands.find((c) => c.seq === maximizedSeq) ?? null;
  /** 会话列表宽度（px），可拖拽调节。 */
  const [listWidth, setListWidth] = useState(224);

  /** 像左侧标签一样：激活（或打开）该连接的终端标签页。 */
  const activateTerminal = async (connectionId: string) => {
    const s = useSessionStore.getState();
    const existing = Object.values(s.sessions).find(
      (x) => x.configId === connectionId && x.status === "connected",
    );
    if (existing) {
      s.setActiveSession(existing.id);
      return;
    }
    setTerminalBusyId(connectionId);
    setTerminalError(null);
    try {
      const sessionId = await openConnectionTerminalById(connectionId);
      if (!sessionId) {
        setTerminalError(
          "无法自动打开终端：该连接需要密码或密钥，请先从侧边栏连接一次（凭据会存入密钥链）。",
        );
      }
    } catch {
      setTerminalError("打开终端失败，请尝试从侧边栏手动连接。");
    } finally {
      setTerminalBusyId(null);
    }
  };

  if (ordered.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-zinc-900 px-6 text-center">
        <p className="text-sm font-medium text-zinc-400">暂无外部调用</p>
        <p className="max-w-sm text-xs leading-relaxed text-zinc-500">
          在设置中启用 HTTP MCP 服务后，外部 AI 客户端（如 Claude Code）通过
          <code className="mx-1 rounded bg-zinc-800 px-1 py-0.5 font-mono">ssh_execute</code>
          在已保存连接上执行命令时，命令会在该连接的 SSH 终端标签页里执行，
          并实时显示在这里。
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full bg-zinc-900">
        {/* 会话列表（宽度可拖） */}
        <div
          className="flex flex-shrink-0 flex-col border-r border-zinc-800"
          style={{ width: listWidth }}
        >
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
                  className={`group block w-full rounded-md px-2.5 py-2 text-left transition-colors ${
                    active ? "bg-indigo-600/20" : "hover:bg-zinc-800"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="min-w-0 truncate text-sm font-medium text-zinc-200">
                      {s.connectionName}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="flex-shrink-0 text-[10px] text-zinc-500">
                        {s.commands.length}
                      </span>
                      <span
                        role="button"
                        tabIndex={-1}
                        title="打开该连接的终端标签页"
                        aria-label="打开终端"
                        className={`flex-shrink-0 rounded p-0.5 text-zinc-500 transition-colors ${
                          terminalBusyId === s.connectionId
                            ? "animate-pulse text-indigo-400"
                            : "opacity-0 group-hover:opacity-100 hover:bg-zinc-700 hover:text-zinc-100"
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void activateTerminal(s.connectionId);
                        }}
                      >
                        <Terminal className="h-3.5 w-3.5" />
                      </span>
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
          {terminalError && (
            <p className="border-t border-zinc-800 px-3 py-1.5 text-[11px] text-red-400">
              {terminalError}
            </p>
          )}
        </div>

        {/* 拖拽分隔条 */}
        <div
          role="separator"
          aria-orientation="vertical"
          title="拖拽调节宽度"
          className="group relative w-1 flex-shrink-0 cursor-col-resize bg-zinc-800/60 transition-colors hover:bg-indigo-500/60"
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = listWidth;
            const onMove = (ev: MouseEvent) => {
              setListWidth(
                Math.min(420, Math.max(160, startWidth + (ev.clientX - startX))),
              );
            };
            const onUp = () => {
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
              document.body.style.cursor = "";
              document.body.style.userSelect = "";
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
        />

        {/* 命令流 */}
        <div className="flex min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
                <span className="text-sm font-medium text-zinc-200">
                  {selected.connectionName}
                </span>
                <span className="text-[11px] text-zinc-500">{selected.host}</span>
                <button
                  type="button"
                  onClick={() => void activateTerminal(selected.connectionId)}
                  title="打开该连接的终端标签页"
                  className="ml-2 flex-shrink-0 rounded-md border border-zinc-700 bg-zinc-800/60 p-1 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-100"
                >
                  <Terminal className="h-3.5 w-3.5" />
                </button>
                <span className="ml-auto text-[11px] text-zinc-500">
                  {selected.commands.length} 条命令
                </span>
              </div>
              <SessionStream
                session={selected}
                onMaximize={setMaximizedSeq}
              />
              <SessionInput connectionId={selected.connectionId} />
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-500">
              <p>选择左侧会话查看命令流。</p>
            </div>
          )}
        </div>
      </div>

      {/* 单条命令放大视图（全屏覆盖，Esc / 关闭按钮还原） */}
      {maximizedCmd && (
        <div className="fixed inset-0 z-50 flex flex-col bg-zinc-900">
          <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
            <span
              className={`flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                maximizedCmd.source === "ai"
                  ? "bg-indigo-500/20 text-indigo-300"
                  : "bg-zinc-500/20 text-zinc-300"
              }`}
            >
              {maximizedCmd.source === "ai" ? "AI" : "你"}
            </span>
            <code className="min-w-0 flex-1 truncate font-mono text-sm text-zinc-100">
              {maximizedCmd.command}
            </code>
            <span
              className={`flex-shrink-0 text-[11px] ${STATUS_COLOR[maximizedCmd.status]}`}
            >
              {STATUS_LABEL[maximizedCmd.status]}
            </span>
            <span className="flex-shrink-0 text-[11px] text-zinc-500 tabular-nums">
              {formatTime(maximizedCmd.startedAt)}
            </span>
            <button
              type="button"
              onClick={() => setMaximizedSeq(null)}
              title="还原（Esc）"
              aria-label="还原"
              className="flex-shrink-0 rounded-md border border-zinc-700 bg-zinc-800/60 p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-100"
            >
              <Minimize2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setMaximizedSeq(null)}
              title="关闭"
              aria-label="关闭"
              className="flex-shrink-0 rounded-md border border-zinc-700 bg-zinc-800/60 p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <pre className="flex-1 overflow-auto px-4 py-3 font-mono text-xs leading-relaxed text-zinc-300 whitespace-pre-wrap break-all">
            {maximizedCmd.output}
          </pre>
          <div className="flex items-center gap-3 border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">
            {maximizedCmd.exitCode != null && <span>退出码 {maximizedCmd.exitCode}</span>}
            {maximizedCmd.error && <span className="text-red-400">{maximizedCmd.error}</span>}
            {maximizedCmd.finishedAt && (
              <span className="tabular-nums">
                结束于 {formatTime(maximizedCmd.finishedAt)}
              </span>
            )}
            {maximizedCmd.status === "running" && (
              <span className="animate-pulse">● 运行中</span>
            )}
          </div>
        </div>
      )}
    </>
  );
}
