# dsh-desktop 设计文档

> 把 dsh web 打包成自包含、可分发的 Windows 桌面客户端。
> 状态：设计中（已与用户讨论确认方向）；下一步：M1 本地原型。

---
---

## 1. 背景与目标

### 1.1 现状痛点

dsh 目前基于浏览器 GUI（`dsh web`）。每次使用需要：

- 打开一个 **cmd 窗口**（运行 `dsh web`）；
- 再打开一个 **浏览器窗口**（访问 `http://127.0.0.1:3081`）。

两个窗口、两步操作，体验不像是"一个客户端"。

### 1.2 目标

做一个 **自包含、可分发的桌面客户端**：

- **单文件 exe**：双击即用，无需安装 Node / dsh / 浏览器；
- **单窗口**：打开就是一个应用窗口，没有 cmd 窗口、没有浏览器标签；
- **关窗即退**：关掉窗口 = 整个程序（包括后台 host）退出；
- **自带最新 dsh**：exe 内捆绑当前最新版 dsh，且"每次下载到的都是最新版"由构建流水线保证；
- **可更新**：老用户能自动跟进 dsh 新版本；
- **可分发**：最终用户拿到就能用，数据（会话、设置）各自独立、不随更新丢失。

### 1.3 演进节奏（已确认）

1. **先本地跑通**：原型在本机可双击运行；
2. **再上 GitHub 开源**：仓库化 + CI 自动检测 dsh 新版本、自动打包、自动发布。

---

## 2. 核心思路：壳 + 内核的容器式架构

```
┌─────────────────────────────────────────────┐
│  exe 壳（Electron）                          │  ← 几乎不更新
│  只负责：开窗口、拉起 host、关窗退出           │
├─────────────────────────────────────────────┤
│  Node 运行时（官方 node.exe，单独捆绑）        │  ← 版本由我们锁定
├─────────────────────────────────────────────┤
│  dsh 运行时（CLI + node_modules + Web 前端）   │  ← 频繁更新（当前 0.1.0-rc.x）
├─────────────────────────────────────────────┤
│  用户数据（%APPDATA%/dsh-desktop/dsh-home）    │  ← 更新永远不碰它
│  会话 / 设置 / profile                        │
└─────────────────────────────────────────────┘
```

**类比**：exe 壳 ≈ Docker 的容器运行时，dsh ≈ 镜像。壳是固定的，镜像可以独立更新。

**关键收益**：

1. **界面跟随内核**：dsh web 的界面由 host 进程端出（serve），换内核版本 = 界面自动更新，壳不用重打包；
2. **数据与程序分离**：用户数据放应用数据目录，更新、卸载都不丢会话；
3. **接口稳定**：壳与 dsh 之间只有两个稳定接口——启动命令（`dsh --profile web --port <p>`）和 HTTP 页面。

---

## 3. 关键技术决策

| # | 决策点 | 选择 | 理由 |
|---|--------|------|------|
| 1 | 窗口层框架 | **Electron**（portable 单 exe） | 生态成熟；JS 技术栈与 dsh 一致；electron-builder 直接产出单文件 portable exe。Tauri 备选（exe 更小），但需要 Rust 工具链，且 Node 运行时仍要打包成 sidecar，第一版不做 |
| 2 | Node 运行时 | **单独捆绑官方 node.exe**（Node 24 LTS），不用 Electron 内置 Node | dsh 要求 Node `^22.19.0 \|\| >=24.0.0`（见 `D:\deepseek-harness\package.json` engines）；主流 Electron 内置 Node 为 22.14~22.18，不满足。捆绑独立 node.exe 后，Node 版本由我们锁定，与 Electron 升级互不干扰 |
| 3 | host 运行方式 | **子进程**（`windowsHide: true` 隐藏窗口） | 隔离性好：host 崩溃不影响壳；壳的 Node 版本与 host 解耦；进程树由壳管理（关窗 → `taskkill /T` 杀树） |
| 4 | 端口分配 | **`--port 0`**（OS 自动分配）+ 解析 host 打印的 URL | 避免固定端口被占用导致启动失败。web 应用支持 `port: 0`（config-catalog 确认）；`printUrl` 默认 `true`，输出格式 `dsh web: http://127.0.0.1:PORT`（见 `packages/bundle/web-app/src/index.ts`） |
| 5 | 用户数据 | 应用私有 **DSH_HOME**（`%APPDATA%/dsh-desktop/dsh-home`） | 与用户机器上已有的 dsh 实例（`C:\Users\<user>\.dsh`）互不干扰；同一 DSH_HOME 下并发跑两个 web host 会有 SQLite 锁冲突风险，隔离最稳妥 |
| 6 | 生命周期 | 关窗 → 杀 host 进程树 → 退出 | 不留孤儿进程 |
| 7 | host 定位 | **启动命令可配置** | 开发模式：从 PATH/环境变量找 dsh（本机暂无 PATH 上的 dsh，开发时通过 `DSH_DESKTOP_DSH` 指定，如指向 `D:\deepseek-harness` 的 `pnpm dsh`）；打包模式：固定用包内 `resources/node.exe + resources/dsh/`。留这个口子，将来"自包含升级/换版本"不用改壳代码 |
| 8 | 版本可见性 | 窗口标题、关于页、Release 文件名均带 **dsh 版本号** | 用户一眼知道包内是什么版本 |

