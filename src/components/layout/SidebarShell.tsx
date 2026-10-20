// 左侧栏外壳：在「连接」与「AI 会话」两个独立面板间切换。
//
// - 「连接」：已保存的连接管理 + 普通手动 SSH 会话（原 ConnectionList）
// - 「AI 会话」：外部 AI 专用面板（AI 终端连接列表 + AI 命令记录），
//   与已保存的连接互不挤占同一窗口
//
// 顶部标签展示当前模式；AI 面板入口带 AI 徽标。

import { lazy, Suspense, useEffect, useState } from "react";
import { Terminal } from "lucide-react";
import AiPanel from "@/components/ai/AiPanel";
import { useExternalMcpStore } from "@/stores/externalMcpStore";

const ConnectionList = lazy(
  () => import("@/components/connection/ConnectionList"),
);

type SidebarMode = "connections" | "ai";

const STORAGE_KEY = "sakishell.sidebar.mode";

export default function SidebarShell() {
  const initEvents = useExternalMcpStore((s) => s.initEvents);
  const [mode, setMode] = useState<SidebarMode>(() => {
    const saved =
      typeof localStorage === "undefined" ? null : localStorage.getItem(STORAGE_KEY);
    return saved === "ai" ? "ai" : "connections";
  });

  // AI 面板挂载即确保事件监听就绪（open-terminal / exec 事件）
  useEffect(() => {
    if (mode === "ai") initEvents();
  }, [mode, initEvents]);

  const switchMode = (next: SidebarMode) => {
    setMode(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage 不可用时仅本会话有效
    }
  };

  return (
    <div className="flex h-full flex-col bg-zinc-900">
      {/* 模式切换：连接 / AI 会话 */}
      <div className="flex items-center gap-1 border-b border-zinc-800 px-2 pt-1.5 pb-1">
        <button
          type="button"
          onClick={() => switchMode("connections")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
            mode === "connections"
              ? "bg-zinc-800 text-zinc-100"
              : "text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300"
          }`}
        >
          <Terminal className="h-3.5 w-3.5" />
          连接
        </button>
        <button
          type="button"
          onClick={() => switchMode("ai")}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
            mode === "ai"
              ? "bg-indigo-600/25 text-indigo-200"
              : "text-zinc-500 hover:bg-indigo-600/10 hover:text-indigo-300"
          }`}
        >
          <span className="flex-shrink-0 rounded bg-indigo-600/40 px-1 py-px text-[8px] font-bold uppercase tracking-wide text-indigo-200">
            AI
          </span>
          AI 会话
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === "connections" ? (
          <Suspense fallback={<div className="h-full bg-zinc-900" />}>
            <ConnectionList />
          </Suspense>
        ) : (
          <AiPanel />
        )}
      </div>
    </div>
  );
}
