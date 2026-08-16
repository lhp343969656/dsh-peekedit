# dsh-peekedit

[![npm version](https://img.shields.io/npm/v/dsh-peekedit.svg)](https://www.npmjs.com/package/dsh-peekedit)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) · **简体中文**

为 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)（`dsh`）增强的文件工具**和文件浏览器**。

源码：<https://github.com/lhp343969656/dsh-peekedit> · 问题反馈：<https://github.com/lhp343969656/dsh-peekedit/issues>

## 功能一览

**面向模型的文件工具**——对内置的 `read` / `write` / `edit` 工具是补充而非替代，共用同一个 `ctx.fs` 服务、`fs/*` 策略事件和沙箱约束：

| 工具 | 用途 |
|---|---|
| `peek` | 按行窗口（`view_range`）查看文件，或查看最多 2 层深的目录。输出带行号、总行数，长输出自动截断并提示。 |
| `peek_edit` | 修改已有文件：唯一字面量的 `str_replace` 或按行 `insert`。 |
| `peek_write` | 新建文件或覆盖已有文件。 |

**文件浏览器界面**（Web 客户端）：会话头部新增"📁 文件"按钮，打开侧边抽屉展示当前会话的工作目录——点进文件夹、点文件预览、就地编辑并保存。读写都走同一个 `ctx.fs` 通道；浏览器不会绕过沙箱或目录约束（路径限定在会话工作区内，`..` 越界被拒绝）。

所有操作都经过挂载的 `ctx.fs` 后端和 `fs/*` 事件闸门，沙箱围栏、先读后写策略、远程文件系统后端的行为与内置工具完全一致。

## 安装

本包带有 `dsh.bundle` 清单，可以作为一个插件 bundle 安装到 profile。

**推荐**——从 npm 安装：

```sh
dsh plugin --profile web add dsh-peekedit
```

或者从 git 仓库（安装时通过 `prepare` 脚本构建）或本地目录 / 打包文件安装：

```sh
dsh plugin --profile web add github:lhp343969656/dsh-peekedit
dsh plugin --profile web add ./dsh-peekedit
```

> 插件的浏览器部分（`dsh.client` bundle）只有在包解析进 profile 的依赖树时才会被发现，所以请用 `dsh plugin add` 安装，而不是用 `file://` 补丁覆盖层。

启动前先验证配置层：

```sh
dsh --profile web --dump-config
```

也可以临时用补丁覆盖层加载（仅工具部分——浏览器部分需要正式安装）：

```sh
dsh web --patch ./cordis.patch.yml
```

> Windows 上，按包名引用本地 checkout 的临时补丁，只有在 `dsh plugin add` 之后才能从 profile 的依赖树解析。想直接把补丁指向本地目录，请用 `file://` URL：`name: 'file:///H:/path/to/dsh-peekedit/lib/index.js'`（加载器不接受裸盘符路径）。

从 git 安装会执行包的 `prepare` 脚本（tsdown 构建）——如果 pnpm 拒绝，在 profile 的 `pnpm-workspace.yaml` 中放行一次（`allowBuilds: dsh-peekedit: true`）；不信任的仓库请固定 commit。

## 配置

该 bundle 会插入两个插件行，各自有独立的配置。

`dsh-peekedit`（工具）：

| 键 | 默认值 | 含义 |
|---|---:|---|
| `maxOutputChars` | `16000` | `peek` 查看文件时保留的字符数，超出后显示截断提示。 |

`dsh-peekedit/api`（文件浏览器 API，仅 web 组合）：

| 键 | 默认值 | 含义 |
|---|---:|---|
| `root` | `process.cwd()` | 会话工作目录无法解析时的兜底浏览根目录。 |
| `maxReadChars` | `1000000` | 浏览器预览读取返回的字符数上限，更大的文件返回 `FS_TOO_LARGE`。 |

```yaml
# cordis.patch.yml（你的 profile / 用户层）
- id: api-peekedit
  config:
    root: 'H:/myproject'
    maxReadChars: 200000
```

## 浏览器 API

`/api/peekedit/*` 下的同源路由（仅在挂载了 `webServer` 时注册）：

| 路由 | 用途 |
|---|---|
| `GET /api/peekedit/list?session=<id>&path=<rel>` | 某个目录的子项列表，路径相对于会话工作区。 |
| `GET /api/peekedit/read?session=<id>&path=<rel>` | 文件 UTF-8 内容（拒绝二进制，限制大小）。 |
| `POST /api/peekedit/write` | 替换文件内容；拒绝跨域 `Origin` 请求头。 |

路径相对于调用会话的 `cwd` 解析（兜底为 `root` 配置），且必须保持在目录内——`..` 片段和越界访问返回 `403 PATH_ESCAPE`。

## 环境要求

- Node.js ≥ 20
- DeepSeek Harness，且 profile 的依赖树中可解析到 `@deepseek-ai/dsh-*` `0.1.0-rc.6`（或更新）的包
- Web 客户端 bundle 带有浏览器部分，需要 React 18（平台词表已提供）

## 开发

```sh
npm install
npm test          # vitest 单元 + 集成测试（宿主 API + 客户端 bundle）
npm run build     # tsdown → lib/（宿主入口 + 浏览器 bundle）
```

## 许可证

MIT
