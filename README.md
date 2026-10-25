# ASC for DeepSeek Harness

**Ship to TestFlight, check release readiness, triage feedback and audit compliance — from a conversation.**

English | [中文](README.zh.md)

[![npm](https://img.shields.io/npm/v/@sleep9ull/dsh-asc-cli?label=npm&color=cb3837)](https://www.npmjs.com/package/@sleep9ull/dsh-asc-cli)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.2.1--rc.2-4b5563)](https://github.com/deepseek-ai/deepseek-harness)

App Store Connect is where iOS releases happen — and where teams lose hours to CLI flags, JSON blobs, half-documented states and approval rituals. This plugin puts it inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): install once, ask in plain language, and the agent runs the right workflow, showing a plan and stopping for approval before anything ships.

The [asc CLI](https://github.com/rorkai/App-Store-Connect-CLI) (MIT, Go) remains the engine. This plugin is the product layer around it: five task-shaped **jobs**, a small **read / plan / apply** tool surface, **bundled skills** that teach the agent how to use it, and an **engine manager** that diagnoses, provisions and version-checks `asc`.

```bash
dsh plugin --profile desktop add @sleep9ull/dsh-asc-cli
```

> After installing, run `/asc`. It reports the engine, authentication, default app and the one next step — no model involved.

---

## What you can do

| Ask in the chat | What the plugin runs |
|---|---|
| "Is 1.2.3 ready to submit? Show blockers and fixes." | `release-check` — `asc validate`, then an ordered remediation list |
| "Ship this build to the Internal Testers group." | `ship-testflight` — upload, wait for processing, add the build to a group |
| "Prepare 1.2.3 with this metadata, but don't submit." | `stage-release` — validate, attach the build, apply metadata, stop before submission |
| "What are testers complaining about?" | `triage-feedback` — TestFlight feedback + crashes + reviews, clustered |
| "Are we compliant? Age rating, encryption, accessibility, pricing." | `compliance-sweep` — four read-only probes, best-effort |
| "Anything else — certificates, users, analytics, ads, raw API." | `asc` reads, `discover` to find commands, `run` for the long tail |

Every write follows the same shape: **plan first → `confirm: true` → host approval → execute → auditable result**.

---

## Quick start

### 1 · Install the plugin

```bash
dsh plugin --profile desktop add @sleep9ull/dsh-asc-cli
```

Restart or reload the profile. The plugin inserts one row (`mode: read-only`) into the profile's `cordis.patch.yml`.

### 2 · Get the engine ready

```bash
brew install asc          # or: curl -fsSL https://asccli.sh/install | bash
asc auth login --name "MyApp" --key-id ABC123 --issuer-id DEF456 --private-key /path/to/AuthKey.p8
```

Then run `/asc` — or ask the agent to run `asc_setup` with action `diagnose`. Nothing ready yet? The report gives exactly one next step. Do **not** paste a private key into the chat; authentication stays in your terminal.

Prefer the plugin to fetch the engine? Enable `allowProvision` and run `asc_setup` action `provision`: it downloads the pinned `asc`, verifies the released SHA-256, and caches it under `$DSH_HOME/cache/asc-cli/`.

### 3 · Just ask

```text
List my apps and pick com.example.focus. Set it as the default app.
```

```text
Is 1.2.3 ready to submit? Show the blockers in priority order.
```

```text
Upload ./build/Focus.ipa as 1.2.3 build 42 to the Internal Testers group.
```

The third request runs the `ship-testflight` job; pass `dryRun: true` first if you want to see the plan without touching App Store Connect.

---

## What's inside

### Five jobs

`asc_job` is the preferred entry point: one call, a plan-shaped result, per-step summaries, and a dry-run path where it matters.

| Job | Risk | Does |
|---|---|---|
| `release-check` | read | Runs `asc validate`; returns blocking counts and ordered fixes |
| `ship-testflight` | write | Uploads `.ipa`/`.pkg` (waits), extracts the build id, adds it to a TestFlight group; optional beta review |
| `stage-release` | write | Validates, then prepares the version (metadata + build) without submitting |
| `triage-feedback` | read | Aggregates TestFlight feedback, crashes and reviews |
| `compliance-sweep` | read | Probes age rating, encryption declarations, accessibility, current pricing |

Write jobs need `mode: write`, `confirm: true` and a host approval.

### Five tools

| Tool | Shape | Use for |
|---|---|---|
| `asc_job` | task | Whole workflows (the five jobs above) |
| `asc` | read | apps, builds, TestFlight, reviews, offline metadata validation, plus `discover` and `run` |
| `asc_plan` | plan | `validate`, `status`, `metadata-plan` — never mutates App Store Connect |
| `asc_apply` | write | `upload`, `groups`, `metadata-init`, `metadata-apply`, `stage`, `publish` |
| `asc_setup` | environment | version, auth status, doctor, system status, diagnose, provision, install skills |

### Commands

| Command | What it shows |
|---|---|
| `/asc` | Capability card: engine state, auth, default app, five jobs, next step |
| `/asc-doctor` | Full diagnosis: binary and source, version vs tested range, auth, default app, provisioning, upstream update |

Commands run directly in the host and do not create model messages.

### Six bundled skills

Shipped inside the package, available right after install — no `git`, no global skill directory:

`dsh-asc-quickstart` · `dsh-asc-auth` · `dsh-asc-release-readiness` · `dsh-asc-testflight-ship` · `dsh-asc-feedback-triage` · `dsh-asc-compliance-sweep`

They cover first-run choices, authentication and CI, release readiness, TestFlight shipping, feedback triage and compliance — in the terms of this plugin's tools.

### Engine manager

| Step | What happens |
|---|---|
| Locate | `ascPath` → `ASC_CLI_PATH` → plugin cache → `PATH` |
| Diagnose | version, tested range, auth, default app, provisioning — one next step |
| Provision | optional: pinned `asc 5.16.0`, SHA-256 verified, cached per platform |
| Update | `/asc-doctor` compares with the latest GitHub release (24h cache); suggests `brew upgrade asc`, never upgrades itself |

---

## Documentation

| Document | Covers |
|---|---|
| [Contract](docs/CONTRACT.md) | What the plugin promises and refuses, the policy matrix, the ten invariants |
| [Commands](docs/COMMANDS.md) | Tools, actions, jobs, skills, slash commands, config, result shape |
| [Architecture](docs/ARCHITECTURE.md) | Layers, module map, data flow, extension points |
| [Testing](docs/TESTING.md) | Test patterns, fixtures, known gaps |
| [Contributing](CONTRIBUTING.md) | Setup, Git flow, quality gates, release steps |
| [Specs](docs/SPECS.md) | Spec-first workflow and the spec index |
| [Roadmap](docs/ROADMAP.md) | Version plan and acceptance targets |
| [ASC CLI reference](ASC.md) | Upstream `asc` command catalog and workflow recipes (generated by `asc init`) |

## Why a plugin instead of "just run asc in bash"?

- **Approvals, not vibes.** Read-only by default; writes need an explicit `confirm` and a human approval. The model can't self-approve.
- **Plans before actions.** `validate`, `status` and `--dry-run` are first-class, so the agent shows the change before making it.
- **Results fit in a conversation.** Summaries, ordered fixes and counters replace huge JSON; oversized payloads are omitted with a next step (and a spill pointer only when the raw output was truncated).
- **Jobs, not command soup.** Upload → wait → group is one deterministic call, not five that the model might reorder.
- **The agent already knows the workflow.** Bundled skills explain jobs, policies and failure recovery.
- **Auditable.** Opt-in JSONL audit trail of every tool-initiated `asc` invocation (engine probes excluded); approval decisions stay in the harness session log.

---

## Safety model

- **Read-only mode (default).** Every call gets `--read-only` and `ASC_READ_ONLY=1`; mutations are refused before a child process starts.
- **Write mode.** Mutations require `confirm: true` **and** (by default) a host approval prompt. The plugin adds `--confirm` to the underlying command only when the model passes `confirm: true`; it never invents confirmation.
- **Unknown commands are never silent.** Commands that cannot be proven read-only are escalated to a human (`ask`) or refused (`unknownCommands: deny`); write mode additionally requires `confirm`. Global flags before the command cannot hide a forbidden command.
- **Invalid arguments fail before approval.** Registered actions/jobs validate their flag combinations (exclusive flags, required metadata source, package requirements) before a confirm prompt or a human approval, so a bad call never costs an approval round-trip.
- **Local writes need confirmation and approval.** `metadata init/plan/pull`, `docs init`, `doctor --fix`, `builds dsyms`, `install-skills`, and every file-writing `download`/`export` leaf (`screenshots download`, `profiles download`, `certificates export`, ...).
- **No value expansion by default.** `asc` expands `@env:` / `@file:` in flag values; the plugin escapes a leading `@` unless `allowValueExpansion: true`.
- **Credentials stay outside the model.** The plugin forwards `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY_PATH`, `ASC_PRIVATE_KEY` because the harness scrubs credential-shaped variables, never reads, stores or prints key material, and tombstones `ASC_WEB_SESSION` so a web-session cookie never reaches the child.
- **Always refused:** `auth login/logout` and `asc web`; commands the classifier cannot prove read-only are escalated to a human (`unknownCommands: ask`) or refused (`deny`).
- **No shell.** argv is passed as an array; diagnostics are redacted; telemetry is off by default.
- **Opt-in governance.** `auditLog` records what ran; `approvedActions` can skip the prompt for known actions in write mode only.

---

## Requirements

| Requirement | Version |
|---|---|
| DeepSeek Harness | `0.2.1-rc.2` line (`engines.dsh: >=0.2.1-rc.2 <0.3.0`) |
| Node.js | ≥ 22.19 (24 recommended) |
| `asc` | pinned `5.16.0`; tested range `>=5.16.0 <6.0.0` (`/asc-doctor` reports drift) |
| App Store Connect API key | team or individual key, authenticated **outside** the agent |

---

## Configuration

Override the `asc-tools` row in `~/.dsh/profiles/<profile>/cordis.patch.yml`. A patch replaces the whole config, so restate every key you need:

```yaml
- id: asc-tools
  name: '@sleep9ull/dsh-asc-cli'
  config:
    mode: write            # required for uploads / submissions / metadata apply
    requireApproval: true
    profile: MyApp         # asc --profile
    defaultAppId: "123456789"
    allowProvision: true   # optional: let the plugin fetch the pinned engine
```

| Field | Default | Meaning |
|---|---|---|
| `mode` | `"read-only"` | `read-only` or `write` |
| `requireApproval` | `true` | Ask the host approval service before writes |
| `ascPath` | `"asc"` | `asc` executable (PATH name or absolute path) |
| `profile` | — | `asc --profile` |
| `defaultAppId` | — | Fallback when a tool call omits `app` |
| `timeoutMs` | `60000` | Ordinary command timeout |
| `longTimeoutMs` | `1800000` | Uploads and release waits |
| `maxOutputBytes` | `262144` | stdout cap before spill |
| `maxDataBytes` | `8000` | Omit `data` above this JSON size (`dataOmitted`) |
| `workdir` | — | Override the session working directory |
| `allowValueExpansion` | `false` | Allow `asc`'s `@env:` / `@file:` expansion |
| `unknownCommands` | `"ask"` | `ask` or `deny` for commands that cannot be proven read-only |
| `allowProvision` | `false` | Allow `asc_setup` action `provision` |
| `cacheDir` | — | Override the provisioned-binary cache |
| `bypassKeychain` | `false` | Set `ASC_BYPASS_KEYCHAIN=1` (CI / headless) |
| `telemetryDisabled` | `true` | Set `ASC_TELEMETRY_DISABLED=1` |
| `auditLog` | — | Append one JSONL audit line per executed invocation |
| `approvedActions` | `[]` | Glob labels that skip the approval prompt in write mode |
| `checkUpdates` | `true` | Show the latest release in `/asc-doctor` |
| `env` | `{}` | Extra environment for `asc` |

---

## Skills

The package ships six skills at the bundled rank (600). Priority is: project `.dsh/skills` (100) → project `.agents/skills` (200) → custom (300) → `~/.dsh/skills` (400) → `~/.agents/skills` (500) → bundled (600). A skill you install yourself therefore wins a same-named bundled one — built-in fallback, user override.

Want the official 25-skill ASC pack as well?

```bash
asc install-skills   # writes ~/.agents/skills, which DeepSeek Harness reads
```

DeepSeek Harness scans `<project>/.dsh/skills`, `<project>/.agents/skills`, `customSkillDirs`, `~/.dsh/skills`, `~/.agents/skills` and `$DSH_BUNDLED_SKILL_DIR`. **`~/.claude/skills` is not scanned.**

---

## Upgrading from 0.1.3

0.1.4 consolidated the tool surface. Old tools are gone; use this mapping:

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

`asc_job` and `asc_setup` keep their names; jobs gained `compliance-sweep`.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/asc` says the binary is missing | `brew install asc`, or set `ascPath`, or enable `allowProvision` and run `asc_setup` `provision` |
| Auth error / exit 3 | `asc auth status --validate` in a terminal; check the key's role in App Store Connect |
| Keychain prompt hangs | authenticate in a terminal first, or set `bypassKeychain: true` |
| Write operation refused | still read-only: switch the `asc-tools` row to `mode: write`, then retry with `confirm: true` |
| Version drift warning | `/asc-doctor` shows installed vs tested vs latest; upgrade with `brew upgrade asc` |
| Large result | `dataOmitted`: the payload was dropped from the result — narrow the query. `spillPath` appears only when raw output was truncated and saved. |
| Unknown command asks for approval | expected; set `unknownCommands: deny` to refuse instead |
| pnpm peer warnings on install | expected: the harness provides `@deepseek-ai/*` peers at runtime |

---

## Development

```bash
npm install
npm run build        # clean + tsc -> lib/
npm run typecheck
npm test             # vitest
npm run verify       # all gates: typecheck, test, build, pack-manifest, contract, classify-audit, smoke

node scripts/contract.mjs ./vendor/asc   # contract test against a real asc binary
node scripts/smoke.mjs                   # compiled runtime smoke test

# install a local build into a profile
npm pack && dsh plugin --profile desktop add ./sleep9ull-dsh-asc-cli-*.tgz

# separate dev instance with this checkout mounted
dsh web --patch ./dev/cordis.patch.yml --no-open --port 3199
```

`vendor/asc` is git-ignored; put a real binary there for the contract and smoke tests. CI runs the contract test against the latest upstream release nightly.

## License

MIT
