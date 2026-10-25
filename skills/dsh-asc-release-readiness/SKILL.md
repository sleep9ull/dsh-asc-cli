---
name: dsh-asc-release-readiness
description: "Use when asked whether a version is ready to submit, why App Store submission is blocked, or before staging or publishing a release."
whenToUse: "A release question, a validate failure, or any step before stage-release or publish."
---

# Release readiness

## One job first

```
asc_job { action: "release-check", app: "123456789", version: "1.2.3", platform: "IOS" }
```

Read-only. Runs `asc validate` for blockers and ordered fixes. `app` falls back to `defaultAppId`; omit `version` for the latest editable version, but state which was checked. The job `summary` shows `blocking=N errors=N warnings=N` and first fixes; full report is `data.validate` unless dropped for size.

Use `asc_plan action:"validate"` for `strict`, `deep`, or flags the job lacks.

## Read the report

If `data.validate` is null it exceeded the data cap: use `summary` and re-check. Otherwise, in `data.validate`:

- `summary.blocking`: issues that stop submission. Non-zero means not ready.
- `summary.errors`/`warnings`/`infos`: counts. `strict` turns warnings into blockers; respect the team's gate.
- `remediation.steps[]`: ordered; step 1 is next. Each has `severity`, `blocking`, `field`, `message`, `remediation`, and `resolution.fixability` (`api-fixable`/`web-fixable`/`manual`) with `commands` and a URL.

Report blocker, why, fix. Read `checks[]` only for evidence.

If validate fails: `auth` → auth skill; `state-conflict` → `asc_plan action:"status"`; `usage` → fix version/platform, retry.

## Fix in dependency order

1. **Metadata**: lengths, required fields, placeholder copy, URLs. Edit canonical files; `asc action:"metadata-validate"` (offline), `asc_plan action:"metadata-plan"`, `asc_apply action:"metadata-apply"`. Refresh with `asc action:"run"` `["metadata","pull",...]` (`confirm` needed); never assume the directory matches remote.
2. **Build**: processed `VALID` build attached, encryption declaration, content rights. Read with `asc action:"builds-list"`; see `dsh-asc-testflight-ship`.
3. **Compliance/commerce**: run `asc_job action:"compliance-sweep"` for age rating, encryption, accessibility and pricing; agreements, tax and Resolution Center are web/manual (no public API). See `dsh-asc-compliance-sweep`.
4. **Submission state**: check for an in-flight submission (`asc_plan action:"status"`) before staging again. That is `state-conflict`, not a new validation problem.

Re-run `release-check` after each material fix. An earlier pass does not certify the version.

## Plan before apply

`asc_plan.metadata-plan` is a local write (review artifact) needing `confirm` + approval. Read `adds`/`updates`/`deletes` and show the diff. The typed action does not expose `--allow-deletes`; if the plan must include deletes, use `asc action:"run"` with `["metadata","plan",...,"--allow-deletes"]` (still a local write: confirm + approval). `asc_apply action:"metadata-apply"` needs `confirm` even with `dryRun`; preview, then re-run for real after agreement. It mutates the live listing with no undo.

## Stage versus submit

- `asc_apply action:"stage"` needs `app`, `version`, `buildId`, and **exactly one** metadata source: `metadataDir` or `copyMetadataFrom` (both or neither is rejected before approval). It prepares the version, attaches the build, and stops before submission. The `stage-release` job validates first, stops on blocking items, and needs `version` + `buildId` + the same one-of metadata source. Both take `confirm` even for `dryRun`.
- Submitting is `asc_apply action:"publish"` with `submit: true` (underlying `asc publish appstore --submit --confirm`). It creates the App Review submission; needs write mode, `confirm` and approval. `approvedActions` can waive the prompt, never `confirm`.
- `asc submit status`/`cancel` manage a submission; `asc submit` alone is not shipping; use `asc action:"run"` for them.

Stage prepares; submit is irreversible. Quote version, build, audience; get agreement.

## Do not

- Publish or submit to skip validate, or because the user is in a hurry.
- Call a version ready with `blocking > 0`, or on a stale validate run.
- Apply an unreviewed plan or enable `--allow-deletes` casually.
- Treat compliance-sweep success as proof; inspect steps and manual web items.
- Dismiss warnings without confirming the team's gate.
