import { useCallback, useEffect, useRef, useState } from 'react';
import * as tauri from '@/lib/tauri';
import { parseAppError } from '@/lib/errors';
import { subscribeTauriEvent } from '@/lib/tauriEvent';

export interface SkillImportProgress {
  received: number;
  /** 0 = 服务端没给总大小 */
  total: number;
  /** 平滑后的下载速度（字节/秒）；样本不足时为 0 */
  speed: number;
}

/** 是不是用户主动取消造成的错误（后端 `AppError::Cancelled`）。 */
export const isCancelledError = (err: unknown) => parseAppError(err).kind === 'Cancelled';

/** 速度采样窗口：至少隔这么久才算一次瞬时速度，避免逐块抖动。 */
const SPEED_WINDOW_MS = 400;
/** 指数平滑系数：越大越跟手，越小越稳。 */
const SPEED_SMOOTHING = 0.3;

/**
 * GitHub 导入 skill 的下载进度 / 取消（桌面与手机共用）。
 *
 * 一次用户操作（拉取，或批量导入多个）对应一个 importId：`begin()` 开始、`end()`
 * 收尾。批量时每个后端调用都带同一个 id；仓库 zip 有后端缓存，第 2 个起不再下载、
 * 也不发进度。`cancel()` 同时置位前端标志，批量循环据 `isCancelled()` 跳出 ——
 * 两次后端调用之间的空档里后端没有可取消的目标。
 *
 * 后端每收到一块数据就发一次事件（一个 zip 可达上千次），这里按帧合并：每帧最多
 * 触发一次渲染，只取最新值。
 */
export function useSkillImportProgress() {
  const [importId, setImportId] = useState<string | null>(null);
  const [progress, setProgress] = useState<SkillImportProgress | null>(null);
  const idRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!importId) return;
    let latest: { received: number; total: number } | null = null;
    let frame: number | null = null;
    let speed = 0;
    let sample: { at: number; received: number } | null = null;

    const flush = () => {
      frame = null;
      if (!latest) return;
      const { received, total } = latest;
      const now = performance.now();
      if (!sample || received < sample.received) {
        // 首个事件，或换了下载线路（已收字节回退）：重新计速
        sample = { at: now, received };
        speed = 0;
      } else if (now - sample.at >= SPEED_WINDOW_MS) {
        const instant = ((received - sample.received) * 1000) / (now - sample.at);
        speed = speed === 0 ? instant : speed + (instant - speed) * SPEED_SMOOTHING;
        sample = { at: now, received };
      }
      setProgress({ received, total, speed });
    };

    const unsubscribe = subscribeTauriEvent<{ importId: string; received: number; total: number }>(
      'skill-import-progress',
      (p) => {
        if (p.importId !== importId) return;
        latest = { received: p.received, total: p.total };
        if (frame === null) frame = requestAnimationFrame(flush);
      },
    );
    return () => {
      unsubscribe();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [importId]);

  const begin = useCallback(() => {
    const id = crypto.randomUUID();
    idRef.current = id;
    cancelledRef.current = false;
    setProgress(null);
    setImportId(id);
    return id;
  }, []);

  const end = useCallback(() => {
    idRef.current = null;
    setImportId(null);
    setProgress(null);
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    const id = idRef.current;
    if (id) void tauri.skillImportCancel(id).catch(() => {});
  }, []);

  const isCancelled = useCallback(() => cancelledRef.current, []);

  return { active: importId !== null, progress, begin, end, cancel, isCancelled };
}
