# dsh-peekedit

Enhanced file tools for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) (`dsh`).

Three model-facing tools that complement (and never shadow) the built-in `read` / `write` / `edit` tools, sharing the same `ctx.fs` service, `fs/*` policy events, and sandbox enforcement:

| Tool | Purpose |
|---|---|
| `peek` | View a file with a line window (`view_range`) or a directory up to 2 levels deep. Numbered lines, total-line count, and a clipping notice on long output. |
| `peek_edit` | Mutate an existing file: unique-literal `str_replace` or line `insert`. |
| `peek_write` | Create a new file or overwrite an existing one. |

Everything goes through the mounted `ctx.fs` backend and the `fs/*` event gate, so sandbox fencing, read-before-edit policy, and remote filesystem backends work exactly as they do for the built-in tools.

## Install

The package ships a `dsh.bundle` manifest, so it installs as a plugin bundle into a profile:

```sh
dsh plugin --profile web add dsh-peekedit        # from npm
dsh plugin --profile web add ./dsh-peekedit      # from a checkout / tarball
dsh plugin --profile web add github:you/dsh-peekedit
```

Verify the layer before booting:

```sh
dsh --profile web --dump-config
```

Or load it ad hoc with a patch overlay:

```sh
dsh web --patch ./cordis.patch.yml
```

> On Windows, an ad-hoc patch that references the package by name resolves from the profile's dependency tree only after `dsh plugin add`. To point a patch at a local checkout directly, use a `file://` URL: `name: 'file:///H:/path/to/dsh-peekedit/lib/index.js'` (the loader rejects bare drive-letter paths).

Git installs run the package's `prepare` script (tsdown build) — allow it once in the profile's `pnpm-workspace.yaml` (`allowBuilds: dsh-peekedit: true`) if your pnpm refuses, and pin a commit for anything you don't trust.

## Configuration

All keys are optional:

| Key | Default | Meaning |
|---|---:|---|
| `maxOutputChars` | `16000` | Characters retained for a `peek` file view before the clipping notice. |

```yaml
# cordis.patch.yml (your profile / home layer)
- id: tool-peekedit
  config:
    maxOutputChars: 32000
```

## Tools

### `peek` — view a file or directory

```jsonc
{
  "path": "/repo/src/index.ts",
  "view_range": [11, 40]      // optional; [start, -1] reads to EOF
}
```

File views return numbered lines (`cat -n` style) with a total-line header; directory views list entries 2 levels deep, excluding hidden items, `node_modules`, and Python cache directories, sorted by path. Long output is truncated with a `<response clipped>` notice. Reads emit `fs/observed`, so the read-before-edit policy (when mounted) recognizes the target as observed.

### `peek_edit` — modify an existing file

```jsonc
{ "command": "str_replace", "path": "/repo/src/index.ts", "old_str": "foo", "new_str": "bar" }
{ "command": "insert", "path": "/repo/src/index.ts", "insert_line": 12, "new_str": "const x = 1" }
```

- `str_replace` requires the `old_str` literal to match **exactly once**; zero matches (`FS_EDIT_NOT_FOUND`) and ambiguous matches (`FS_AMBIGUOUS_EDIT`, with the offending line numbers) are reported as errors, never silently applied.
- `insert` inserts after the zero-based `insert_line` (range `[0, lineCount]`) without an implicit trailing newline.
- Mutations run through the `fs/edit-intent` waterfall and are written version-guarded (`replaceIfVersion`), so a stale edit after an external change fails instead of clobbering it.

### `peek_write` — create or overwrite

```jsonc
{ "command": "create", "path": "/repo/new.ts", "file_text": "export const x = 1" }
{ "command": "overwrite", "path": "/repo/old.ts", "file_text": "..." }
```

- `create` refuses when the path already exists (`createIfAbsent`).
- `overwrite` replaces the whole file content with a version guard (`replaceIfVersion`).
- Both run through the `fs/write-intent` waterfall.

## Requirements

- Node.js ≥ 20
- DeepSeek Harness with the `@deepseek-ai/dsh-*` `0.1.0-rc.6` packages (or newer) reachable from the profile's dependency tree

## Development

```sh
npm install
npm test          # vitest unit + integration suites
npm run build     # tsdown → lib/
```

## License

MIT
