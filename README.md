<h1 align="center">SakiShell</h1>

<p align="center">
  <strong>AI 原生的桌面 SSH 终端，把普通连接与 AI 执行严格分开。</strong>
</p>

<p align="center">
  <a href="https://github.com/lumirain/sakishell-tauri/releases/latest">下载最新版本</a> ·
  <a href="docs/mcp-server.md">MCP Server 接入</a> ·
  <a href="https://github.com/lumirain/sakishell-tauri/issues">反馈问题</a>
</p>

SakiShell 是一款基于 **Tauri v2** 的开源桌面 SSH 终端（Windows），内置 AI 工作台与 MCP 服务。
它既可以当作一款干净好用的 SSH 客户端，也能让外部 AI 客户端（Claude Code 等支持 MCP 的工具）
通过本机 HTTP MCP 服务复用你已保存的连接执行命令，并把全过程实时呈现在界面里。

> 本项目由 [q541810/Marcel_ssh](https://github.com/q541810/Marcel_ssh) 二次修改并开源而成，在其基础上做了 AI 会话隔离、外部调用命令流、命令导出等定制。

## 核心特性

### 普通连接与 AI 连接严格隔离

- 手动创建的普通 SSH 连接只服务于人；AI 执行的命令只落在带 **AI 标识**的专属终端会话里，
  不会串进普通终端。
- 没有现成 AI 专属连接时，外部调用会自动建立一条独立的 AI 会话并保持复用，
  与手动连接分栏、分组展示，互不干扰。
- 左侧「AI 命令记录」按连接归档每一条 AI 命令，点击即可回看完整命令与输出。

### 外部 AI 调用，全程可见

- 开启本机 HTTP MCP 服务后，外部 Agent 通过 `ssh_execute` 在指定连接上执行命令，
  右侧「外部调用」命令流实时展示命令、状态、退出码与原始输出。
- 每条命令可单独放大查看、单独导出；整个会话的命令与结果也可一次性导出。
- 输出经过清洗：剥离 ANSI 转义、处理回车覆盖，命令流里看到的是可读文本。

### 三栏工作台，宽度自由调节

- 左栏 AI 会话 / 命令记录、中栏终端、右栏外部调用命令流，三栏之间可拖拽调宽；
- 顶栏按钮可临时收起右侧命令流，收起时终端自动占满，不改变已保存的布局偏好。

### 终端体验

- 多连接标签管理，WebGL 渲染，符合 Windows 习惯的复制粘贴与点击定位光标。
- 窗口最小化再恢复、面板收展时统一经过尺寸守卫，避免终端被错误缩成极窄列、
  提示符与输出错位散落。
- 后台终端可休眠为内存快照、切回原样还原，长时间多标签不占满内存。

### 命令与会话导出

- 单条命令：导出该命令与其执行结果为 txt。
- 整个会话：按连接把全部命令与结果导出为 txt，多条命令之间留空行分隔，便于阅读。
- 导出走系统「另存为」，可自选目录。

### HTTP 常驻服务

- 「设置 → 工具能力」中可开启 HTTP MCP 常驻服务，并提供**程序启动自动开启**选项，
  按需决定开机是否自动拉起。
- 令牌支持留空（本机信任）或固定填写，连接与认证始终在本机管理。

### 凭据本机加密

- SSH 私钥以 AES-256-GCM 加密保存，主密钥交由系统凭据存储保管；
- SSH 密码与模型 / 服务密钥走系统级凭据保护，不以明文写入普通配置；
- 认证由 Rust 后端在本机完成，不把密码或私钥写进提示词。

> Agent 处理任务时，命令、文件内容与工具输出仍会发送给你选择的模型提供商。

## 快速开始

1. 前往 [最新发布页](https://github.com/lumirain/sakishell-tauri/releases/latest) 下载对应平台的安装包与 `.sig` 签名：
   - **Windows x64**：`SakiShell_<版本>_x64-setup.exe`（NSIS，推荐）
   - **Windows ARM64**：`SakiShell_<版本>_arm64-setup.exe`（NSIS，支持静默自动更新）
   - **macOS Intel**：`SakiShell_<版本>_x64.dmg`
   - **macOS Apple Silicon**：`SakiShell_<版本>_aarch64.dmg`
2. 安装并打开 SakiShell，完成首次引导。
3. 在左侧添加 SSH 连接，选择密码或私钥认证。
4. 需要让外部 AI 接入时，在「设置 → 工具能力」开启 HTTP MCP 服务，按
   [MCP Server 文档](docs/mcp-server.md) 配置客户端。

> **macOS 未签名说明**：本项目的 macOS 安装包未做 Apple 开发者签名（无付费开发者证书）。
> 首次打开时若被 Gatekeeper 拦截：右键点击 `.dmg`（或安装后的应用）→「打开」→ 再次确认「打开」即可，
> 之后不会再拦截。macOS 端暂不提供静默自动更新，新版本请手动到发布页下载。

## 作为 MCP Server 接入外部 Agent

外部支持 MCP 的工具无需重复配置连接参数，即可复用 SakiShell 已保存的连接执行命令、
读写文件。具体服务地址、令牌与工具说明见 [docs/mcp-server.md](docs/mcp-server.md)。

## 开发与构建

技术栈：前端 React + TypeScript + Vite + xterm.js，后端 Rust（Tauri v2）。

```bash
# 安装依赖
pnpm install

# 前端类型检查 / 构建
pnpm tsc --noEmit
pnpm build

# 桌面开发
pnpm tauri dev

# 发布：由 GitHub Actions 在 Windows 上完成 tsc / vitest / eslint / cargo test 与 NSIS 打包、minisign 签名，
# 产物 sha256 / 签名 / 大小回填 latest.json 供自动更新校验。
```

参与贡献前请先阅读 [贡献者说明](CONTRIBUTING.md)。

## 基于上游

SakiShell 基于 [q541810/Marcel_ssh](https://github.com/q541810/Marcel_ssh) 二次修改开发，感谢原项目作者的贡献。

## 开源许可

SakiShell 使用 [GNU General Public License v3.0](LICENSE) 许可证。
