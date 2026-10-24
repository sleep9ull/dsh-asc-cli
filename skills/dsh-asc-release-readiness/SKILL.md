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

Read-only. Runs `asc validate` and returns blockers plus ordered fixes. `app` falls back to `defaultAppId`; omit `version` for the latest editable version, but state which was checked. The job `summary` renders `blocking=N errors=N warnings=N` and the first fixes; the full report is `data.validate` when it was not dropped for size.

Use `asc_release action: "validate"` for `strict` or flags the job lacks.

## Read the report

If `data.validate` is null the report exceeded the data cap: work from `summary` and re-check. Otherwise, in `data.validate`:

- `summary.blocking`: issues that stop submission. Non-zero means not ready.
- `summary.errors`/`warnings`/`infos`: counts. `--strict` turns warnings into blockers; respect the team's gate.
- `remediation.steps[]`: ordered; step 1 is next. Each has `severity`, `blocking`, `field`, `message`, `remediation`, and `resolution.fixability` (`api-fixable`/`web-fixable`/`manual`) with `commands` and a URL.

Report blocker, why, fix. Read `checks[]` only for evidence.

If validate fails: `auth` → auth skill; `state-conflict` → `status`; `usage` → fix version/platform, retry once.

## Fix in dependency order

1. **Metadata**: lengths, required fields, placeholder copy, URLs. Edit canonical files; `asc_metadata action: "validate"` (offline), then `plan`, then `apply`. Refresh with `asc_run` `["metadata","pull",...]`; never hand-edit remote metadata and assume the directory matches.
2. **Build**: processed `VALID` build attached, encryption declaration, content rights. See `dsh-asc-testflight-ship`.
3. **Compliance/commerce**: category, age rating, review details, pricing and availability, agreements, privacy. API-fixable items can be automated; web/manual items need the user.
4. **Submission state**: check for an in-flight submission (`asc_release action: "status"`) before staging again. That is `state-conflict`, not a new validation problem.

Re-run `release-check` after each material fix. An earlier pass does not certify the version.

## Plan before apply

`metadata plan` is a local write (review artifact) and needs `confirm` plus approval. Read `adds`/`updates`/`deletes` and show the diff; `deletes` appear only with `--allow-deletes`. `asc_metadata apply` needs `confirm: true` even with `dryRun`; preview, then re-run for real after agreement. It mutates the live listing and cannot be undone.

## Stage versus submit

- `stage-release` validates first and stops on blocking items, then runs `asc release stage`: ensure the version, apply `metadataDir` if given, attach `buildId`, and stop before creating a review submission. It needs `version` and `buildId`, is resumable, and takes `confirm` even for `dryRun`; typed `asc_release action: "stage"` needs `buildId` too.
- Submitting is `asc_release action: "publish"` with `submit: true` (underlying `asc publish appstore --submit --confirm`). It creates the App Review submission; needs write mode, `confirm`, and approval.
- `asc submit status`/`cancel` manage an existing submission; `asc submit` alone is not a shipping command. Read them via `asc_run` when `status` is not enough.

Stage prepares; submit is irreversible. Quote version, build, and audience, then get explicit agreement.

## Do not

- Publish or submit to skip validate, or because the user is in a hurry.
- Call a version ready with `blocking > 0`, or on a stale validate run.
- Apply an unreviewed plan or enable `--allow-deletes` casually.
- Dismiss warnings without confirming the team's gate.
- Claim a web/manual blocker is fixed without user confirmation.
