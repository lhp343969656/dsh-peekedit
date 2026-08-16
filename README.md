# dsh-peekedit

[![npm version](https://img.shields.io/npm/v/dsh-peekedit.svg)](https://www.npmjs.com/package/dsh-peekedit)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**English** · [简体中文](README.zh-CN.md)

Enhanced file tools **and a file browser** for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) (`dsh`).

Source: <https://github.com/lhp343969656/dsh-peekedit> · Issues: <https://github.com/lhp343969656/dsh-peekedit/issues>

## What you get

**Model-facing tools** that complement (and never shadow) the built-in `read` / `write` / `edit` tools, sharing the same `ctx.fs` service, `fs/*` policy events, and sandbox enforcement:

| Tool | Purpose |
|---|---|
| `peek` | View a file with a line window (`view_range`) or a directory up to 2 levels deep. Numbered lines, total-line count, and a clipping notice on long output. |
| `peek_edit` | Mutate an existing file: unique-literal `str_replace` or line `insert`. |
| `peek_write` | Create a new file or overwrite an existing one. |

**File browser UI** (Web Client): a "📁 文件" button in the session header opens a side drawer showing the current session's workspace directory — click into folders, click a file to preview it, and edit + save right there. Reads and writes go through the same `ctx.fs` seam; the browser never bypasses sandbox or containment rules (paths are resolved inside the session workspace and `..` escapes are rejected).

Everything goes through the mounted `ctx.fs` backend and the `fs/*` event gate, so sandbox fencing, read-before-edit policy, and remote filesystem backends work exactly as they do for the built-in tools.

## Install

The package ships a `dsh.bundle` manifest, so it installs as a plugin bundle into a profile.

**Recommended** — from npm:

```sh
dsh plugin --profile web add dsh-peekedit
```

Alternatively, from a git repository (builds on install via the `prepare` script) or a local checkout / tarball:

```sh
dsh plugin --profile web add github:lhp343969656/dsh-peekedit
dsh plugin --profile web add ./dsh-peekedit
```

> The browser half of the plugin (`dsh.client` bundle) is discovered only when the package resolves from the profile's dependency tree, so install it with `dsh plugin add` rather than a `file://` patch overlay.

Verify the layer before booting:

```sh
dsh --profile web --dump-config
```

Or load it ad hoc with a patch overlay (tools only — the browser half needs a real install):

```sh
dsh web --patch ./cordis.patch.yml
```

> On Windows, an ad-hoc patch that references the package by name resolves from the profile's dependency tree only after `dsh plugin add`. To point a patch at a local checkout directly, use a `file://` URL: `name: 'file:///H:/path/to/dsh-peekedit/lib/index.js'` (the loader rejects bare drive-letter paths).

Git installs run the package's `prepare` script (tsdown build) — allow it once in the profile's `pnpm-workspace.yaml` (`allowBuilds: dsh-peekedit: true`) if your pnpm refuses, and pin a commit for anything you don't trust.

## Configuration

The bundle inserts two plugin rows; each takes its own config.

`dsh-peekedit` (tools):

| Key | Default | Meaning |
|---|---:|---|
| `maxOutputChars` | `16000` | Characters retained for a `peek` file view before the clipping notice. |

`dsh-peekedit/api` (file-browser API, web compositions only):

| Key | Default | Meaning |
|---|---:|---|
| `root` | `process.cwd()` | Fallback browse root when no session cwd resolves. |
| `maxReadChars` | `1000000` | Characters a browser preview read returns; larger files report `FS_TOO_LARGE`. |

```yaml
# cordis.patch.yml (your profile / home layer)
- id: api-peekedit
  config:
    root: 'H:/myproject'
    maxReadChars: 200000
```

## Browser API

Same-origin routes under `/api/peekedit/*` (registered only where a `webServer` is mounted):

| Route | Purpose |
|---|---|
| `GET /api/peekedit/list?session=<id>&path=<rel>` | One directory's children, relative to the session workspace. |
| `GET /api/peekedit/read?session=<id>&path=<rel>` | A file's UTF-8 content (binary rejected, size-capped). |
| `POST /api/peekedit/write` | Replace a file's content; rejects cross-origin `Origin` headers. |

Paths resolve against the calling session's `cwd` (fallback: `root` config) and must stay inside it — `..` segments and containment escapes are `403 PATH_ESCAPE`.

## Requirements

- Node.js ≥ 20
- DeepSeek Harness with the `@deepseek-ai/dsh-*` `0.1.0-rc.6` packages (or newer) reachable from the profile's dependency tree
- The Web Client bundle ships a browser half that needs React 18 (the platform word table provides it)

## Development

```sh
npm install
npm test          # vitest unit + integration suites (host API + client bundle)
npm run build     # tsdown → lib/ (host entries + browser bundle)
```

## License

MIT
