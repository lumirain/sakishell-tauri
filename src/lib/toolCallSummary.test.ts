import { describe, expect, it } from 'vitest';
import type { AgentMessage } from './types';
import { summarizeToolCalls, toolCallCountSuffix, toolCallSummaryLabel } from './toolCallSummary';

function tool(toolName: string, extra: Partial<AgentMessage> = {}): AgentMessage {
  return { id: toolName, role: 'tool', content: '', timestamp: '',
    toolResult: { toolName, result: '', summary: '', success: true, blocked: false }, ...extra };
}

describe('tool call summaries', () => {
  it('lists distinct tool names in first-seen order, with *n after names that ran more than once', () => {
    expect(toolCallSummaryLabel([
      tool('edit'), tool('write'), tool('edit'), tool('bash'), tool('write'),
      tool('edit'), tool('write'), tool('write'), tool('bash'),
    ])).toBe('执行edit*3,write*4,bash*2');
  });

  it('writes no count for a tool that ran once', () => {
    expect(toolCallCountSuffix(1)).toBe('');
    expect(toolCallCountSuffix(0)).toBe('');
    expect(toolCallCountSuffix(2)).toBe('*2');
    expect(toolCallCountSuffix(12)).toBe('*12');
    expect(toolCallSummaryLabel([tool('bash'), tool('write'), tool('bash')])).toBe('执行bash*2,write');
  });

  it('does not count calls that are still running', () => {
    expect(toolCallSummaryLabel([
      tool('bash'), tool('bash', { isExecuting: true }), tool('write'),
    ])).toBe('执行bash,write');
  });

  it('keeps running calls and successful deliverables out of the summary', () => {
    const failedDeliverable = tool('render_html');
    failedDeliverable.toolResult!.success = false;
    expect(summarizeToolCalls([
      tool('bash', { isExecuting: true }), tool('render_html'), failedDeliverable,
      tool('missing', { toolResult: undefined }), tool('mcp.custom/tool'),
    ])).toEqual([{ toolName: 'render_html', count: 1 }, { toolName: 'mcp.custom/tool', count: 1 }]);
  });

  it('accepts historical calls without an execution flag and keeps aliases distinct', () => {
    expect(summarizeToolCalls([tool('bash'), tool('execute_command')])).toEqual([
      { toolName: 'bash', count: 1 }, { toolName: 'execute_command', count: 1 },
    ]);
  });

  it('does not mutate messages or invent counts for missing data', () => {
    const messages = Object.freeze([Object.freeze(tool('bash'))]);
    expect(toolCallSummaryLabel(messages)).toBe('执行bash');
    expect(summarizeToolCalls([])).toEqual([]);
  });
});
