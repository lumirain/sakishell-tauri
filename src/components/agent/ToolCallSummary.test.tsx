import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '@/lib/types';
import ToolCallSummary from './ToolCallSummary';

const tool = (toolName: string): AgentMessage => ({
  id: toolName, role: 'tool', content: '', timestamp: '',
  toolResult: { toolName, summary: '', result: '', success: true, blocked: false },
});

describe('compact tool summary', () => {
  it('renders unique names with ASCII commas, *n only after names that ran more than once', () => {
    const html = renderToStaticMarkup(<ToolCallSummary messages={[tool('bash'), tool('write'), tool('bash')]} />);
    expect(html).toContain('aria-label="执行bash*2,write"');
    expect(html.replace(/<[^>]*>/g, '')).toBe('执行bash*2,write');
    expect(html.match(/data-tool-summary-name=/g)).toHaveLength(2);
    expect(html.match(/tool-call-summary-count/g)).toHaveLength(1);
  });

  it('keeps the count outside the truncating name so a long name cannot hide it', () => {
    const name = 'mcp.custom.very_long_tool_name_that_does_not_fit';
    const html = renderToStaticMarkup(<ToolCallSummary messages={[tool(name), tool(name), tool(name)]} />);
    expect(html).toContain(`<span class="tool-call-summary-name" title="${name}">${name}</span><span class="tool-call-summary-count">*3</span>`);
    expect(html).toContain(`title="执行${name}*3"`);
  });

  it('preserves full names for assistive technology and tooltips while allowing separate truncation', () => {
    const name = 'mcp.custom.very_long_tool_name_that_does_not_fit';
    const html = renderToStaticMarkup(<ToolCallSummary messages={[tool(name), tool('write')]} />);
    expect(html).toContain(`title="${name}"`);
    expect(html).toContain(`title="执行${name},write"`);
    expect(html).toContain('tool-call-summary-text');
    expect(html).toContain('tool-call-summary-name');
  });
});
