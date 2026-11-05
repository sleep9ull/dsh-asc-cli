# Changelog

All notable changes to this plugin are documented here.

## Unreleased

- Add advisory `versionNotice` results during normal tool use and on `/asc`, with per-session deduplication, a one-second extra wait budget, and source-aware upgrade guidance. Preserve business outcomes and all approval gates. `/asc` is now a lightweight engine/capabilities card; use `/asc-doctor` for authentication diagnostics.
- Distinguish the declared stable support range, verified provisioning pin and unverified upstream releases; compare prereleases correctly. Freeze the executable for each business call and its version probe.
- Replace disk update-check caching with bounded in-memory positive/negative caches; ignore existing `update-check.json` files without deleting them. `checkUpdates: false` disables automatic probes and remote update queries.
- Add developer-only maintenance scripts, a repository skill and deployment instructions for dual-upstream discovery, recovery/locking, final-head merge checks and conservative local-main synchronization. Extend upstream-watch with Harness default-channel monitoring. Desktop task activation, GitHub rules and npm publication remain explicit deployment steps.
- Harden maintenance recovery and synchronization: hold the ownership guard through final writes, require boolean exclusive-access confirmation, retain repair counts, detect orphan targets, and allow a successful third repair. Target keys cover independent Harness package versions; legacy v1 records require manual migration. Discovery reuses the compatibility module's asset mapping.
- Preserve shared version-probe waiters when an explicit version result refreshes the cache; retain deadlines and disposal/provision cancellation for detached probes.
- Verify Harness npm tarball bytes against canonical SHA-512 integrity and official registry signatures; record missing `gitHead` as an unknown source commit rather than blocking otherwise verified artifacts. Add fixed-target/lockfile re-verification, bounded downloads and v3 PR records; unfinished v2 records require explicit migration. Registry signatures do not establish source-build provenance.
- Pin the verified Harness `0.2.1-rc.5` / Cordis `4.0.5` / Schemastery `3.18.5` combination exactly, including host and plugin peers. Select maintenance candidates from the exact host's strict dependency/peer graph; preserve independent latest tags as observations rather than mixing incompatible releases. Recheck the fixed peer graph before installation and retain full integration gates before upgrades. Metadata resolution uses isolated temporary npm locks/cache with scripts disabled.
- Specifications: [005](docs/specs/005-scheduled-upstream-maintenance.md), [006](docs/specs/006-asc-version-notices.md), [007](docs/specs/007-npm-artifact-verification.md), [008](docs/specs/008-harness-drift-triage.md).

## 0.2.0 — 2026-11-03 (upstream compatibility)

### Changed

- Adopt DeepSeek Harness `0.2.1-rc.5`, Node `^22.19.0 || >=24.0.0`, and asc `6.3.0` (support line `>=6.3.0 <7.0.0`). Upgrade the host and engine when migrating from 0.1.6; provisioning remains opt-in and checksum verified. Future 6.x releases are monitored, not individually pretested.
- Use real host types for optional skills and commands. Keep five tools, five jobs, six bundled skills and two commands.

### Security and fixes

- Require actual host approval receipts bound to one execution and its arguments, with a final guard preventing pre-execute listeners from bypassing policy.
- Classify actual command paths rather than flag values; handle explicit boolean flags and local report/log/state writes. Forbid `versions phased-release guard`, which executes arbitrary local programs even with dry-run.
- Reject publishing an IPA with `MAC_OS` before confirmation or approval.
- Share dynamic executable resolution between diagnostics, actions and jobs. Respect failed authentication and propagate diagnostic cancellation.
- Preserve inline output options and file output paths; retry only proven read commands that explicitly reject an injected output flag.
- Keep value expansion blocked when string values resemble flags or `--`; keep unknown-command policy when report files are requested, including confirmation for the file side effect.
- Resolve relative cache paths against the host directory, preserve `.exe` for Windows development engines, and cancel provisioning downloads before installing after caller cancellation.

### Verification and development

- Correct upload dry-run guidance: it reserves operations with Apple and still requires write approval.
- Add real Harness service integration tests and an isolated offline smoke using the real subprocess provider.
- Require engine gates for full verification; provide explicit `--unit-only`. Check generated flags against upstream help and include negative parameter combinations.
- Verify downloaded checksums in pinned CI and latest-release monitoring. Generate development overlays using paths from the current checkout.
- Migration contract and acceptance evidence: [spec 004](docs/specs/004-upstream-compatibility.md).

## 0.1.6 — 2026-10-25 (write-path contract)

### Security

- The classifier now strips leading global flags (`--profile`, `--debug`,
  `--read-only`, `--output`, `--`, ...) before taking the command root, so a
  forbidden command can no longer be downgraded to `unknown`
  (`--debug auth token` is now `forbidden`, as is `--profile p auth login`).
