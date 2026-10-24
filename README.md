# dsh-asc-cli

> Published on npm as [`@sleep9ull/dsh-asc-cli`](https://www.npmjs.com/package/@sleep9ull/dsh-asc-cli). Renamed from `dsh-asc-cli@0.1.0`; the old name is deprecated.

**App Store Connect operations for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), powered by the [`asc` CLI](https://github.com/rorkai/App-Store-Connect-CLI).**

`@sleep9ull/dsh-asc-cli` is a DeepSeek Harness **bundle plugin**. It does not reimplement the App Store Connect API — `asc` (a Go binary) remains the execution engine. The plugin turns `asc` into something an agent can use safely and productively:

- **Read-only by default.** Mutations need an explicit `confirm` and a host approval.
- **Typed, intent-level tools** for the release workflows that matter, with `asc_run` + `asc_search` for the long tail.
- **Compact, structured results** instead of raw JSON floods.
- **Works with the official ASC skill pack** (`asc install-skills`), which DeepSeek Harness reads natively.

> This is a plugin, not a CLI replacement. You still install and authenticate `asc` once.

## Requirements

| Requirement | Version |
|---|---|
| DeepSeek Harness | `0.2.1-rc.2` line (`engines.dsh: >=0.2.1-rc.2 <0.3.0`) |
| Node.js | ≥ 22.19 (24 recommended) |
| `asc` | contract-tested against `5.16.0`; designed for `5.11+` |
| App Store Connect API key | team or individual key, authenticated **outside** the agent |

Install `asc`:

```bash
brew install asc
# or
curl -fsSL https://asccli.sh/install | bash
```

Authenticate once, in your own terminal (never through the agent):

```bash
asc auth login \
  --name "MyApp" \
  --key-id "ABC123" \
  --issuer-id "DEF456" \
  --private-key /path/to/AuthKey.p8

asc auth status --validate
```

For CI/headless machines without keychain access, use `--bypass-keychain` and set `bypassKeychain: true` in the plugin config.

## Install

From npm (published package):

```bash
dsh plugin --profile desktop add @sleep9ull/dsh-asc-cli
```

From a checkout or tarball:

```bash
npm run build && npm pack
dsh plugin --profile desktop add ./sleep9ull-dsh-asc-cli-0.1.2.tgz
```

Restart or reload the profile. The first boot of a profile created from a shipped template may materialize that template's user patch file, so edit `cordis.patch.yml` **after** the first boot (or pass an overlay with `--patch`). The bundle inserts one row:

```yaml
# shipped by the package
- insert:
    - id: asc-tools
      name: '@sleep9ull/dsh-asc-cli'
      config:
        mode: read-only
```

Override it in `~/.dsh/profiles/<profile>/cordis.patch.yml`. A patch **replaces the whole config**, so restate every key you need:

```yaml
- id: asc-tools
  name: '@sleep9ull/dsh-asc-cli'
  config:
    mode: write          # required for uploads / submissions / metadata apply
    requireApproval: true
    profile: MyApp       # asc --profile
    defaultAppId: "123456789"
```

## Quick start

Once authenticated:

```text
List my App Store Connect apps and pick the one with bundle id com.example.app.
```

```text
Is version 1.2.3 ready to submit? Show me the blockers and what to fix first.
```

```text
Upload ./build/MyApp.ipa as 1.2.3 build 42 to the Internal Testers group.
```

The last one will stop for approval before touching App Store Connect.

## Tools

| Tool | Actions | Mutates ASC |
|---|---|---|
| `asc_setup` | `version`, `auth-status`, `doctor`, `system-status`, `install-skills` | no (skills installs local files) |
| `asc_search` | — | no |
| `asc_run` | any `asc` argv | classified per command |
| `asc_apps` | `list`, `view` | no |
| `asc_builds` | `list`, `next-number`, `upload`, `add-groups` | `upload`, `add-groups` |
| `asc_testflight` | `feedback`, `crashes`, `groups` | no |
| `asc_metadata` | `init`, `validate`, `plan`, `apply` | `apply` (use `dryRun` first) |
| `asc_release` | `status`, `validate`, `stage`, `publish` | `stage`, `publish` |

Each result is a compact JSON value:

```jsonc
{
  "ok": true,
  "exitCode": 0,
  "command": "asc --read-only apps list --limit 20 --output json",
  "durationMs": 812,
  "summary": "3 item(s)\n- id=123 name=Focus bundleId=com.example.focus",
  "data": { /* full parsed JSON, when small enough */ },
  "truncated": false
}
```

Failures add `errorClass` (`auth`, `state-conflict`, `rate-limit`, `usage`, `missing-binary`, `network`, `timeout`, `cancelled`, `parse`, `unknown`) and an actionable `hint`. Oversized output is capped and spilled to a file (`spillPath`).

## Safety model

- **Read-only mode (default).** Every call gets `--read-only` and `ASC_READ_ONLY=1`. Mutating actions are refused *before a child process starts*.
- **Write mode.** Mutations require `confirm: true` **and** (by default) a host approval prompt showing the tool action. The plugin never adds `--confirm` on its own.
- **Unknown commands are never silent.** A command the classifier cannot prove read-only is escalated to a human (`ask`, the default) or refused (`unknownCommands: deny`). Write mode additionally requires `confirm: true`; a model-authored `confirm` alone never bypasses the approval prompt.
- **Local writes need confirmation and approval.** `metadata init`, `metadata plan` (it writes a review artifact), `docs init`, `doctor --fix`, `builds dsyms` and `install-skills` require `confirm: true` and, by default, a host approval prompt.
- **No value expansion by default.** `asc` expands `@env:NAME` / `@file:PATH` in flag values, which would let a model argument read any local file into the result. The plugin escapes a leading `@` (`@` → `@@`) unless `allowValueExpansion: true`.
- **Credentials stay outside the model.** The plugin forwards `ASC_KEY_ID` / `ASC_ISSUER_ID` / `ASC_PRIVATE_KEY_PATH` / `ASC_PRIVATE_KEY` to the child because the harness scrubs credential-shaped variables, but it never reads, stores, or prints key material. Authenticate with `asc auth login` in your own terminal.
- **Always refused:** `auth login` / `auth logout`, web-session commands, interactive prompts, and anything that would carry private key material.
- **No shell.** argv is passed as an array.
- **Secret hygiene.** Diagnostics are redacted (`PRIVATE KEY`, JWTs, `password=`), telemetry is disabled by default, and the plugin never reads or stores credentials.
- **Cancellation and deadlines** are forwarded to the child process; long actions use `longTimeoutMs`.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `ascPath` | `"asc"` | `asc` executable (PATH name or absolute path) |
| `profile` | — | `asc --profile` |
| `mode` | `"read-only"` | `read-only` or `write` |
| `requireApproval` | `true` | Ask the host approval service before mutations |
| `timeoutMs` | `60000` | Ordinary command timeout |
| `longTimeoutMs` | `1800000` | Uploads, release waits |
| `maxOutputBytes` | `262144` | Model-facing cap before spill |
| `workdir` | — | Override the session working directory |
| `bypassKeychain` | `false` | Set `ASC_BYPASS_KEYCHAIN=1` |
| `telemetryDisabled` | `true` | Set `ASC_TELEMETRY_DISABLED=1` |
| `allowValueExpansion` | `false` | Allow `asc`'s `@env:` / `@file:` value expansion |
| `unknownCommands` | `"ask"` | `ask` or `deny` for commands the classifier cannot prove read-only |
| `env` | `{}` | Extra environment for `asc` |
| `defaultAppId` | — | Fallback when a tool call omits `app` |

## Skills

Install the official ASC agent skills once:

```text
Use asc_setup with action install-skills.
```

or run `asc install-skills` yourself.

DeepSeek Harness discovers skills from `<project>/.dsh/skills`, `<project>/.agents/skills`, `customSkillDirs`, `~/.dsh/skills`, `~/.agents/skills`, and `$DSH_BUNDLED_SKILL_DIR` (priority 100 → 600). **`~/.claude/skills` is not scanned.** `asc install-skills` writes to `~/.agents/skills`, which DSH does read; the 25 upstream ASC skills then appear in the session skill catalog (start a new session after installing).

## Compatibility and upstream updates

`asc` ships frequently (5.16.0 was published 2026-10-19). The plugin keeps upgrades cheap:

- All command shapes live in one registry (`src/registry.ts`).
- Every command is passed through `asc --help` in a contract test (`scripts/contract.mjs`), so a renamed command or flag fails CI instead of failing at runtime. The test validates command and flag *names*; flag values and combinations are covered by unit tests.
- The generic `asc_search` / `asc_run` tools keep new upstream commands usable without a plugin release. Commands that reject `--output` are retried once without it, and unrecognized commands are escalated to a human instead of being refused silently.
- `engines.dsh` and peer dependency ranges pin the DSH contract.

Tested matrix is documented per release; raise an issue with `asc version` and `asc capabilities --output json` output when something drifts.

## Development

```bash
npm install
npm run build        # tsc -> lib/
npm run typecheck
npm test             # vitest

# contract test against a real binary
node scripts/contract.mjs ./vendor/asc

# smoke test the compiled runtime against a real binary
node scripts/smoke.mjs

# boot a separate dev instance with this checkout mounted
dsh web --patch ./dev/cordis.patch.yml --no-open --port 3199
```

`dev/cordis.patch.yml` inserts `lib/index.js` by absolute path; rebuild and restart to pick up changes.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `asc` not found | `brew install asc`, or set `ascPath` |
| `auth` error / exit 3 | `asc auth status --validate`; check the API key role in App Store Connect |
| Keychain prompt hangs | Authenticate in a terminal first, or use `bypassKeychain: true` |
| Mutation refused | The plugin is read-only: switch the `asc-tools` row to `mode: write` and retry with `confirm: true` |
| Approval prompt missing in CI | `requireApproval: true` needs an approval answerer; set it to `false` only in a trusted CI profile |
| Huge JSON results | Results are capped + spilled; narrow the command (filters/limit) |
| pnpm peer warnings on install | Expected: DSH provides the `@deepseek-ai/*` peers at runtime; the plugin resolves them from the host |

## License

MIT
