// AI 命令记录导出：把外部 MCP 会话的命令与结果写成 txt。
//
// - 单条导出：一条命令 + 完整输出 + 退出码；
// - 整会话导出：该连接全部命令按执行顺序拼接，条目之间空行 + 分隔线隔开，
//   避免多条记录挤在一起难以阅读。
//
// 保存走系统「另存为」对话框（用户自选目录/文件名），写入用 plugin-fs。

import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import type {
  ExternalExecCommand,
  ExternalMcpSession,
} from '@/stores/externalMcpStore';

const STATUS_TEXT: Record<ExternalExecCommand['status'], string> = {
  running: '运行中',
  completed: '完成',
  timed_out: '超时',
  cancelled: '已取消',
  failed: '失败',
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** yyyy-MM-dd HH:mm:ss */
export function formatFullTime(millis: number): string {
  if (!millis) return '';
  const d = new Date(millis);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 文件名安全化：去掉 Windows/跨平台非法字符。 */
function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'session';
}

function stamp(millis: number): string {
  const d = new Date(millis || Date.now());
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const RULE = '─'.repeat(60);

/** 格式化单条命令记录。 */
export function buildSingleCommandText(
  session: ExternalMcpSession,
  cmd: ExternalExecCommand,
): string {
  const lines: string[] = [
    RULE,
    `连接：${session.connectionName}（${session.host}）`,
    `时间：${formatFullTime(cmd.startedAt)}`,
    `来源：${cmd.source === 'ai' ? 'AI' : '你'}`,
    `状态：${STATUS_TEXT[cmd.status]}`,
    `命令：${cmd.command}`,
    RULE,
    cmd.output.trim() ? cmd.output.trim() : '（无输出）',
    RULE,
  ];
  if (cmd.exitCode != null) {
    lines.push(`退出码：${cmd.exitCode}`);
  }
  if (cmd.error) {
    lines.push(`错误：${cmd.error}`);
  }
  if (cmd.finishedAt) {
    lines.push(`结束于：${formatFullTime(cmd.finishedAt)}`);
  }
  return lines.join('\n');
}

/** 格式化整个会话：全部命令按序拼接，条目间空两行 + 分隔线。 */
export function buildSessionText(session: ExternalMcpSession): string {
  const header = [
    `SakiShell · AI 命令记录导出`,
    `连接：${session.connectionName}（${session.host}）`,
    `共 ${session.commands.length} 条命令`,
    `导出时间：${formatFullTime(Date.now())}`,
    '',
  ].join('\n');
  const body = session.commands
    .map((cmd) => buildSingleCommandText(session, cmd))
    .join('\n\n\n');
  return header + body + '\n';
}

/** 弹「另存为」对话框并写入 txt；用户取消返回 false，成功返回 true。 */
export async function exportTextFile(
  defaultName: string,
  content: string,
): Promise<boolean> {
  const path = await save({
    title: '导出命令记录',
    defaultPath: `${safeName(defaultName)}.txt`,
    filters: [{ name: '文本文件', extensions: ['txt'] }],
  });
  if (!path) return false;
  await writeTextFile(path, content);
  return true;
}

/** 导出单条命令。 */
export async function exportSingleCommand(
  session: ExternalMcpSession,
  cmd: ExternalExecCommand,
): Promise<boolean> {
  const name = `${safeName(session.connectionName)}_${stamp(cmd.startedAt)}`;
  return exportTextFile(name, buildSingleCommandText(session, cmd) + '\n');
}

/** 导出整个会话。 */
export async function exportSessionLog(session: ExternalMcpSession): Promise<boolean> {
  const name = `${safeName(session.connectionName)}_命令记录_${stamp(Date.now())}`;
  return exportTextFile(name, buildSessionText(session));
}