- File-writing `download`/`export` leaves are `local-write` instead of `read`
  (nine commands, including `screenshots download`, `profiles download` and
  `certificates export`). Both modes now require `confirm: true` and, by
  default, approval; `analytics download` no longer receives `--output json`.
- `ASC_WEB_SESSION` is tombstoned in the child environment.
- Parameter guards run before confirm/approval and reject invalid combinations
  with `ASC_INVALID_ARGUMENTS` instead of prompting and then failing upstream.

### Fixed

- `asc_job ship-testflight` with `dryRun: true` no longer sends `--wait`
  (`--wait` and `--dry-run` are mutually exclusive); the upload builder rejects
  the pair with an actionable message.
- `asc_apply stage` / `asc_job stage-release` require exactly one metadata
  source (`metadataDir` or the new `copyMetadataFrom`); the previous default
  always failed with `exactly one of --metadata-dir or --copy-metadata-from is
  required`.
- `groups` (submit + dry-run), `testflight-groups` (internal + external),
  `upload .pkg` (missing version/build-number) and `publish` (no source,
  ipa + pkg, pkg without version/build-number) are validated before approval.
- `publish --ipa` no longer requires `--version` (asc extracts it); `groups`
  with `buildId` no longer requires `--app`.
- `triage-feedback` runs the reviews step independently of the crashes step and
  reports `skipped` / `attempted-failed` instead of a misleading `n/a`.
- Read-only jobs no longer mark their result as `dryRun: true`.
- `dataBytes` / `maxDataBytes` use UTF-8 bytes; `dataOmitted` no longer points at
  a spill file that does not exist; the retry label shows the executed argv.
- Audit: 8 KB cap by bytes, `0o600` re-applied on every append, inline
  `--token=...` forms redacted, `appId` recorded when known.

### Build & release

- `build` cleans `lib/` first; `scripts/pack-manifest.mjs` asserts `lib/` maps
  one-to-one to `src/` (0.1.5 shipped 21 stale `lib/tools/*` files).
- Added `npm run verify` (typecheck, test, build, pack-manifest, contract,
  classify-audit, smoke) and wired `pack-manifest` / `classify-audit` /
  `contract-combos` into CI.
- Added `@deepseek-ai/dsh-llm` and `@deepseek-ai/dsh-util-values` peers; removed
  the duplicate `prepack` build (kept `prepare`).

### Documentation

- COMMANDS §2/§3/§6/§8, ARCHITECTURE §3/§5/§6, TESTING, README/README.zh,
  CONTRACT §3.3/§8 and the affected skills now match the implementation.
- Corrected historical test counts: 0.1.4 is 144 tests, 0.1.2 is 85 tests.
- Adds `docs/specs/003-write-path-contract.md`.

## 0.1.5 — 2026-10-24 (contract & docs release)

### Fixed

- `asc` action `builds-next-number` now passes `--exclude-expired` through; the
  flag was silently dropped even though `asc 5.16.0` supports it. The schema
  description for `excludeExpired` now names both `builds-list` and
  `builds-next-number`.

### Documentation

- Reorganized the contract docs after the upstream `App-Store-Connect-CLI`
  pattern: `AGENTS.md` is now a lean entry (docs map, authority, invariants,
  workflow, validation gates) and `docs/` is split into `CONTRACT.md` (scope,
  policy matrix, I1–I10), `COMMANDS.md` (tools/actions/jobs/skills/commands/
  config/results), `ARCHITECTURE.md`, `TESTING.md`, `CONTRIBUTING.md`,
  `ROADMAP.md`, `SPECS.md`, and `docs/README.md` (map + precedence).
- Removed `docs/PRINCIPLES.md` and `docs/SPEC.md`; their content moved into the
  new files. Added root `CONTRIBUTING.md` and `CLAUDE.md` (`@AGENTS.md`).
- README (en/zh) now has a Documentation section pointing at the new files.
- README (en/zh) safety notes now match the implementation: the plugin adds
  `--confirm` only when the model passes `confirm: true` (it never invents
  confirmation), and the refused set is `auth login/logout` plus `asc web`
  — commands the classifier cannot prove read-only go to `unknownCommands`.
- README troubleshooting no longer conflates `dataOmitted` (payload dropped from
  the result) with `spillPath` (truncated raw output saved to disk).
- `dsh-asc-quickstart` no longer suggests `asc run` bypasses confirmation.

### Specs

- `docs/specs/001-contract-alignment.md` (implemented) — `--exclude-expired`
  passthrough and README/skill corrections.
