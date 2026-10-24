---
name: dsh-asc-quickstart
description: "Use when starting App Store Connect work with this plugin, choosing between jobs, typed tools and asc_run, or interpreting a result or error."
whenToUse: "First asc request in a session; the user asks what the plugin can do; a call failed or returned an unclear summary."
---

# asc plugin quickstart

This plugin wraps `asc` for App Store Connect; it does not build or sign apps. Authenticate in a terminal first.

## First run

1. Call `asc_setup action: "diagnose"` (the user can run `/asc-doctor`): binary, version, auth, default app.
2. Missing binary: `brew install asc`, or enable `allowProvision` and run `asc_setup action: "provision"` (needs confirm and approval).
3. Auth: the user runs `asc auth login ...` in their terminal; never run it yourself. `asc_setup action: "auth-status"` validates credentials.
4. Resolve the app id with `asc_apps action: "list"` (backed by `asc apps list`), then set `defaultAppId` in the profile config.
5. Prefer a job; raw commands last.

Tested range is `>=5.16.0 <6.0.0`; the doctor flags versions outside it. Report it, do not upgrade silently.

## Choose the surface

| Need | Use |
|---|---|
| Known workflow | `asc_job` (ordered steps and guards) |
| One read or typed write | `asc_apps`, `asc_builds`, `asc_testflight`, `asc_metadata`, `asc_release`, `asc_setup` |
| Uncovered command | `asc_search` first, then `asc_run` with an argv array |

Jobs: `release-check` and `triage-feedback` are read-only; `ship-testflight` and `stage-release` write. Parameters: `app`, `version`, `platform` (`IOS`/`MAC_OS`/`TV_OS`/`VISION_OS`), `buildId`, `file`, `buildNumber`, `group`, `metadataDir`, `limit`, `dryRun`, `submit`, `confirm`. `ship-testflight` needs `file`; `stage-release` needs `version` and `buildId`. Do not reassemble a job.

## Read a result

Most tools return:

```jsonc
{ "ok": true, "exitCode": 0, "command": "asc ...", "durationMs": 812,
  "summary": "...", "data": {}, "hint": "...", "truncated": false,
  "spillPath": "...", "dataOmitted": false }
```

Read `ok`, then `summary`, then `hint`. `data` is optional: `dataOmitted` means it was dropped, `truncated` means cut, `spillPath` holds the full output. Cite only fields you can see.

`asc_job` returns a plan instead:

```jsonc
{ "ok": true, "job": "release-check", "title": "...", "summary": "...",
  "dryRun": false, "steps": [{ "name": "validate", "ok": true, "summary": "..." }], "data": {} }
```

Read `summary`, then each failed `step`; `data` is job-specific.

`errorClass` drives recovery: `auth`→auth skill, `state-conflict`→`status`, `rate-limit`→wait, `usage`→`asc_search`, `missing-binary`→install/`ascPath`, `network`/`timeout`→`system-status`+retry, `cancelled`→stopped, `parse`/`unknown`→read `hint`/stderr.

## Modes and confirmation

Read-only is the default: writes are refused before `asc` starts. Tell the user to set `mode: write`; do not work around it. Write jobs need `confirm: true` and host approval, even for `dryRun`; a dry run shows `steps` without mutating, so show it before the real call. Local writes (`metadata init`/`plan`, `docs init`, `doctor --fix`, `provision`, `install-skills`) also need confirm and approval. Unprovable commands go to human approval (`unknownCommands: "deny"` refuses). A leading `@` is escaped; `@env:`/`@file:` expansion is off by default. `asc --read-only` blocks App Store Connect mutations, not local file writes.

## Stop and ask

- App/version ambiguous, or several plausible builds.
- Auth missing or multiple profiles/teams.
- A write without agreement, approval denied, or an unseen preview.
- Blockers are web-fixable or manual.
- Output omitted/truncated and the decision needs it.

## Do not

- Run `asc auth login`/`logout` or `web` commands; never handle `.p8` material.
- Use `asc_run` to bypass a job, refusal, or confirmation.
- Retry a mutation after a timeout before checking state.
- Paste raw `data`; summarize and link `spillPath`.
- Invent commands or flags; search first.
