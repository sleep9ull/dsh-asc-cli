# dsh-asc-cli

> Published on npm as [`@sleep9ull/dsh-asc-cli`](https://www.npmjs.com/package/@sleep9ull/dsh-asc-cli). Renamed from `dsh-asc-cli@0.1.0`; the old name is deprecated.

**App Store Connect operations for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), powered by the [`asc` CLI](https://github.com/rorkai/App-Store-Connect-CLI).**

`@sleep9ull/dsh-asc-cli` is a DeepSeek Harness **bundle plugin**. It does not reimplement the App Store Connect API — `asc` (a Go binary) remains the execution engine. The plugin turns `asc` into something an agent can use safely and productively:

- **Read-only by default.** Mutations need an explicit `confirm` and a host approval.
- **An intent-shaped tool surface** (`asc` / `asc_plan` / `asc_apply` / `asc_setup`) plus an `asc.run` escape hatch for the long tail.
- **Compact, structured results** instead of raw JSON floods.
- **Works with the official ASC skill pack** (`asc install-skills`), which DeepSeek Harness reads natively.

> This is a plugin, not a CLI replacement. You still install and authenticate `asc` once.

## Requirements

| Requirement | Version |
|---|---|
| DeepSeek Harness | `0.2.1-rc.2` line (`engines.dsh: >=0.2.1-rc.2 <0.3.0`) |
| Node.js | ≥ 22.19 (24 recommended) |
| `asc` | pinned `5.16.0`; tested range `>=5.16.0 <6.0.0` (`/asc-doctor` reports drift) |
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

After installing, run `/asc` (or `/asc-doctor`): it reports the engine, authentication, default app and the one next step, without involving the model.

```text
/asc
```

Then, once authenticated:

```text
List my App Store Connect apps and pick the one with bundle id com.example.app.
```

```text
Is version 1.2.3 ready to submit? Show me the blockers and what to fix first.
```

```text
Upload ./build/MyApp.ipa as 1.2.3 build 42 to the Internal Testers group.
```

The last one runs the `ship-testflight` job and stops for approval before touching App Store Connect.

## Commands

| Command | What it does |
|---|---|
| `/asc` | Capability card: engine state, the five jobs, low-level tools, next step |
| `/asc-doctor` | Full diagnosis: binary and source, version vs tested range, auth, default app, provisioning |

Commands run directly against the host without creating a model message, and only probe read-only state.

## Jobs

`asc_job` is the preferred entry point for delivery work: one call, a plan-shaped result, per-step summaries.

| Job | Risk | What it does |
|---|---|---|
| `release-check` | read | Runs `asc validate`, returns blockers and ordered remediation steps |
| `ship-testflight` | write | Uploads an `.ipa`/`.pkg` (waits for processing), extracts the build id, adds it to a TestFlight group (optional beta review) |
| `stage-release` | write | Validates, then prepares the version (metadata + build) without submitting |
| `triage-feedback` | read | Aggregates TestFlight feedback, crashes and reviews |
| `compliance-sweep` | read | Probes age rating, encryption declarations, accessibility and current pricing; failed probes are reported, not fatal |

Write jobs need `mode: write`, `confirm: true` and host approval; pass `dryRun: true` first.

## Tools

The surface is organised by intent: **read**, **plan**, **apply**, **workflow**, **environment**.

| Tool | Actions | Mutates ASC |
|---|---|---|
| `asc_job` | `release-check`, `ship-testflight`, `stage-release`, `triage-feedback`, `compliance-sweep` | write jobs only |
| `asc` | `apps-list`/`apps-view`, `builds-list`/`builds-next-number`, `testflight-feedback`/`-crashes`/`-groups`, `reviews-list`, `metadata-validate`, `discover`, `run` | `run` only, classified per command |
| `asc_plan` | `validate`, `status`, `metadata-plan` | `metadata-plan` writes a local review artifact |
| `asc_apply` | `upload`, `groups`, `metadata-init`, `metadata-apply`, `stage`, `publish` | yes (all except none) |
| `asc_setup` | `version`, `auth-status`, `doctor`, `system-status`, `diagnose`, `provision`, `install-skills` | `provision` writes the plugin cache; `install-skills` writes local files |

Each result is a compact JSON value:

```jsonc
{
  "ok": true,
  "exitCode": 0,
  "command": "asc --read-only apps list --limit 20 --output json",
  "durationMs": 812,
  "summary": "3 item(s)\n- id=123 name=Focus bundleId=com.example.focus",
  "data": { /* parsed JSON, omitted above maxDataBytes */ },
  "truncated": false
}
```

Failures add `errorClass` (`auth`, `state-conflict`, `rate-limit`, `usage`, `missing-binary`, `network`, `timeout`, `cancelled`, `parse`, `unknown`) and an actionable `hint`. Payloads larger than `maxDataBytes` (default 8 KB) set `dataOmitted`/`dataBytes` instead of flooding the context; oversized stdout is capped and spilled to a file (`spillPath`).

`validate` results are projected to `blocking/errors/warnings` plus ordered remediation steps, `status` to `health/nextAction/blockers/nextCommands`, and `metadata` to its counters.

### Migrating from 0.1.3

0.1.4 consolidates the tool surface. Old tools are gone; use the mapping below.

| 0.1.3 | 0.1.4 |
|---|---|
| `asc_search` | `asc` action `discover` |
| `asc_run` | `asc` action `run` |
| `asc_apps` `list`/`view` | `asc` `apps-list`/`apps-view` |
| `asc_builds` `list`/`next-number` | `asc` `builds-list`/`builds-next-number` |
| `asc_builds` `upload`/`add-groups` | `asc_apply` `upload`/`groups` |
| `asc_testflight` `feedback`/`crashes`/`groups` | `asc` `testflight-feedback`/`-crashes`/`-groups` |
| `asc_metadata` `validate` | `asc` `metadata-validate` |
| `asc_metadata` `init`/`plan`/`apply` | `asc_apply` `metadata-init`; `asc_plan` `metadata-plan`; `asc_apply` `metadata-apply` |
| `asc_release` `status`/`validate`/`stage`/`publish` | `asc_plan` `status`/`validate`; `asc_apply` `stage`/`publish` |

`asc_job` and `asc_setup` keep their names (jobs gain `compliance-sweep`).

## Safety model

- **Read-only mode (default).** Every call gets `--read-only` and `ASC_READ_ONLY=1`. Mutating actions are refused *before a child process starts*.
- **Write mode.** Mutations require `confirm: true` **and** (by default) a host approval prompt showing the tool action. The plugin never adds `--confirm` on its own.
- **Approval exemptions are explicit.** `approvedActions` accepts glob labels (for example `asc_apply.upload` or `asc_apply.*`) to skip the prompt for known actions in write mode. Exemptions never relax read-only mode, `confirm`, or the forbidden list.
- **Audit trail is opt-in.** Set `auditLog` to a file path and every executed invocation appends one redacted JSONL line (tool, action, argv, mode, confirm, exit code, duration, error class). Approval decisions stay in the DSH session log.
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
| `allowProvision` | `false` | Allow `asc_setup` action `provision` to download the pinned engine |
| `cacheDir` | — | Override the provisioned-binary cache (`$DSH_HOME/cache/asc-cli`) |
| `maxDataBytes` | `8000` | Omit `data` above this JSON size (`dataOmitted` + `dataBytes`) |
| `auditLog` | — | Append a JSONL audit line per executed invocation |
| `approvedActions` | `[]` | Glob labels that skip the approval prompt in write mode |
| `checkUpdates` | `true` | Show the latest asc release in `/asc-doctor` (cached 24h, never auto-upgrades) |
| `env` | `{}` | Extra environment for `asc` |
| `defaultAppId` | — | Fallback when a tool call omits `app` |

## Bundled skills

The package ships six skills (`skills/`), registered through the host skill registry at the bundled rank (600), so a fresh install is enough — no `git`, no global skill directory, no manual `asc install-skills`:

| Skill | Covers |
|---|---|
| `dsh-asc-quickstart` | First run, choosing between jobs / `asc` / `asc_plan` / `asc_apply` / `asc.run`, reading results and errors |
| `dsh-asc-auth` | Authentication, profiles, exit 3 / 401 / 403, CI and keychain, key hygiene |
| `dsh-asc-release-readiness` | Release-check report, remediation ordering, plan/apply, stage vs submit |
| `dsh-asc-testflight-ship` | Build numbers, upload, processing states, internal vs external groups, recovery |
| `dsh-asc-feedback-triage` | Feedback/crash grouping, review reply drafts, rate limits, privacy |
| `dsh-asc-compliance-sweep` | Age rating, encryption, accessibility, pricing; which findings are manual/web-only |

Because bundled rank is the lowest priority, a user-installed upstream pack wins same-named skills. To add the official 25-skill pack anyway:

```bash
asc install-skills   # writes ~/.agents/skills, which DSH reads
```

DeepSeek Harness discovers skills from `<project>/.dsh/skills`, `<project>/.agents/skills`, `customSkillDirs`, `~/.dsh/skills`, `~/.agents/skills`, and `$DSH_BUNDLED_SKILL_DIR` (priority 100 → 600). **`~/.claude/skills` is not scanned.**

## Engine management

`asc` stays an external engine; the plugin owns the experience:

| Step | How |
|---|---|
| Locate | `ascPath` → `ASC_CLI_PATH` → plugin cache → `PATH` |
| Diagnose | `/asc-doctor` or `asc_setup` with action `diagnose` |
| Install | `brew install asc`, or enable `allowProvision` and run `asc_setup` action `provision` |
| Provision | Downloads the pinned `asc 5.16.0` release asset for your platform, verifies it against the published checksums, and caches it under `$DSH_HOME/cache/asc-cli/<version>/<platform>-<arch>/` |
| Verify | Version is compared with `>=5.16.0 <6.0.0`; drift is reported, never auto-fixed |

Provisioning never runs implicitly: it needs `allowProvision: true`, an explicit `confirm` and host approval.

## Compatibility and upstream updates

`asc` ships frequently (5.16.0 was published 2026-10-19; the plugin pins that release and tests `>=5.16.0 <6.0.0`). The plugin keeps upgrades cheap:

- All command shapes live in one registry (`src/registry.ts`).
- Every command is passed through `asc --help` in a contract test (`scripts/contract.mjs`), so a renamed command or flag fails CI instead of failing at runtime. The test validates command and flag *names*; flag values and combinations are covered by unit tests.
- `asc` action `discover` (upstream `asc search`) and `run` (any argv) keep new upstream commands usable without a plugin release. Commands that reject `--output` are retried once without it, and unrecognized commands are escalated to a human instead of being refused silently.
- `/asc-doctor` compares the installed engine with the latest upstream release (24h cache) and suggests an upgrade; the plugin never upgrades by itself.
- `engines.dsh` and peer dependency ranges pin the DSH contract.
- `/asc-doctor` compares the installed engine with the tested range and suggests either `brew upgrade asc` or a pinned `provision`; it never upgrades silently.

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
