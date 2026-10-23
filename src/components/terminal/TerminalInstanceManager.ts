import { Terminal as XTerm, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { subscribeTauriEvent, type Unsubscribe } from '@/lib/tauriEvent';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { sshSendInput, sshResize } from '@/lib/tauri';
import { DEFAULT_TERMINAL_COLORS } from '@/lib/constants';
import { resolveTerminalColors } from '@/lib/terminalTheme';
import { openExternalLink } from '@/lib/externalLinks';
import { buildTerminalFontFamily, onBundledNerdFontReady } from '@/lib/terminalFont';
import { isUsableFitSize } from '@/lib/terminalFitGuard';
import {
  attachAltScreenTouchScroll,
  createRemoteScrollForwarder,
} from '@/lib/terminalScrollGesture';
import {
  HIBERNATE_SWEEP_MS,
  PENDING_WAKE_CHARS,
  PendingOutput,
  packSnapshot,
  shouldHibernate,
  unpackSnapshot,
  type PackedSnapshot,
} from '@/lib/terminalHibernation';
import { useSettingsStore } from '@/stores/settingsStore';
import { attachClickLocate } from './terminalClickLocate';
import { DEBUG_SERVER_PROMPT, isDebugSession } from '@/lib/debugServer';

/**
 * 休眠中的终端。xterm 实例已释放，整份缓冲（含颜色与回滚）以序列化快照的形式
 * 留在内存里；休眠期间到达的输出排在 `pending`，唤醒时接在快照之后写回。
 */
interface SleepState {
  cols: number;
  rows: number;
  /**
   * 休眠前视口顶端的缓冲行号。`null` = 本来就贴着底部（还原后自然跟随新输出）。
   * 用户滚上去看历史时记下它，唤醒后滚回同一处。
   */
  viewportY: number | null;
  pending: PendingOutput;
  /** 序列化文本；gzip 完成前用它，完成后置 null。 */
  text: string | null;
  packed: PackedSnapshot | null;
}

export interface TerminalInstance {
  id: string;
  /** 休眠时为 null；任何访问前先判空，或先 `wake`。 */
  terminal: XTerm | null;
  fitAddon: FitAddon | null;
  serializeAddon: SerializeAddon | null;
  container: HTMLDivElement;
  lastResize?: { cols: number; rows: number };
  unlistenOutput?: Unsubscribe;
  onDataDisposable?: { dispose: () => void };
  webglAddon?: WebglAddon;
  webglContextLossDisposable?: { dispose: () => void };
  /** 与 xterm 实例无关、随容器存在的监听（右键粘贴、点击聚焦）。 */
  domListeners: Array<() => void>;
  /** 绑在当前 xterm 实例上的监听；休眠释放实例时一并撤掉，唤醒重建时重装。 */
  mountDisposers: Array<() => void>;
  /** Prevents duplicate disconnect banners for the same session lifecycle. */
  disconnectBannerShown?: boolean;
  /** 输入是否被禁用的唯一来源；xterm 实例重建时据此恢复。 */
  stdinDisabled: boolean;
  visible: boolean;
  hiddenSince: number;
  lastActivityAt: number;
  sleep: SleepState | null;
  /** 正在进行的休眠冻结流程；唤醒要先等它落定。 */
  hibernating: Promise<boolean> | null;
  waking: Promise<void> | null;
}

export type PasteConfirmCallback = (text: string, sessionId: string) => void;
export type CopyCallback = (terminal: XTerm) => void;
export type PasteConfirmState = { text: string; sessionId: string } | null;
export type PasteConfirmListener = (confirm: PasteConfirmState) => void;

export interface TerminalAppearance {
  fontSize: number;
  fontFamily: string;
  theme: ITheme;
}

/** 冻结流程等待 xterm 解析完积压写入的上限；超时就放弃这次休眠。 */
const FLUSH_TIMEOUT_MS = 1500;

class TerminalInstanceManager {
  private instances = new Map<string, TerminalInstance>();
  private copyCallback: CopyCallback | null = null;
  private pasteConfirm: PasteConfirmState = null;
  private pasteConfirmListeners: PasteConfirmListener[] = [];
  private appearance: TerminalAppearance | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  setCopyCallback(callback: CopyCallback | null) {
    this.copyCallback = callback;
  }

  getPasteConfirm(): PasteConfirmState {
    return this.pasteConfirm;
  }

  setPasteConfirm(confirm: PasteConfirmState) {
    this.pasteConfirm = confirm;
    for (const listener of this.pasteConfirmListeners) {
      listener(confirm);
    }
  }

  onPasteConfirmChange(listener: PasteConfirmListener): () => void {
    this.pasteConfirmListeners.push(listener);
    return () => {
      const index = this.pasteConfirmListeners.indexOf(listener);
      if (index >= 0) {
        this.pasteConfirmListeners.splice(index, 1);
      }
    };
  }

  /**
   * 当前生效的外观（字号 / 字体栈 / 配色）。组件层把预览与调试主题叠加后的最终值
   * 经 `applyAppearance` 交进来；休眠后重建的终端必须用它，而不是只读设置存档。
   */
  private currentAppearance(): TerminalAppearance {
    if (this.appearance) return this.appearance;
    const settings = useSettingsStore.getState().settings;
    return {
      fontSize: settings.fontSize,
      fontFamily: buildTerminalFontFamily(settings.fontFamily),
      theme: resolveTerminalColors(settings.terminalColors ?? DEFAULT_TERMINAL_COLORS),
    };
  }

  applyAppearance(next: TerminalAppearance) {
    this.appearance = next;
    for (const instance of this.instances.values()) {
      const terminal = instance.terminal;
      if (!terminal) continue;
      terminal.options.fontSize = next.fontSize;
      terminal.options.fontFamily = next.fontFamily;
      terminal.options.theme = next.theme;
    }
  }

  create(sessionId: string): TerminalInstance {
    const container = document.createElement('div');
    container.className = 'absolute inset-0 p-1 cursor-text';
    container.style.display = 'none';

    const now = Date.now();
    const instance: TerminalInstance = {
      id: sessionId,
      terminal: null,
      fitAddon: null,
      serializeAddon: null,
      container,
      domListeners: [],
      mountDisposers: [],
      stdinDisabled: false,
      visible: false,
      hiddenSince: now,
      lastActivityAt: now,
      sleep: null,
      hibernating: null,
      waking: null,
    };

    const terminal = this.mountTerminal(instance);

    // Virtual sessions keep the regular renderer and font handling, but have no
    // input handlers or subscriptions to a remote connection.
    if (isDebugSession(sessionId)) {
      terminal.options.disableStdin = true;
      instance.stdinDisabled = true;
      terminal.write(DEBUG_SERVER_PROMPT);
      this.instances.set(sessionId, instance);
      return instance;
    }

    // Right-click paste
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      readText()
        .then((text) => {
          if (!text) return;
          if (text.includes('\n') || text.includes('\r')) {
            this.setPasteConfirm({ text, sessionId });
          } else {
            return sshSendInput(sessionId, text);
          }
        })
        .catch((err) => {
          console.error('Failed to paste from clipboard:', err);
        });
    };
    container.addEventListener('contextmenu', handleContextMenu);
    instance.domListeners.push(() =>
      container.removeEventListener('contextmenu', handleContextMenu),
    );

    // SSH output listener。订阅原语的取消函数是**同步**返回的，所以 destroy()
    // 一定拿得到它；旧写法在 `await listen` 之后才赋值给 instance，destroy 早于
    // resolve（切标签页切得够快就会发生）时这条监听就没人生效回收。
    // 订阅跟着容器走、不跟着 xterm 实例走：休眠期间输出照样收，只是排队不解析。
    instance.unlistenOutput = subscribeTauriEvent<string>(
      `ssh://output/${sessionId}`,
      (payload) => this.deliver(instance, payload),
    );

    // Focus on click
    const handleClick = () => instance.terminal?.focus();
    container.addEventListener('mousedown', handleClick);
    instance.domListeners.push(() =>
      container.removeEventListener('mousedown', handleClick),
    );

    this.instances.set(sessionId, instance);
    this.ensureSweeper();
    return instance;
  }

  /**
   * 建一个 xterm 实例并挂上全部"绑在实例上"的东西（渲染器、输入、点击定位、
   * 触摸滚动）。`create` 和唤醒共用，保证休眠前后行为一致。
   */
  private mountTerminal(
    instance: TerminalInstance,
    geometry?: { cols: number; rows: number },
  ): XTerm {
    const sessionId = instance.id;
    const { container } = instance;
    const appearance = this.currentAppearance();

    const terminal = new XTerm({
      theme: appearance.theme,
      fontSize: appearance.fontSize,
      fontFamily: appearance.fontFamily,
      cursorBlink: true,
      cursorStyle: 'block',
      allowProposedApi: true,
      scrollback: 10000,
      ...(geometry ?? {}),
    });

    const fitAddon = new FitAddon();
    const serializeAddon = new SerializeAddon();
    const webLinksAddon = new WebLinksAddon((_event, uri) => openExternalLink(uri));

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(serializeAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(container);

    instance.terminal = terminal;
    instance.fitAddon = fitAddon;
    instance.serializeAddon = serializeAddon;
    terminal.options.disableStdin = isDebugSession(sessionId) || instance.stdinDisabled;

    // WebGL renderer (GPU); fall back to Canvas 2D if context unavailable.
    this.installWebgl(instance, terminal);

    // 内置 Nerd Font 是异步加载的。万一首个图标在它就绪前就被栅格化，缺字会被缓存进
    // 纹理图集，之后一直显示不出图标；就绪后清一次图集并重绘，用正确字形重新栅格化。
    instance.mountDisposers.push(
      onBundledNerdFontReady(() => {
        if (instance.terminal !== terminal) return;
        instance.webglAddon?.clearTextureAtlas();
        terminal.refresh(0, terminal.rows - 1);
      }),
    );

    if (isDebugSession(sessionId)) return terminal;

    // SSH input
    const onDataDisposable = terminal.onData((data: string) => {
      sshSendInput(sessionId, data).catch((err) => {
        console.error('Failed to send input:', err);
      });
    });
    instance.onDataDisposable = onDataDisposable;

    // Windows Ctrl+C copy (only intercept when selection exists, otherwise pass through to SSH)
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent): boolean => {
      if (
        event.type === 'keydown' &&
        event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        (event.key === 'c' || event.key === 'C')
      ) {
        if (terminal.hasSelection()) {
          this.copyCallback?.(terminal);
          return false;
        }
      }
      return true;
    });

    // Click-to-locate: same semantics as the mobile tap — move the remote
    // shell cursor to the clicked cell when it is on the cursor's screen row.
    // Skipped when the app enabled mouse tracking (vim/htop/tmux handle the
    // click via xterm's mouse protocol) and for drags (text selection).
    const clickLocate = attachClickLocate({
      container,
      getTerminal: () => instance.terminal,
      onLocate: (seq) => {
        sshSendInput(sessionId, seq).catch((err) => {
          console.error('Failed to send input:', err);
        });
      },
    });
    instance.mountDisposers.push(() => clickLocate.dispose());

    // Touch screens (Windows 平板等)：备用屏幕（tmux / vim / less）里 xterm 自己的
    // 触摸路径空转——那里没有回滚缓冲。把这个手势转发成远端认得的滚轮 / 方向键，
    // 与移动端同一条通路。普通缓冲不接管（xterm 原生 follow-finger 照旧）。
    const remoteScroll = createRemoteScrollForwarder(() => instance.terminal);
    const altScreenTouchScroll = attachAltScreenTouchScroll({
      container,
      getTerminal: () => instance.terminal,
      forward: remoteScroll.forward,
    });
    instance.mountDisposers.push(() => altScreenTouchScroll.dispose());

    return terminal;
  }

  /** 撤掉绑在当前 xterm 实例上的一切并释放它（含 WebGL 上下文）。 */
  private unmountTerminal(instance: TerminalInstance) {
    for (const off of instance.mountDisposers) {
      try {
        off();
      } catch (err) {
        console.error('Failed to detach listener:', err);
      }
    }
    instance.mountDisposers.length = 0;

    instance.onDataDisposable?.dispose();
    instance.onDataDisposable = undefined;

    if (instance.webglContextLossDisposable) {
      try {
        instance.webglContextLossDisposable.dispose();
      } catch {
        // ignore
      }
      instance.webglContextLossDisposable = undefined;
    }
    if (instance.webglAddon) {
      try {
        instance.webglAddon.dispose();
      } catch {
        // ignore
      }
      instance.webglAddon = undefined;
    }

    const terminal = instance.terminal;
    instance.terminal = null;
    instance.fitAddon = null;
    instance.serializeAddon = null;
    try {
      terminal?.dispose();
    } catch {
      // already disposed
    }
    // xterm 会清掉它自己的节点，但容器本身要留着：监听和挂载位置都在它上面。
    instance.container.replaceChildren();
  }

  /** 收到一段远端输出：醒着就写进 xterm，休眠中就排队。 */
  private deliver(instance: TerminalInstance, text: string) {
    instance.lastActivityAt = Date.now();
    const sleep = instance.sleep;
    if (sleep) {
      sleep.pending.push(text);
      if (sleep.pending.chars > PENDING_WAKE_CHARS) {
        void this.wake(instance.id);
      }
      return;
    }
    instance.terminal?.write(text);
  }

  get(sessionId: string): TerminalInstance | undefined {
    return this.instances.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.instances.has(sessionId);
  }

  isDormant(sessionId: string): boolean {
    return this.instances.get(sessionId)?.sleep != null;
  }

  attach(sessionId: string, wrapper: HTMLDivElement) {
    const instance = this.instances.get(sessionId);
    if (!instance) return;
    if (instance.container.parentElement !== wrapper) {
      wrapper.appendChild(instance.container);
    }
  }

  detach(sessionId: string) {
    const instance = this.instances.get(sessionId);
    if (!instance) return;
    instance.container.style.display = 'none';
    if (instance.container.parentElement) {
      instance.container.parentElement.removeChild(instance.container);
    }
  }

  /**
   * 显示 / 隐藏。显示一个休眠中的终端会自动唤醒它——任何路径把它亮出来都不会看到
   * 空白；调用方需要在唤醒完成后 fit / 聚焦时，再 `await wake(id)`。
   */
  setVisible(sessionId: string, visible: boolean) {
    const instance = this.instances.get(sessionId);
    if (!instance) return;
    if (instance.visible && !visible) instance.hiddenSince = Date.now();
    instance.visible = visible;
    instance.container.style.display = visible ? 'block' : 'none';
    if (visible && instance.sleep) void this.wake(sessionId);
  }

  resizeRemoteIfChanged(instance: TerminalInstance) {
    if (isDebugSession(instance.id)) return;
    const terminal = instance.terminal;
    if (!terminal) return;
    const cols = terminal.cols;
    const rows = terminal.rows;
    if (instance.lastResize?.cols === cols && instance.lastResize?.rows === rows) return;
    instance.lastResize = { cols, rows };
    sshResize(instance.id, cols, rows).catch(() => {});
  }

  /** 挂载 WebGL 渲染器（GPU），上下文不可用时回退 Canvas 2D。可重复调用以重建。 */
  private installWebgl(instance: TerminalInstance, terminal: XTerm) {
    try {
      const webglAddon = new WebglAddon();
      terminal.loadAddon(webglAddon);
      instance.webglAddon = webglAddon;
      instance.webglContextLossDisposable = webglAddon.onContextLoss(() => {
        try {
          webglAddon.dispose();
        } catch {
          // already disposed
        }
        instance.webglAddon = undefined;
        instance.webglContextLossDisposable = undefined;
      });
    } catch (err) {
      console.warn('WebGL terminal renderer unavailable, using Canvas 2D:', err);
    }
  }

  /**
   * 按容器当前尺寸 fit。窗口最小化等塌缩状态下（见 `terminalFitGuard`）不动行列数，
   * 返回 false；调用方不需要再区分，`resizeRemoteIfChanged` 看到行列没变自然不发。
   * 桌面终端所有 fit 都走这里，别直接调 `fitAddon.fit()`。
   */
  fit(instance: TerminalInstance): boolean {
    const fitAddon = instance.fitAddon;
    if (!fitAddon || !instance.terminal) return false;
    if (!isUsableFitSize(fitAddon.proposeDimensions())) return false;
    fitAddon.fit();
    return true;
  }

  /**
   * 把一个后台终端冻结成内存快照并释放 xterm。返回是否真的进入了休眠。
   *
   * 以下情况不休眠（返回 false）：正在显示、调试虚拟会话、处于备用屏幕
   * （vim / tmux / htop 的画面序列化不回来）、有选区（休眠会丢掉它）。
   */
  hibernate(sessionId: string): Promise<boolean> {
    const instance = this.instances.get(sessionId);
    if (!instance) return Promise.resolve(false);
    if (instance.hibernating) return instance.hibernating;
    if (!this.canHibernate(instance)) return Promise.resolve(false);
    const run = this.freeze(instance).finally(() => {
      instance.hibernating = null;
    });
    instance.hibernating = run;
    return run;
  }

  private canHibernate(instance: TerminalInstance): boolean {
    const terminal = instance.terminal;
    if (!terminal || !instance.serializeAddon) return false;
    if (instance.sleep || instance.visible || isDebugSession(instance.id)) return false;
    if (terminal.buffer.active.type !== 'normal') return false;
    return !terminal.hasSelection();
  }

  private async freeze(instance: TerminalInstance): Promise<boolean> {
    const terminal = instance.terminal;
    const serializeAddon = instance.serializeAddon;
    if (!terminal || !serializeAddon) return false;

    // 先立休眠标记：从这一刻起新到的输出排队而不是写进 xterm，快照因此不会被
    // 冻结过程中的写入搅乱，也不会漏掉任何一段。
    const sleep: SleepState = {
      cols: terminal.cols,
      rows: terminal.rows,
      viewportY: null,
      pending: new PendingOutput(),
      text: null,
      packed: null,
    };
    instance.sleep = sleep;

    // 空写入是屏障：回调触发时，它之前入队的数据都已解析进缓冲。
    const flushed = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), FLUSH_TIMEOUT_MS);
      try {
        terminal.write('', () => {
          clearTimeout(timer);
          resolve(true);
        });
      } catch {
        clearTimeout(timer);
        resolve(false);
      }
    });

    const stillOurs =
      this.instances.get(instance.id) === instance &&
      instance.terminal === terminal &&
      instance.sleep === sleep;
    if (!stillOurs) return false; // 期间被销毁 / 被唤醒，那边已经接管了善后

    // 冻结期间状态可能变了：被切到前台、进了备用屏幕、用户选中了文字。
    if (!flushed || !this.canHibernateAfterFlush(instance, terminal)) {
      this.abortFreeze(instance, terminal, sleep);
      return false;
    }

    // 屏障已过，缓冲是最终状态：此刻的视口位置才是要保留的那个。
    const active = terminal.buffer.active;
    sleep.viewportY = active.viewportY < active.baseY ? active.viewportY : null;

    let text: string;
    try {
      text = serializeAddon.serialize();
    } catch (err) {
      console.warn('Terminal snapshot failed, keeping the terminal awake:', err);
      this.abortFreeze(instance, terminal, sleep);
      return false;
    }

    this.unmountTerminal(instance);
    sleep.text = text;
    void packSnapshot(text).then((packed) => {
      // 压缩期间可能已被唤醒：只有这份休眠还当着前，才用压缩结果替换明文。
      if (instance.sleep === sleep && sleep.text === text) {
        sleep.packed = packed;
        sleep.text = null;
      }
    });
    return true;
  }

  private canHibernateAfterFlush(instance: TerminalInstance, terminal: XTerm): boolean {
    if (instance.visible) return false;
    if (terminal.buffer.active.type !== 'normal') return false;
    return !terminal.hasSelection();
  }

  /** 放弃这次冻结：把排队的输出按序写回，终端原样继续。 */
  private abortFreeze(instance: TerminalInstance, terminal: XTerm, sleep: SleepState) {
    instance.sleep = null;
    for (const chunk of sleep.pending.take()) terminal.write(chunk);
  }

  /** 休眠中则重建 xterm 并还原；醒着则什么都不做。可重复、可并发调用。 */
  async wake(sessionId: string): Promise<void> {
    const instance = this.instances.get(sessionId);
    if (!instance) return;
    if (instance.hibernating) await instance.hibernating;
    if (!instance.sleep) return;
    if (!instance.waking) {
      instance.waking = this.restore(instance).finally(() => {
        instance.waking = null;
      });
    }
    return instance.waking;
  }

  private async restore(instance: TerminalInstance): Promise<void> {
    const sleep = instance.sleep;
    if (!sleep) return;

    let snapshot = sleep.text ?? '';
    if (sleep.text === null && sleep.packed) {
      try {
        snapshot = await unpackSnapshot(sleep.packed);
      } catch (err) {
        // 快照坏了就只剩休眠期间的新输出；历史丢失但终端要能继续用。
        console.error('Failed to unpack terminal snapshot:', err);
        snapshot = '';
      }
    }
    if (this.instances.get(instance.id) !== instance || instance.sleep !== sleep) return;

    // 从这里到清休眠标记之间不能有 await：解压期间到的输出都在 pending 里，
    // 同一个 tick 内排空并清标记，之后的输出直接写进新实例，顺序不会乱。
    const terminal = this.mountTerminal(instance, { cols: sleep.cols, rows: sleep.rows });
    // 快照解析完的瞬间滚回休眠前的位置，排在它后面的休眠期输出再进来时，xterm 会
    // 当作"用户正在看历史"处理——视口留在原处，缓冲写满被裁掉旧行时也跟着修正，
    // 和这个终端从没休眠过的行为一致。贴底的终端不用管，它本来就跟随新输出。
    const viewportY = sleep.viewportY;
    if (snapshot) {
      terminal.write(
        snapshot,
        viewportY === null ? undefined : () => terminal.scrollToLine(viewportY),
      );
    }
    for (const chunk of sleep.pending.take()) terminal.write(chunk);
    instance.sleep = null;
    instance.lastActivityAt = Date.now();
  }

  /** 扫一遍，把静默够久的后台终端冻结。定时器和测试都走它。 */
  sweepIdle(now: number = Date.now()) {
    for (const instance of this.instances.values()) {
      if (
        shouldHibernate({
          visible: instance.visible,
          awake: instance.terminal !== null && instance.sleep === null,
          hiddenSince: instance.hiddenSince,
          lastActivityAt: instance.lastActivityAt,
          now,
        })
      ) {
        void this.hibernate(instance.id);
      }
    }
  }

  private ensureSweeper() {
    if (this.sweepTimer !== null) return;
    this.sweepTimer = setInterval(() => this.sweepIdle(), HIBERNATE_SWEEP_MS);
  }

  private stopSweeperIfIdle() {
    if (this.instances.size > 0 || this.sweepTimer === null) return;
    clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  destroy(sessionId: string) {
    const instance = this.instances.get(sessionId);
    if (!instance) return;

    for (const off of instance.domListeners) {
      try {
        off();
      } catch (err) {
        console.error('Failed to detach listener:', err);
      }
    }
    instance.domListeners.length = 0;

    if (instance.unlistenOutput) {
      instance.unlistenOutput();
    }
    this.unmountTerminal(instance);
    instance.sleep = null;
    instance.container.remove();

    this.instances.delete(sessionId);
    this.stopSweeperIfIdle();
  }

  destroyAll() {
    for (const sessionId of [...this.instances.keys()]) {
      this.destroy(sessionId);
    }
  }

  getAll(): IterableIterator<[string, TerminalInstance]> {
    return this.instances.entries();
  }

  getIds(): string[] {
    return Array.from(this.instances.keys());
  }

  /** Write local (non-SSH) text into the terminal. No-op if instance is gone. */
  writeLocal(sessionId: string, text: string) {
    const instance = this.instances.get(sessionId);
    if (!instance) return;
    instance.lastActivityAt = Date.now();
    if (instance.sleep) {
      instance.sleep.pending.push(text);
      return;
    }
    try {
      instance.terminal?.write(text);
    } catch {
      // Instance may be mid-dispose
    }
  }

  setStdinEnabled(sessionId: string, enabled: boolean) {
    const instance = this.instances.get(sessionId);
    if (!instance) return;
    instance.stdinDisabled = isDebugSession(sessionId) || !enabled;
    if (!instance.terminal) return; // 休眠中：记下来，重建时恢复
    try {
      instance.terminal.options.disableStdin = instance.stdinDisabled;
    } catch {
      // Instance may be mid-dispose
    }
  }

  /**
   * Append a disconnect/error banner once per disconnect cycle, and disable input.
   * Safe when the xterm instance is already destroyed (no-op).
   */
  showDisconnectBanner(
    sessionId: string,
    kind: 'disconnected' | 'error' | 'manual',
    detail: string,
  ) {
    const instance = this.instances.get(sessionId);
    if (!instance) return;
    if (instance.disconnectBannerShown) {
      this.setStdinEnabled(sessionId, false);
      return;
    }
    instance.disconnectBannerShown = true;
    this.setStdinEnabled(sessionId, false);

    const title =
      kind === 'error'
        ? '--- 连接失败 ---'
        : kind === 'manual'
          ? '--- 已断开连接 ---'
          : '--- 连接已断开 ---';
    const safeDetail = detail.trim() || (kind === 'error' ? '未知错误' : '连接已关闭');
    // Red title + gray detail, looks like terminal output
    const banner =
      `\r\n\x1b[31m${title}\x1b[0m\r\n` +
      `\x1b[90m详细信息：${safeDetail}\x1b[0m\r\n` +
      `\x1b[90m若您想要尝试重新连接，请点击 SSH 会话标签上的重试按钮\x1b[0m\r\n`;
    this.writeLocal(sessionId, banner);
  }

  /**
   * Enter reconnecting: keep stdin off, allow a new banner if reconnect fails.
   * Does not write any text (history stays intact).
   */
  prepareReconnect(sessionId: string) {
    const instance = this.instances.get(sessionId);
    if (!instance) return;
    instance.disconnectBannerShown = false;
    this.setStdinEnabled(sessionId, false);
  }

  /** Clear banner flag and re-enable stdin after a successful reconnect. */
  onReconnected(sessionId: string) {
    const instance = this.instances.get(sessionId);
    if (!instance) return;
    instance.disconnectBannerShown = false;
    if (isDebugSession(sessionId) && instance.terminal) {
      instance.terminal.reset();
      instance.terminal.write(DEBUG_SERVER_PROMPT);
    }
    this.setStdinEnabled(sessionId, true);
  }
}

export const terminalInstanceManager = new TerminalInstanceManager();
