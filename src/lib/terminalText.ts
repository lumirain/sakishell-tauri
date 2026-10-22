// 把 PTY 原始输出清洗成适合「纯文本记录」展示的内容。
//
// 外部 AI 调用是在交互 shell 的 PTY 里跑的，抓到的 chunk 带着：
//   - ANSI 颜色 / 光标 / 清屏转义序列（右栏是纯文本 <pre>，不解析，直接露出乱码）；
//   - `\r` 回车（进度条反复覆盖同一行）；
//   - SAKISHELL_DONE 结束标记行（内部用来判退出码，不该给用户看）。
//
// 这里只做展示层清洗，不改后端流式，也不动中间真实终端（xterm 自己会解析 ANSI）。

/** OSC 序列：ESC ] ... BEL 或 ESC ] ... ESC \。 */
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
/** CSI 序列：ESC [ 中间参数 + 一个终态字节。 */
const CSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;
/** 其余两字节转义（ESC + 一个字符，如 ESC(M 字符集切换）。 */
const ESC_OTHER_RE = /\x1b[@-_][0-9A-Za-z]/g;
/** 兜底：残留的孤立 ESC。 */
const ESC_BARE_RE = /\x1b./g;

/** 内部结束标记（与后端 DONE_MARKER 对应），整行删除。 */
const DONE_LINE_RE = /^.*SAKISHELL_DONE[^\n]*\n?/gm;

/**
 * 处理 `\r`：回车回到行首，后续内容覆盖本行。纯文本记录里进度条类的反复
 * 覆盖只需保留最后一次写入，所以回到行首时清空当前缓冲即可。
 */
function applyCarriageReturn(text: string): string {
  const lines: string[] = [];
  let cur = "";
  for (const ch of text) {
    if (ch === "\r") {
      cur = "";
    } else if (ch === "\n") {
      lines.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  lines.push(cur);
  return lines.join("\n");
}

/** 清洗一段命令输出，供右栏记录 / 放大视图 / 导出使用。 */
export function sanitizeExecOutput(raw: string): string {
  if (!raw) return "";
  let text = raw;
  text = text.replace(OSC_RE, "");
  text = text.replace(CSI_RE, "");
  text = text.replace(ESC_OTHER_RE, "");
  text = text.replace(ESC_BARE_RE, "");
  text = applyCarriageReturn(text);
  text = text.replace(DONE_LINE_RE, "");
  // 压缩清洗后产生的连续空行（最多保留一个空行），并去掉首尾空白。
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  return text;
}