### 3.1 启动时序

```
双击 exe
  → Electron 主进程就绪
  → spawn [resources/node.exe, resources/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js,
           --profile web, --port 0]   （windowsHide: true，无控制台窗口）
  → 监听 stdout/stderr，正则匹配 "dsh web: http://127.0.0.1:<port>"
  → 窗口就绪后 BrowserWindow 加载该 URL
  → 关窗 → taskkill /T 杀 host 进程树 → 退出
```

超时保护：30s 内拿不到 URL 则弹错误对话框并退出。

---

## 4. 项目结构

```
dsh-desktop/
├── package.json              # Electron 应用（main: src/main.js）
├── electron-builder.yml      # portable 单 exe 配置
├── src/
│   ├── main.js               # 主进程：拉起 host、窗口、生命周期
│   └── preload.js            # （最小化，预留）
├── scripts/
│   └── build-release.mjs     # 构建发布脚本（见 §5）
├── resources/                # 构建产物（gitignore）
│   ├── node.exe              # 官方 Node，锁版本
│   ├── dsh/                  # npm 安装的 @deepseek-ai/dsh 整棵树
│   └── version.json          # { dsh: "x.y.z", node: "x.y.z" } 构建记录
├── dist/                     # 构建输出（gitignore）：portable exe + latest.yml
└── DESIGN.md
```

---

## 5. 构建与版本管理：保证"每次下载都是最新 dsh"

### 5.1 核心机制

**最新版 dsh 在"打包时"固化进 exe，不是下载时动态决定**。保证"下载即最新"靠自动构建流水线，不靠运气：

```
npm 发布 @deepseek-ai/dsh 新版本
  → 检测（轮询 npm registry，比对上次构建版本，变了才继续）
  → 干净安装最新版到 resources/dsh/
  → 下载官方 node.exe（锁版本）
  → electron-builder 重打包 → 新 portable exe + latest.yml
  → 发布 Release（版本号 = dsh 版本号）
```

### 5.2 构建脚本要点（`scripts/build-release.mjs`）

1. `npm view @deepseek-ai/dsh version` 查询最新版本；
2. 与 `resources/version.json` 中记录的上次构建版本比对，**没变化则不重打包**（支持 `--force`）；
3. 按查到的版本**干净安装**：`npm install --prefix resources/dsh @deepseek-ai/dsh@<version> --no-audit --no-fund`（清缓存/旧 lockfile，防止装回旧版）；
4. 下载官方 node.exe：从 `https://nodejs.org/dist/index.json` 取最新 v24.x，仅解压 `node.exe`（Windows 下单文件即完整运行时，含内置 `node:sqlite`）；
5. 写入 `resources/version.json` 与 `dist/` 产物（文件名带版本号）。

### 5.3 更新通道：两段式

| 用户 | 通道 | 说明 |
|------|------|------|
| **新用户** | 从 Releases 页下载 exe | 永远是最近一次构建 = 当前最新 |
| **老用户** | 应用内自动更新（electron-updater） | 启动时读 `latest.yml` 比对 → 有新版静默下载 → 重启生效 |

`latest.yml` 由 electron-builder 生成，可挂在 GitHub Releases，也可挂任意静态服务器（Gitee / 对象存储 / NAS / 共享文件夹）。

### 5.4 自动化演进

| 阶段 | 方式 | 自动化程度 |
|------|------|-----------|
| 现在 | 本地跑 `npm run build:release` | 手动（脚本已内置版本检测） |
| GitHub 开源后 | GitHub Actions 定时任务（每日 cron） | 全自动：检测 → 打包 → 发布 |

**已知小坑**：GitHub 定时任务在仓库连续 60 天无活动时自动暂停；届时手动触发一次 workflow 或随便提交一次即可恢复。

