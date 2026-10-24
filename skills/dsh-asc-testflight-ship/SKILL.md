---
name: dsh-asc-testflight-ship
description: "Use when uploading a build to TestFlight or distributing it to internal or external testers, including build numbers, processing states, and beta review."
whenToUse: "The user says upload, ship, distribute, TestFlight or beta review; a build is stuck PROCESSING or FAILED."
---

# Ship a build to TestFlight

TestFlight shipping is a write workflow. The plugin must be in `mode: write`; the job needs `confirm: true` and host approval, including for `dryRun`.

## Pick the build number

```
asc_builds { action: "next-number", app: "123456789", version: "1.2.3", platform: "IOS" }
```

Use `nextBuildNumber`, computed from processed builds and in-flight uploads. `latestProcessedBuildNumber` is not the next number. Build numbers must increase within a version; a duplicate is rejected. Recompute after a failed upload rather than reusing a value.

## Confirm the target

- `file`: an existing `.ipa` (iOS/tvOS/visionOS) or `.pkg` (macOS). Check the path first.
- `app`, `version`, `platform`: the intended release, not "latest".
- `group`: beta group id or exact name; required to distribute (omit only for an upload-only run). List with `asc_testflight action: "groups"` (`internal`/`external`) and prefer ids.
- Internal groups skip beta review. External groups require beta app review; Apple checks encryption, audience, and review state before accepting the build.

## Dry run, then ship

```
asc_job { action: "ship-testflight", app: "123456789", version: "1.2.3",
          platform: "IOS", file: "/abs/path/MyApp.ipa", buildNumber: "42",
          group: "Internal Testers", dryRun: true, confirm: true }
```

The job uploads with `wait`, extracts the `buildId`, and adds that build to the group. `submit: true` also submits for beta review. `dryRun` runs the upload in preview mode and skips add-groups, but the write gate still applies; show the preview, then repeat for the real run.

Do not add groups before the build id is confirmed. Typed fallback: `asc_builds action: "add-groups"` with `buildId`; `--latest` can target another build. Manual order:

```
asc_builds { action: "upload", app, file, version, buildNumber, wait: true, dryRun: true, confirm: true }
asc_builds { action: "upload", app, file, version, buildNumber, wait: true, confirm: true }
asc_builds { action: "add-groups", app, buildId: "<from upload>", group, confirm: true }
```

## Processing states

A build moves `PROCESSING` → `VALID` or `FAILED`/`INVALID`.

- `PROCESSING`: poll `asc_builds action: "list"` with `version` and `buildNumber`; do not add groups yet.
- `VALID`: safe to distribute.
- `FAILED`/`INVALID`: report the state, keep the log, fix the archive, bump the number, upload again. Do not retry add-groups on the failed build.

## Recovery

- Duplicate number: fetch `next-number` again, use the new value, and check no old upload with that number is still processing.
- Upload timeout: the upload may have landed. List builds before retrying; retry only when no matching build exists.
- `state-conflict` on add-groups: re-read build state and group membership; do not re-add blindly.
- Dry-run accepted, real call rejected: dry-run state is advisory; trust the real error.
- `rate-limit`: wait, retry the same step once, and do not replay a successful upload.

## Internal versus external

Name the audience in the reply. Internal distribution is immediate; external distribution enters beta review and can wait there. `submit: true` is an explicit user decision. After submission, report the review state instead of retrying, and do not claim testers were notified unless the result says so.

## Do not

- Add groups before the build id is confirmed, or use `--latest` with several builds.
- Reuse a build number or re-upload the same number to fix a state problem.
- Submit for beta review without explicit approval.
- Mix audiences the user did not ask for.
- Treat `dryRun` or `PROCESSING` as shipped.
