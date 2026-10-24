# Changelog

All notable changes to this plugin are documented here.

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