- `docs/specs/002-docs-contract-0.1.5.md` (implemented) — this documentation
  restructure and release.

## 0.1.4 — 2026-10-24 (consolidation release)

The 0.2.0 scope, shipped under 0.1.x to avoid a major version jump. This is a
**breaking** release: the tool surface is consolidated, and three old tools are
replaced by intent-shaped ones.

### Breaking: tool surface

| 0.1.3 | 0.1.4 |
|---|---|
| `asc_search` | `asc` action `discover` |
| `asc_run` | `asc` action `run` |
| `asc_apps` / `asc_builds` / `asc_testflight` / `asc_metadata` / `asc_release` | `asc` (reads), `asc_plan` (plans), `asc_apply` (mutations) |

`asc_job` and `asc_setup` keep their names. The surface is now five tools:
`asc_job`, `asc`, `asc_plan`, `asc_apply`, `asc_setup`. See the README migration
table for the action-level mapping.

### Added

- **`compliance-sweep` job** (read-only): probes age rating, encryption
  declarations, accessibility and current pricing; a failed probe is reported,
  not fatal. Jobs run nested commands through a helper that refuses anything the
  classifier does not prove read-only, so a job can never smuggle a mutation past
  the human gate that only sees the outer call.
- **Audit trail** (`auditLog`): one redacted JSONL line per executed invocation
  (tool, action, argv, mode, confirm, exit code, duration, error class). Values
  after credential-shaped flags are replaced structurally before writing.
- **Approval exemptions** (`approvedActions`): glob labels such as
  `asc_apply.upload` or `asc_apply.*` skip the prompt in write mode only. They
  never relax read-only mode, `confirm`, or the forbidden list.
- **Upstream update check** (`checkUpdates`, default true): `/asc-doctor` shows
  the latest `asc` release (GitHub API, 24h cache, silent on failure) and
  suggests `brew upgrade asc`; the plugin never upgrades by itself.
- **More read-only roots**: `age-rating`, `encryption`, `accessibility`,
  `agreements`, `pricing`, `users`, `devices`, `actors`, `account`, `analytics`,
  `finance`, `performance`, `insights`, `ads`, `game-center`, `xcode-cloud`,
  `product-pages`, `asset-library`, `categories`, `eula`, `app-tags`,
  `background-assets`, `build-bundles`, `routing-coverage` now classify their
  common read subcommands as read (write verbs still win), so they run without
  an approval prompt.
- **Sixth bundled skill**: `dsh-asc-compliance-sweep`. All five existing skills
  were rewritten for the new surface.

### Changed

- `asc_plan` gains `--deep` for `validate`.
- `triage-feedback` now reads reviews through `asc.reviews-list` instead of a
  raw argv.
- Capability card lists five jobs and the new tool surface.
- README (both languages) documents the migration, the audit trail, exemptions
  and the update check.

### Tests

- 140 tests across 11 files (from 132/10): new audit, exemption, update-check
  and compliance-sweep coverage; registry/approval/job tests moved to the new
  surface.
- Smoke covers `asc.discover`, `asc.apps-list`, `asc_plan.validate` (auth-gated
  failure expected), engine diagnosis and the `/asc` card.

## 0.1.3 — 2026-10-24 (capabilities release)

The plugin becomes a self-contained product surface: jobs, a bundled skill pack,
human commands and an engine manager. Installing the plugin is enough to know
how to use it; installing `asc` itself is guided by the plugin.

### Added

- **Engine manager** (`src/control/engine.ts`). Resolves `asc` from `ascPath` →
  `ASC_CLI_PATH` → the plugin cache → `PATH`; probes the version once and
  compares it with the tested range (`>=5.16.0 <6.0.0`); reports one next step.
- **Provisioning** (`asc_setup` action `provision`, opt-in via
  `allowProvision: true`). Downloads the pinned `asc 5.16.0` release asset for
  the current platform, verifies it against the published SHA-256 checksums,
  and caches it under `$DSH_HOME/cache/asc-cli/<version>/<platform>-<arch>/`.
  Never runs implicitly; needs `confirm` and approval.
- **`asc_setup` actions `diagnose` and `provision`**; `/asc-doctor` renders the
  same report for humans.
- **`/asc` command**: capability card with engine state, the four jobs and the
  next step, without creating a model message.
- **Four jobs via `asc_job`**: `release-check` (read), `ship-testflight`
  (write), `stage-release` (write), `triage-feedback` (read). Each returns
  per-step summaries; write jobs require `mode: write`, `confirm` and approval.
  `runJob` re-checks the gate so the runner is safe when called directly.
