---
name: dsh-asc-quickstart
description: "Use when starting App Store Connect work with this plugin: choosing jobs, asc queries, plan/apply, or reading results and errors."
whenToUse: "First asc request in a session; the user asks what the plugin can do; a call failed or returned an unclear summary."
---

# asc plugin quickstart

This plugin wraps `asc` for App Store Connect; it does not build or sign apps. Authenticate in a terminal first.

## First run

1. Call `asc_setup action:"diagnose"` (or ask the user to run `/asc-doctor`): binary, version, auth, default app, next step.
2. Missing binary: `brew install asc`, or enable `allowProvision` and run `asc_setup action:"provision"` (confirm + approval).
3. Auth: the user runs `asc auth login ...` in their terminal; never you. `auth-status` validates.
4. Resolve the app id with `asc action:"apps-list"`, then set `defaultAppId`.
5. Prefer a job; raw commands last.

`/asc-doctor` (`checkUpdates`, default true) shows the latest release and upgrade hint; never auto-upgrades. Tested `>=5.16.0 <6.0.0`.

## Choose the surface

| Need | Use |
|---|---|
| Known workflow | `asc_job`: `release-check`, `ship-testflight`, `stage-release`, `triage-feedback`, `compliance-sweep` |
| Read a fact | `asc`: apps-list/apps-view, builds-list/builds-next-number, testflight-feedback/testflight-crashes/testflight-groups, reviews-list, metadata-validate |
| Plan / preflight | `asc_plan`: `validate`, `status`, `metadata-plan` |
| Mutate | `asc_apply`: `upload`, `groups`, `metadata-init`, `metadata-apply`, `stage`, `publish` |
| New command | `asc action:"discover"` → `asc action:"run"` |

`release-check`, `triage-feedback` and `compliance-sweep` are read-only; `ship-testflight` and `stage-release` write. Reads need no confirm. All `asc_apply` actions and every local write need confirm + approval: `asc_plan.metadata-plan`, `asc_apply.metadata-init`, `asc_setup.install-skills`, and the file-writing `download`/`export` leaves (for example `screenshots download`, `profiles download`).

## Read a result

Most tools return `{ok, exitCode, command, durationMs, summary, data?, errorClass?, hint?, truncated?, spillPath?, dataOmitted?}`. Read `ok`→`summary`→`hint`; `data` can be dropped (`dataOmitted`) or cut (`truncated`). Cite only fields you see.

`asc_job` returns `{ok, job, title, summary, dryRun, steps[], data?, errorClass?, hint?}`. Read `summary` then each failed step; ignored steps (`compliance-sweep`, reviews) can fail while the job is `ok`.

`errorClass`: `auth`→auth skill; `state-conflict`→`status`; `rate-limit`→wait; `usage`→`discover`; `missing-binary`→install; `network`/`timeout`→retry once; `cancelled`/`parse`/`unknown`→read `hint`/stderr.

## Modes and policy

Read-only is the default; writes need `mode: write`, `confirm` and approval, dry runs included. `approvedActions` globs (e.g. `asc_apply.upload`) waive only the prompt in write mode; confirm stays, read-only is never bypassed.

`auditLog` writes one JSONL line per tool-initiated asc invocation (tool, action, argv, exit, duration, errorClass, appId when known); engine probes and approval outcomes are not in this file.

Read-only classification covers recognized read subcommands under age-rating, encryption, accessibility, pricing, users, devices, actors, account, analytics, finance, performance, insights, ads, game-center, xcode-cloud, product-pages, asset-library, categories, eula and app-tags; write verbs still win, and file-writing `download`/`export` leaves are local-write. Leading global flags are stripped before the root is judged, so `--debug auth login` is still forbidden. Unprovable `run` commands go to human approval, or are refused with `unknownCommands: "deny"`. A leading `@` is escaped; `@env:`/`@file:` expansion is off. `asc --read-only` blocks App Store Connect writes, not local files.

## Stop and ask

- App/version ambiguous, or several plausible builds.
- Auth missing or multiple profiles/teams.
- A write without agreement, approval denied, or an unseen preview.
- Blockers are web/manual, or output is omitted and the decision needs it.

## Do not

- Run `asc auth login`/`logout` or `web` commands; never handle `.p8` material.
- Use `asc action:"run"` to bypass a job or a refusal — `run` is still classified, so write and unknown calls keep needing `confirm` and approval.
- Retry a mutation after a timeout before checking state.
- Paste raw `data`; summarize and link `spillPath`.
- Invent commands or flags; `discover` first.
