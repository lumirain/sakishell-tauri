## 贡献必读

### 使用 AI 工具时需要加载的 skill

发布流程（版本号、构建、打 tag、上传安装包）放在 `release` skill 里，并按所用工具放了三份内容一致的拷贝：

- `.claude/skills/release/SKILL.md`（Claude Code）
- `.opencode/skills/release/SKILL.md`（OpenCode）
- `.trae/skills/release/SKILL.md`（Trae）

使用以上工具的人，skill 通常会被自动识别；使用其他工具的人，需要手动让它加载其中任意一份。修改 skill 时，三份必须同步。

### 代码预览

- `install.cmd`：安装前端依赖（`pnpm install`，没有 pnpm 时会先装 pnpm）。
- `dev.cmd`：启动完整的 Tauri 开发模式——Vite 前端 + 编译并启动 Rust 后端，应用窗口会自动弹出。首次编译 Rust 需要 1–2 分钟。
- `dev-frontend.cmd`：只启动前端（Vite，不编译 Rust），在浏览器打开 `http://localhost:1420` 预览界面。这是纯 UI 模式，SSH 连接和 Agent 功能不可用，需要完整功能请用 `dev.cmd`。
