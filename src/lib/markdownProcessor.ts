import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { markdownRehypePlugins, markdownRemarkPlugins } from './markdownPlugins';
import { normalizeMathDelimiters } from './mathDelimiters';

// Match react-markdown's pipeline. Raw HTML stays a raw node, never executable HTML.
const processor = unified()
  .use(remarkParse)
  .use(markdownRemarkPlugins)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(markdownRehypePlugins)
  .freeze();

export function parseMarkdown(rawText: string) {
  // `\[ \]` / `\( \)` 要在 markdown 解析前改写（解析后反斜杠已被当转义吃掉）；
  // parse 与 runSync 必须用同一份文本，autolinkRepair 靠 file.value 的偏移回读原文。
  const text = normalizeMathDelimiters(rawText);
  // runSync 必须显式带上 file：transformer（如 autolinkRepair）要从 file.value
  // 读原文；只传树的话 file 是空的，插件会被静默跳过。
  return processor.runSync(processor.parse(text), text);
}

export type MarkdownTree = ReturnType<typeof parseMarkdown>;
export interface MarkdownRequest { id: number; text: string }
export type MarkdownResponse = { id: number; tree: MarkdownTree } | { id: number; error: true };
