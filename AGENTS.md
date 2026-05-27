# 仓库说明

这个仓库用 AI 统一管理所有游戏开发内容。约定：**低多边形(low-poly) + Godot + Web 发布**。
仓库根本身就是一个 Godot 项目，正式游戏用 Godot 开发；`packages/` 下的 web 代码是辅助，用于快速验证玩法和提供联机服务器。

## 目录结构

- `project.godot` / `main.tscn` / `main.gd` —— Godot 项目根与外壳场景（首页列表 + 返回 + 游戏挂载点，类比 web 的路由）
- `shared/` —— 跨游戏复用层（类比网页的共享组件）
  - `autoload/Palette.gd` —— 低多边形调色板与材质工厂
  - `autoload/GameHub.gd` —— 游戏注册表 + 场景切换（新增游戏只改 `GAMES` 一条）
  - `autoload/Net.gd` —— 联机传输层（不含游戏规则）
- `games/<game>/` —— 各游戏，游戏层尽量轻薄，规则/渲染在自己的脚本里
- `packages/` —— 辅助的 JS/TS（pnpm 工作区），靠 `.gdignore` 让 Godot 忽略
  - `web/` web demo 试玩场（React + Vite + Mantine），保留用于快速验证玩法
  - `server/` 联机服务器（Hono + ws），生产环境同时托管 web 静态产物
  - `shared/` 共享 TS 逻辑

`packages/` 和 `node_modules/` 各有一个 `.gdignore`；根 `package.json` 的 `postinstall` 会兜底重建 `node_modules/.gdignore`。

## Godot 约定

- Godot 4.6，渲染后端用 `gl_compatibility`（对 WebGL 最兼容）
- 不使用缩写；标识符用完整单词
- 文件/目录用 snake_case（如 `tic_tac_toe.gd`），节点名用 PascalCase
- 视觉一律从 `Palette` 取色，不在游戏里写死颜色
- 新增游戏：建 `games/<game>/`，在 `GameHub.GAMES` 注册一条即可被首页加载

## 联机架构（房主权威 + 笨中转）

- 服务器只按房间转发消息、不理解游戏规则（`packages/server/src/relay.ts`）
- 房主(host)端跑权威游戏逻辑并广播全量状态，加入方(guest)发意图、按状态渲染
- 规则只写在 Godot 端一处，不在 TS/GDScript 各写一遍
- `Net.gd` 的信号契约（room_created / peer_joined / message / peer_left）保持稳定；将来把传输从 WebSocket 换成 WebRTC P2P（服务器退化为信令）时不动游戏代码

## Web demo 约定

- 总是尽可能沿用现有的技术栈
- 组件文件用 PascalCase 如 `App.tsx`，其他文件用 camelCase 如 `utils.ts`
- 只用具名导出如 `export const App = () => { ... }`
- 布局主要考虑手机端显示

## 端口

| | 后端 | 前端 |
|---|---|---|
| 开发 | 8791 | 8792（vite，代理到 8791）|
| 生产 | 8793 | 8794 空缺（静态 html 由后端 8793 托管）|

## 常用命令

- `pnpm dev` —— 起 web demo（前端 8792 + 后端 8791）
- `pnpm godot:play` —— 直接运行 Godot 游戏
- `pnpm godot:editor` —— 打开 Godot 编辑器
- `pnpm godot:export:web` —— 导出 HTML5 到 `dist/godot-web/`（需先在编辑器装一次导出模板）
- `pnpm serve` —— 生产：构建 web 并由后端 8793 托管

## 查阅文档

- Mantine: https://mantine.dev/llms.txt
- Region: https://raw.githubusercontent.com/regionjs/region/refs/heads/main/docs/Document-zh_CN.md