---

## 6. 更新策略

- **v1（本设计落地）**：**整体更新**——每次 dsh 更新 = 重新发布一个 ~150MB 的新 exe，老用户整包更新。简单、可靠，体积不是问题（已确认）。
- **v2（可选演进）**：**应用内只更新 dsh 运行时**——下载新 dsh 包 → 原子替换 `resources/dsh/` → 重启 host；保留上一版本目录，出问题一键回滚。架构上"启动命令可配置"（决策 #7）已为此留好口子。

---

## 7. 分发注意事项

1. **体积**：portable exe 预估 100~150MB（Electron 本体 ~90MB + Node + dsh 依赖树 + 前端 dist）。自包含的正常代价。
2. **代码签名**：未签名的 exe 双击会弹 SmartScreen"未知发布者"警告。个人分发可接受；正式分发需购买 Windows 代码签名证书。
3. **API Key**：dsh 需要 `DEEPSEEK_API_KEY`，由最终用户在应用内设置界面配置（dsh 自带设置/凭证能力）。
4. **用户数据**：会话、设置存 `%APPDATA%/dsh-desktop/dsh-home`，更新、卸载都不丢失。
5. **沙箱与工具**：bash/pwsh、文件系统、审批等能力全部跟随 host 进程走，客户端只做窗口和展示，安全边界留在 host 侧（dsh 的设计意图）。

---

## 8. 里程碑

| 里程碑 | 内容 | 验收标准 |
|--------|------|---------|
| **M1 本地原型** | Electron 壳：隐藏拉起 host、窗口、关窗退出 | 开发模式跑通：一个窗口打开 dsh web |
| **M2 自包含打包** | build-release 脚本 + 捆绑 node.exe + dsh + portable exe | 本机双击 exe 即用；关窗即退 |
| **M3 GitHub 开源** | 仓库结构、README、LICENSE、.gitignore、.github/workflows | 克隆即能本地构建 |
| **M4 自动发布** | Actions 每日检测 dsh 版本，自动重打包发 Release | npm 发新版后 24h 内出最新 exe |
| **M5（可选）** | 应用内仅更新 dsh 运行时 + 回滚 | 老用户小流量增量更新 |

---

## 9. 附录：已核实的 dsh 事实（含出处）

| 事实 | 出处 |
|------|------|
| dsh 要求 Node `^22.19.0 \|\| >=24.0.0` | `D:\deepseek-harness\package.json`（engines） |
| 无原生编译依赖；SQLite 用 Node 内置 `node:sqlite` | `packages/session/session-query-sqlite/src/*` 等 |
| Web 应用支持 `port: 0`（OS 分配端口） | `docs/config-catalog.md`（webserver 配置） |
| `printUrl` 默认 `true`，打印 `dsh web: http://127.0.0.1:PORT` | `packages/bundle/web-app/src/index.ts`（L40/53/168） |
| `dsh web` 启动参数：`--host --port --trusted-host` | `packages/bundle/web-app/README.md` |
| web / headless profile 首次使用自动初始化 | `apps/cli/README.md` |
| 外部插件安装：`dsh plugin --profile <name> add <spec>`（turtle-ui 先例） | `apps/cli/reference/README.zh.md` |
| 客户端插件机制（`dsh.client`，浏览器内 UI 定制） | `docs/subsystems/client-modules.md` |
| 桌面壳与 UI 定制是两个正交维度，可叠加 | — |
| MIT 许可，可自由分发/闭源（保留版权声明） | `D:\deepseek-harness\LICENSE` |
| CLI 为 npm 包 `@deepseek-ai/dsh`（bin: `dsh`） | `apps/cli/package.json` |

**本机环境（2026 年记录）**：Node v24.16.0 / npm 11.13.0 / pnpm 11.21.0；DSH_HOME=`C:\Users\Administrator\.dsh`；PATH 上暂无 `dsh`（开发模式需通过 `DSH_DESKTOP_DSH` 指定，如 `D:\deepseek-harness` 的 `pnpm dsh`）；本机 npm 的 PowerShell 包装脚本（npm.ps1）报 `$LASTEXITCODE` 错误，命令一律用 `npm.cmd`。

---

## 10. 待确认 / 待办

- [ ] M1：搭建 Electron 壳骨架并本地跑通
- [ ] M2：build-release 脚本与自包含打包验证
- [ ] 开发模式 dsh 定位方式定稿（环境变量 vs PATH 探测）
- [ ] 应用名 / 图标 / 关于页文案（开源前定）
- [ ] GitHub 仓库名与 README（开源时定）
