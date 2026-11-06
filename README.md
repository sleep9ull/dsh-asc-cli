# ASC for DeepSeek Harness

## What's new in 0.2.1

- **Keep your existing Harness:** the same plugin supports `0.2.1-rc.5` and `0.2.2-rc.1`, so adding the newer host does not require existing users to upgrade.
- **Updated asc baseline:** the verified recommendation and optional provisioning pin are now `6.5.0`, with tested `6.3.0` support retained. The plugin never upgrades the engine automatically.
- **Version guidance during use:** ordinary calls and `/asc` show source-aware version notices. `/asc` is a lightweight capabilities card; `/asc-doctor` handles full environment and authentication diagnosis.
- **Compatibility that stays tested:** maintenance retains the previous stable compatibility line while adapting default-channel updates, with the same packed plugin tested on both supported hosts under Node 22 and 24.

For every release's detailed changes and migration notes, see [CHANGELOG.md](CHANGELOG.md).

> This README describes **0.2.1**, merged into the source tree but not yet published to npm. The current npm release is **0.2.0**; see [installation options](#1--install-the-plugin) below.

---

**Ship to TestFlight, check release readiness, triage feedback and audit compliance — from a conversation.**

English | [中文](README.zh.md)

[![npm](https://img.shields.io/npm/v/@sleep9ull/dsh-asc-cli?label=npm&color=cb3837)](https://www.npmjs.com/package/@sleep9ull/dsh-asc-cli)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-0.2.1--rc.5%20%7C%200.2.2--rc.1-4b5563)](https://github.com/deepseek-ai/deepseek-harness)

App Store Connect is where iOS releases happen — and where teams lose hours to CLI flags, JSON blobs, half-documented states and approval rituals. This plugin puts it inside [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): install once, ask in plain language, and the agent runs the right workflow, showing a plan and stopping for approval before anything ships.

The [asc CLI](https://github.com/rorkai/App-Store-Connect-CLI) (MIT, Go) remains the engine. This plugin is the product layer around it: five task-shaped **jobs**, a small **read / plan / apply** tool surface, **bundled skills** that teach the agent how to use it, and an **engine manager** that diagnoses, provisions and version-checks `asc`.

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

Open DeepSeek Harness Desktop once to initialize its profile, then fully quit it before installing. Replace `desktop` with your profile name if you use another profile.

**For 0.2.1:** npm publication is pending; [build and install this source checkout](#development) to use the version described here.

**For the current npm release, 0.2.0:** use the command below. Its feature set and upgrade requirements are recorded in [CHANGELOG.md](CHANGELOG.md#020--2026-11-03-upstream-compatibility).

```bash
dsh plugin --profile desktop add @sleep9ull/dsh-asc-cli@0.2.0
```

Restart or reload the profile. The plugin inserts one row (`mode: read-only`) into the profile's `cordis.patch.yml`.

### 2 · Get the engine ready

```bash
brew install asc          # or: curl -fsSL https://asccli.sh/install | bash
asc auth login --name "MyApp" --key-id ABC123 --issuer-id DEF456 --private-key /path/to/AuthKey.p8
```

Then run `/asc-doctor` — or ask the agent to run `asc_setup` with action `diagnose`. Nothing ready yet? The report gives exactly one next step. Do **not** paste a private key into the chat; authentication stays in your terminal.

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

The third request runs the `ship-testflight` job. `dryRun: true` previews the upload and skips processing/group assignment, but upstream may contact App Store Connect to reserve upload operations; the write approval gate still applies.

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
| `/asc` | Lightweight card: engine/version notice, default app, five jobs; authentication is not checked |
| `/asc-doctor` | Full diagnosis: binary/source, declared support range and verified pin, auth, default app, provisioning, upstream update |

Commands run directly in the host and do not create model messages.

### Six bundled skills

Shipped inside the package, available right after install — no `git`, no global skill directory:

`dsh-asc-quickstart` · `dsh-asc-auth` · `dsh-asc-release-readiness` · `dsh-asc-testflight-ship` · `dsh-asc-feedback-triage` · `dsh-asc-compliance-sweep`

They cover first-run choices, authentication and CI, release readiness, TestFlight shipping, feedback triage and compliance — in the terms of this plugin's tools.

### Engine manager

| Step | What happens |
|---|---|
| Locate | `ascPath` → `ASC_CLI_PATH` → plugin cache → `PATH` |
| Diagnose | version, declared range and verified pin, auth, default app, provisioning — one next step |
| Provision | optional: pinned `asc 6.5.0`, SHA-256 verified, cached per platform |
| Update | ordinary calls and `/asc` show source-aware advisories; `/asc-doctor` shows full facts; never upgrades itself |

With `checkUpdates: true` (the existing default), allowed calls can query the public GitHub release endpoint. Successful queries stay in memory for 24 hours; failures back off for 15 minutes. Ordinary calls wait at most one extra second, and checks have a five-second deadline. Notices preserve business success/failure and appear once per session/version combination; jobs show one top-level notice. Set `checkUpdates: false` to disable automatic checks and remote version queries; explicit local version/diagnostic commands still work.

The verified recommendation is the plugin's pin, not an untested latest release. Guidance follows the executable actually selected: configured path, environment, plugin cache or PATH. A Homebrew upgrade may not affect a configured/cached binary. Update checks no longer read or write `update-check.json`; old files remain untouched, and restarting the plugin may query again.

Developer maintenance is documented in [MAINTENANCE](docs/MAINTENANCE.md): a local Desktop task plus repository scripts, GitHub gates and resumable main synchronization. Deployment and persistent write authorization are separate from installing the plugin; this does not publish npm releases automatically. Harness maintenance pins npm tarballs, verifies their SHA-512 bytes and registry signatures, and rechecks the fixed artifacts against the install lockfile. Missing `gitHead` is recorded as unknown source commit; registry signatures do not prove a source build. Updates select a candidate from the exact host's strict dependency/peer graph; independent `latest` tags remain observations. Each development and validation environment keeps exact host/component pins and a verified lock; public host/peer declarations cover the tested support set. Maintenance retains the previous stable compatibility line while progressively adapting default-channel updates (major lines from 1.x, minor lines before 1.0). Without a formal stable release it retains the previous verified baseline and identifies RCs explicitly. The same plugin artifact must pass strict installation and real approval tests on the retained and new hosts; a new release cannot silently drop old users. See [the compatibility policy](docs/MAINTENANCE.md#0-长期兼容原则). Resolution uses a temporary npm lock/cache with scripts disabled and does not install packages.

---

## Documentation

| Document | Covers |
|---|---|
| [Changelog](CHANGELOG.md) | Every version's detailed changes, breaking changes and migration notes |
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
- **Unknown commands are never silent.** Commands that cannot be proven read-only are escalated to a human (`ask`) or refused (`unknownCommands: deny`); write mode additionally requires `confirm`. Adding `--report-file` keeps that policy and also requires confirmation for the file write. Global flags before the command cannot hide a forbidden command.
- **Invalid arguments fail before approval.** Registered actions/jobs validate their flag combinations (exclusive flags, required metadata source, package requirements) before a confirm prompt or a human approval, so a bad call never costs an approval round-trip.
- **Local writes need confirmation and approval.** `metadata init/plan/pull`, `docs init`, `doctor --fix`, `builds dsyms`, `install-skills`, and every file-writing `download`/`export` leaf (`screenshots download`, `profiles download`, `certificates export`, ...).
- **No value expansion by default.** `asc` expands `@env:` / `@file:` in flag values; the plugin escapes a leading `@` unless `allowValueExpansion: true`.
- **Credentials stay outside the model.** The plugin forwards `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY_PATH`, `ASC_PRIVATE_KEY` because the harness scrubs credential-shaped variables, never reads, stores or prints key material, and tombstones `ASC_WEB_SESSION` so a web-session cookie never reaches the child.
- **Always refused:** `auth login/logout`, `asc web`, and `versions phased-release guard`; commands the classifier cannot prove read-only are escalated to a human (`unknownCommands: ask`) or refused (`deny`).
- **No shell.** argv is passed as an array; diagnostics are redacted; telemetry is off by default.
- **Opt-in governance.** `auditLog` records what ran; `approvedActions` can skip the prompt for known actions in write mode only.

---

## Requirements

| Requirement | Version |
|---|---|
| DeepSeek Harness | source `0.2.1`: retained `0.2.1-rc.5` / Cordis `4.0.5` / Schemastery `3.18.5`, and `0.2.2-rc.1` / `4.1.0` / `3.19.0`; exact peer alternatives, no forced host upgrade. The same packed plugin is tested on both hosts; see spec 010 |
| Node.js | `^22.19.0 \|\| >=24.0.0` (24 recommended) |
| `asc` | source `0.2.1`: verified pin `6.5.0`, retained baseline `6.3.0`; support line `>=6.3.0 <7.0.0` (`/asc-doctor` reports drift) |
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
| `cacheDir` | — | Override the provisioned-binary cache; relative paths resolve against the host process directory |
| `bypassKeychain` | `false` | Set `ASC_BYPASS_KEYCHAIN=1` (CI / headless) |
| `telemetryDisabled` | `true` | Set `ASC_TELEMETRY_DISABLED=1` |
| `auditLog` | — | Append one JSONL audit line per executed invocation |
| `approvedActions` | `[]` | Glob labels that skip the approval prompt in write mode |
| `checkUpdates` | `true` | Automatic version notices and public GitHub release queries; false retains explicit local diagnosis |
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

## Upgrading to 0.2.1

Keep either verified Harness host, `0.2.1-rc.5` or `0.2.2-rc.1`; this plugin update does not require a host upgrade. Fully quit Desktop and install the plugin in the same profile using the [installation options](#1--install-the-plugin), then reopen Desktop or reload the profile.

Run `/asc` for the capabilities card and `/asc-doctor` for engine and authentication diagnosis. Review `asc-tools` before enabling writes. The tested asc `6.3.0` baseline remains supported; optional provisioning recommends `6.5.0` and still requires explicit confirmation and host approval.

Older releases' changes and migration mappings are maintained in [CHANGELOG.md](CHANGELOG.md).

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `/asc` says the binary is missing | `brew install asc`, or set `ascPath`, or enable `allowProvision` and run `asc_setup` `provision` |
| Auth error / exit 3 | `asc auth status --validate` in a terminal; check the key's role in App Store Connect |
| Keychain prompt hangs | authenticate in a terminal first, or set `bypassKeychain: true` |
| Write operation refused | still read-only: switch the `asc-tools` row to `mode: write`, then retry with `confirm: true` |
| Version drift warning | `/asc-doctor` shows installed, verified pin, support range and upstream latest; follow guidance for the selected source. An unverified latest is informational. |
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
node scripts/download-asc.mjs  # download the baseline and verify SHA-256
npm run verify       # typecheck, tests, build, pack, combos, contract, classify, smoke
npm run verify -- --unit-only  # explicitly omit engine gates

node scripts/contract.mjs ./vendor/asc   # contract test against a real asc binary
node scripts/smoke.mjs                   # real Harness subprocess; isolated offline engine smoke

# install a local build into a profile
npm pack && dsh plugin --profile desktop add ./sleep9ull-dsh-asc-cli-*.tgz

# separate dev instance with this checkout mounted
node scripts/dev-patch.mjs
dsh web --patch ./vendor/cordis.dev.patch.yml --no-open --port 3199
```

`vendor/asc` is git-ignored. Full verification requires the checksum-verified baseline binary; `--unit-only` explicitly leaves engine gates unverified. Ordinary CI checks both the verified pin and retained minimum engine, and tests the same packed plugin on both supported Harness hosts under Node 22/24; nightly monitoring checks the latest release with contract, classification and offline smoke gates. Development overlays use absolute paths from the current checkout.

## License

MIT
