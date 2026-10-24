# Changelog

All notable changes to this plugin are documented here.

## Unreleased

### Fixed

- `asc` action `builds-next-number` now passes `--exclude-expired` through; the
  flag was silently dropped even though `asc 5.16.0` supports it. The schema
  description for `excludeExpired` now names both `builds-list` and
  `builds-next-number`.

### Documentation

- README (en/zh) safety notes now match the implementation: the plugin adds
  `--confirm` only when the model passes `confirm: true` (it never invents
  confirmation), and the refused set is `auth login/logout` plus `asc web`
  — commands the classifier cannot prove read-only go to `unknownCommands`.
- `dsh-asc-quickstart` no longer suggests `asc run` bypasses confirmation.
- README troubleshooting no longer conflates `dataOmitted` (payload dropped from
  the result) with `spillPath` (truncated raw output saved to disk).
- Added the spec-first workflow (`docs/SPEC.md`, `docs/specs/000-template.md`)
  and spec `001` for this alignment.

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

- 84 tests (from 62), including a new `runtime.test.ts` covering the policy
  matrix, output retry and read-only/unknown interactions; approval tests now
  cover the unknown-write approval gap and local-write confirmations.

## 0.1.1 — 2026-10-23

- Renamed the package to `@sleep9ull/dsh-asc-cli`; published 0.1.0 as the first
  release with typed `asc_*` tools, read-only defaults and approvals.

## 0.1.0 — 2026-10-23

- Initial release: `asc_setup`, `asc_search`, `asc_run`, `asc_apps`,
  `asc_builds`, `asc_testflight`, `asc_metadata`, `asc_release`.
