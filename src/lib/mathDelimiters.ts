/**
 * 把 LaTeX 风格的公式定界符 `\[ … \]` / `\( … \)` 统一成 remark-math 认的 `$$ … $$` / `$ … $`。
 *
 * 为什么要在解析前改写源文本：markdown 里 `\[`、`\(` 是转义序列，解析后反斜杠已经没了，
 * remark-math 根本看不到它们，公式会显示成 `[ \int … ]` 这种带括号的原文。很多模型
 * 默认就用这套定界符，所以必须在 markdown 解析之前动手。
 *
 * 保守原则（宁可不转，也不要把正文改坏）：
 * - 围栏代码块、行内代码里的内容原样保留；
 * - 找不到配对的收尾（流式输出写到一半）原样保留，等收尾到了再转；
 * - 公式不得跨越空行（跨段的多半不是公式）；
 * - 内容里带 `$` 的不转（会和 `$` 定界符打架）；
 * - `\\(` 是「转义的反斜杠 + 左括号」，不是定界符。
 *
 * 独占一行的 `\[ … \]` 转成多行 `$$` 围栏 → 渲染成居中的块级公式；夹在句子中间的
 * 转成同行 `$$ … $$`（行内公式）。块级围栏沿用所在行的缩进 / 引用前缀，列表和引用里也不会断。
 */

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})/;

/** 行首到当前位置只有缩进 / 引用符号：说明这个定界符是「独占一行」的开头。 */
const LINE_PREFIX = /^[ \t>]*$/;

export function normalizeMathDelimiters(text: string): string {
  if (!text.includes('\\[') && !text.includes('\\(')) return text;

  const lines = text.split('\n');
  const out: string[] = [];
  let prose: string[] = [];
  let fence: { char: string; len: number } | null = null;

  const flushProse = () => {
    if (prose.length > 0) out.push(convertProse(prose.join('\n')));
    prose = [];
  };

  for (const line of lines) {
    if (fence) {
      out.push(line);
      const close = line.trim();
      if (
        close.length >= fence.len &&
        close[0] === fence.char &&
        close.split('').every((c) => c === fence!.char)
      ) {
        fence = null;
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open) {
      flushProse();
      fence = { char: open[2][0], len: open[2].length };
      out.push(line);
      continue;
    }
    prose.push(line);
  }
  flushProse();
  return out.join('\n');
}

/** 一段不含围栏代码块的正文（段首即行首）。 */
function convertProse(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];

    if (c === '`') {
      // 行内代码：找长度相同的收尾反引号串；找不到就只当普通字符。
      let n = 1;
      while (s[i + n] === '`') n++;
      const end = findBacktickRun(s, i + n, n);
      if (end < 0) {
        out += s.slice(i, i + n);
        i += n;
      } else {
        out += s.slice(i, end + n);
        i = end + n;
      }
      continue;
    }

    if (c === '\\') {
      const next = s[i + 1];
      if (next === '[' || next === '(') {
        const converted = tryConvert(s, i, next, out);
        if (converted) {
          out += converted.text;
          i = converted.end;
          continue;
        }
      }
      // 其它转义（含 `\\`、`` \` ``）整对原样放过，免得把转义的反斜杠误当定界符的开头。
      if (next !== undefined) {
        out += c + next;
        i += 2;
      } else {
        out += c;
        i += 1;
      }
      continue;
    }

    out += c;
    i += 1;
  }
  return out;
}

function findBacktickRun(s: string, from: number, n: number): number {
  let i = from;
  while (i < s.length) {
    if (s[i] !== '`') {
      i++;
      continue;
    }
    let run = 1;
    while (s[i + run] === '`') run++;
    if (run === n) return i;
    i += run;
  }
  return -1;
}

function tryConvert(
  s: string,
  at: number,
  kind: '[' | '(',
  emitted: string,
): { text: string; end: number } | null {
  const closer = kind === '[' ? '\\]' : '\\)';
  const innerStart = at + 2;
  const closeAt = s.indexOf(closer, innerStart);
  if (closeAt < 0) return null;
  const inner = s.slice(innerStart, closeAt);
  if (inner.trim() === '' || inner.includes('$')) return null;
  if (/\n[ \t>]*\r?\n/.test(inner)) return null; // 跨段
  const end = closeAt + 2;

  if (kind === '(') return { text: `$${inner.trim()}$`, end };

  const lineStart = emitted.lastIndexOf('\n') + 1;
  const prefix = emitted.slice(lineStart);
  const rest = s.slice(end);
  const alone = LINE_PREFIX.test(prefix) && /^[ \t]*(\r?\n|$)/.test(rest);
  if (!alone) return { text: `$$${inner.trim()}$$`, end };

  const startsOnNewLine = /^[ \t]*\r?\n/.test(inner);
  const lastLine = inner.slice(inner.lastIndexOf('\n') + 1);
  const endsOnNewLine = inner.includes('\n') && LINE_PREFIX.test(lastLine);
  let body = startsOnNewLine
    ? inner.replace(/^[ \t]*(?=\r?\n)/, '')
    : `\n${prefix}${inner.trim()}`;
  if (!endsOnNewLine) body = `${body.trimEnd()}\n${prefix}`;
  return { text: `$$${body}$$`, end };
}