- **Five bundled skills** (`skills/`), registered through the host skill
  registry at the bundled rank (600): quickstart, auth, release readiness,
  TestFlight shipping, feedback triage. No `git`, no global skill directory and
  no manual `asc install-skills` are required; a user-installed upstream pack
  wins same-named entries because bundled rank is the lowest.
- **Structured projectors** for `validate` (`blocking/errors/warnings` + ordered
  remediation steps), `status` (`health/nextAction/blockers/nextCommands`) and
  `metadata` counters, plus `nextBuildNumber`/`processingState` fields.

### Changed

- Results larger than `maxDataBytes` (default 8 KB) no longer inline `data`;
  they set `dataOmitted` and `dataBytes` and point at the spill file.
- `asc_setup` was rewritten as a dedicated tool (engine actions plus the
  existing registry actions); `asc_setup.diagnose` and `provision` are also part
  of the pre-execution policy (`provision` requires confirm + approval).
- Removed the unused `renderRefusal` helper and updated the smoke test to cover
  the engine report and the `/asc` card against a real binary.

### Tests

- 132 tests across 10 files (from 85/6), adding engine resolution/provisioning,
  job orchestration and policy, command rendering/registration, bundled-skill
  discovery, structured projectors and the payload size guard.
- Smoke test now prints `asc_setup.diagnose` and the `/asc` capability card
  against `vendor/asc`.

## 0.1.2 — 2026-10-24 (security release)

Two P0 issues and four local-write gaps found in an independent audit are fixed.
No tool names or action names changed; the only breaking behavior changes are
intentional security fixes.

### Security

- **Unknown commands can no longer run on a model-authored `confirm` alone.**
  In write mode an unrecognized command (e.g. `users invite`) previously passed
  the policy with only `confirm: true`. It now requires host approval, exactly
  like a recognized mutation. In read-only mode an unrecognized command is
  escalated to approval instead of being silently allowed or refused
  (`unknownCommands: "ask" | "deny"`, default `ask`).
- **`asc` value expansion is disabled by default.** `asc` expands
  `@env:NAME` / `@file:PATH` inside flag values, so a model-supplied argument
  could read any file the process can access (verified before the fix:
  `metadata validate --dir '@file:/etc/hosts'` echoed the file into the result).
  The plugin now escapes a leading `@` (`@@`), matching asc's documented
  literal form; `allowValueExpansion: true` restores expansion for users who
  need it.
- **Local writes require confirmation.** `metadata init`, `metadata plan`,
  `docs init`, `doctor --fix` / `auth doctor --fix` are now classified as local
  writes and require `confirm: true`. `install-skills` additionally requires
  approval because it writes outside the workspace. `metadata plan` writes the
  review artifact it always wrote — it is no longer advertised as read-only.
- **`@file:` / `@env:` escaping applies to every tool**, including
  `asc_run` and typed actions.

### Fixed

- `asc_release stage` now forwards `--platform`; non-iOS releases no longer
  validate their build id against the default `IOS` platform.
- `asc_run` no longer appends `--output json` to commands that reject it: roots
  known to refuse the flag skip it, and any exit-2 usage failure is retried once
  without it (flag parsing fails before work starts, so no mutation can repeat).
- Credentials supplied through the environment now reach `asc`:
  `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY_PATH` and `ASC_PRIVATE_KEY`
  are forwarded explicitly because the harness's subprocess seam scrubs
  credential-shaped names. Explicit `env` config still wins.
- Write mode now removes an ambient `ASC_READ_ONLY` instead of silently
  inheriting it, so write mode cannot become read-only by accident.
- `presentResult` reports the real exit code for failed `asc` calls instead of
  always showing 0 (and no longer assumes `args.args` is an array).

### Documentation

- Corrected the skill discovery paths: DSH scans `<project>/.dsh/skills`,
  `<project>/.agents/skills`, `customSkillDirs`, `~/.dsh/skills`,
  `~/.agents/skills` and `$DSH_BUNDLED_SKILL_DIR`; it does **not** scan
  `~/.claude/skills`.
- Documented value expansion, local-write policy, the credential-env scrub and
  the limits of the contract test (names only).

### Tests

- 85 tests (from 62), including a new `runtime.test.ts` covering the policy
  matrix, output retry and read-only/unknown interactions; approval tests now
  cover the unknown-write approval gap and local-write confirmations.

## 0.1.1 — 2026-10-23

- Renamed the package to `@sleep9ull/dsh-asc-cli`; published 0.1.0 as the first
  release with typed `asc_*` tools, read-only defaults and approvals.

## 0.1.0 — 2026-10-23

- Initial release: `asc_setup`, `asc_search`, `asc_run`, `asc_apps`,
  `asc_builds`, `asc_testflight`, `asc_metadata`, `asc_release`.
