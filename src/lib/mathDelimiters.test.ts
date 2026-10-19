import { describe, expect, it } from 'vitest';
import { normalizeMathDelimiters as n } from './mathDelimiters';
import { parseMarkdown } from './markdownProcessor';

// 测试里的反斜杠一律写成 String.raw，免得和字符串转义混在一起。
const r = String.raw;

describe('normalizeMathDelimiters', () => {
  it('独占一行的 \\[ … \\] → 多行 $$ 围栏（块级公式）', () => {
    const src = r`\[ \int_{0}^{\infty} e^{-x^{2}}\,\mathrm{d}x = \frac{\sqrt{\pi}}{2} \]`;
    expect(n(src)).toBe(
      `$$\n${r`\int_{0}^{\infty} e^{-x^{2}}\,\mathrm{d}x = \frac{\sqrt{\pi}}{2}`}\n$$`,
    );
  });

  it('多行的 \\[ … \\]：内容原样保留', () => {
    expect(n(r`\[` + '\na = b\n' + r`\]`)).toBe('$$\na = b\n$$');
  });

  it('句子中间的 \\[ … \\] → 同行 $$（行内公式）', () => {
    expect(n(r`所以 \[x^2\] 恒正`)).toBe('所以 $$x^2$$ 恒正');
  });

  it('\\( … \\) → $ … $', () => {
    expect(n(r`设 \(x > 0\)，则 \( x^2 > 0 \)`)).toBe('设 $x > 0$，则 $x^2 > 0$');
  });

  it('引用块 / 缩进里的块级公式沿用前缀，不被拆出引用', () => {
    expect(n('> ' + r`\[ a+b \]`)).toBe('> $$\n> a+b\n> $$');
    expect(n('  ' + r`\[ a+b \]`)).toBe('  $$\n  a+b\n  $$');
  });

  it('列表项里的 \\[ … \\] 不是独占一行：走行内', () => {
    expect(n('- ' + r`\[a\]`)).toBe('- $$a$$');
  });

  it('围栏代码块、行内代码里的原样保留', () => {
    const fenced = '```latex\n' + r`\[ a \]` + '\n```';
    expect(n(fenced)).toBe(fenced);
    const tilde = '~~~\n' + r`\( a \)` + '\n~~~';
    expect(n(tilde)).toBe(tilde);
    const inline = '写法是 `' + r`\(x\)` + '` 这样';
    expect(n(inline)).toBe(inline);
    const double = '``' + r` \[ a \] ` + '``';
    expect(n(double)).toBe(double);
  });

  it('围栏之外的照转，围栏收尾后恢复转换', () => {
    const src = '```\n' + r`\(a\)` + '\n```\n' + r`\(b\)`;
    expect(n(src)).toBe('```\n' + r`\(a\)` + '\n```\n$b$');
  });

  it('没配对收尾（流式写到一半）：原样保留', () => {
    const half = r`\[ \int_0^1 x`;
    expect(n(half)).toBe(half);
    const half2 = r`设 \(x`;
    expect(n(half2)).toBe(half2);
  });

  it('不跨空行；内容为空或含 $ 的不转', () => {
    const cross = r`\(a` + '\n\n' + r`b\)`;
    expect(n(cross)).toBe(cross);
    expect(n(r`\(  \)`)).toBe(r`\(  \)`);
    expect(n(r`\(a $ b\)`)).toBe(r`\(a $ b\)`);
  });

  it('\\\\( 是转义的反斜杠加左括号，不是定界符', () => {
    const src = r`路径 \\(x\\) 结束`;
    expect(n(src)).toBe(src);
  });

  it('没有定界符的文本原样返回（同一个字符串）', () => {
    const plain = '普通文本 $a$ 和 $$b$$ 都不动';
    expect(n(plain)).toBe(plain);
  });
});

describe('经 markdown 管线渲染', () => {
  const html = (text: string) => JSON.stringify(parseMarkdown(text));

  it('\\[ … \\] 渲染成居中的块级公式', () => {
    const out = html(r`\[ \int_{0}^{\infty} e^{-x^{2}}\,\mathrm{d}x = \frac{\sqrt{\pi}}{2} \]`);
    expect(out).toContain('katex-display');
    expect(out).toContain('katex-html');
  });

  it('\\( … \\) 渲染成行内公式', () => {
    const out = html(r`设 \(x^2\) 恒正`);
    expect(out).toContain('"katex"');
    expect(out).not.toContain('katex-display');
  });

  it('代码块里的 \\[ … \\] 不会被渲染成公式', () => {
    const out = html('```\n' + r`\[ x \]` + '\n```');
    expect(out).not.toContain('katex');
  });
});
