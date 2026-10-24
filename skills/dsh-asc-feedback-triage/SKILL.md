---
name: dsh-asc-feedback-triage
description: "Use when asked what testers report, to triage TestFlight feedback and crashes, or to draft App Store review replies for a human to approve."
whenToUse: "A feedback, crash or sentiment question; a TestFlight triage request; a review-reply drafting task."
---

# Feedback triage

## One read

```
asc_job { action: "triage-feedback", app: "123456789", limit: 50 }
```

Read-only. It aggregates TestFlight feedback, crash submissions, and App Store reviews (a failed reviews read is ignored). Start from `summary` (`feedback=N crashes=N reviews=N`) and each failed step. `limit` defaults to 20 and each source is one page, so raise it or read one source:

```
asc { action: "testflight-feedback", app, sort: "-createdDate", limit: 25 }
asc { action: "testflight-crashes", app, sort: "-createdDate", limit: 25 }
asc { action: "reviews-list", app: "123456789", limit: 25, sort: "-createdDate" }
```

## Cluster before reporting

Group by action, not source:

| Cluster | Evidence | Action |
|---|---|---|
| Crash | `testflight-crashes`; `crashes log` stack; device/OS/build | Reproduce on that build; file a bug |
| Functional | Feedback `comment` describing wrong behavior or a blocked flow | Bug vs expected; ask for repro |
| Performance | `appUptimeInMilliseconds`, battery/disk fields; lag or heat comments | Separate from crashes; correlate device/OS |
| UI/content | Comments on layout, copy, localization; screenshots via `asc action:"run"` with `--include-screenshots` | Route to design/content |
| Review sentiment | `rating`, `title`, `body`, territory, response state | Reply drafting, not bug triage |

Report counts, top clusters, affected builds, and one representative detail each. Distinguish "seen once" from "seen across N builds"; never infer a trend from one comment, and do not invent counts.

## Drill into one report

```
asc { action: "run", args: ["testflight","feedback","view","--submission-id","<id>"] }
asc { action: "run", args: ["testflight","crashes","view","--submission-id","<id>"] }
asc { action: "run", args: ["testflight","crashes","log","--submission-id","<id>"] }
```

Match build number and version before attributing a crash to a release. Quote only supporting frames; keep the full log as a handle, not a wall of text.

## Review replies: draft only

Fetch unreplied reviews, then draft in chat; do not submit. `asc reviews respond` via `asc action:"run"` publishes immediately; `asc reviews respond-batch` supports `--dry-run` but needs `--confirm`. Both are public and irreversible; run one only on explicit request, after quoting the review id and text and getting agreement.

Draft: acknowledge the issue, avoid promises, exclude personal data, route bugs to triage instead of debating publicly. For a batch, present a table of review id, rating, draft, and ask for approval; silence is not consent.

## Policy and privacy

`reviews-list` is read-only, and common read subcommands under the expanded roots run through `asc action:"run"` without approval. `auditLog` records argv, exit, duration and error class for these reads, not result content; tester emails, device ids and screenshots stay out of logs and files. Share screenshot URLs only with the requesting user.

`approvedActions` may waive the approval prompt for a reply command in write mode, but `confirm` and the draft-first rule still apply. Never submit a response automatically.

## Rate limits and paging

Start with `limit` 25–50. Use `paginate`/`--next` only when completeness is required; large collections trigger `rate-limit` (`429`). Wait and resume from the last page instead of restarting. Keep one paginated request in flight.

## Do not

- Reply to, delete, or clean up feedback, crashes, or reviews without an explicit request and confirmation.
- Paste full crash logs or tester emails into the reply.
- Attribute a crash to a build without matching build number/version.
- Submit a response automatically or treat a draft as approved.
- Quote one comment as a trend or state counts the result does not show.
