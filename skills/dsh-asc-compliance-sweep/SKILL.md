---
name: dsh-asc-compliance-sweep
description: "Use when auditing App Store compliance (age rating, encryption, accessibility, pricing) or turning a readiness failure into a fix plan."
whenToUse: "Pre-release or periodic compliance review; release-check blocks on age rating, encryption, accessibility or pricing; the user asks about agreements or tax."
---

# Compliance sweep

`asc_job action:"compliance-sweep"` is a read-only, best-effort audit of four compliance areas. It never changes App Store Connect.

## When to run

- Before submission or a periodic compliance review.
- `release-check` or `asc_plan action:"validate"` reports age-rating, encryption, accessibility or pricing findings.
- The user asks "are we compliant?"; the sweep covers four API-visible areas only.
- After changing pricing, age rating or encryption declarations.

## One call

```
asc_job { action: "compliance-sweep", app: "123456789" }
```

Read-only; no confirm. It probes in order:

1. `asc age-rating view --app <id>`
2. `asc encryption declarations list --app <id>`
3. `asc accessibility list --app <id>`
4. `asc pricing current --app <id>`

A failed probe does not fail the job: the summary reports each area's status/count, and a failed step carries its own `errorClass`/`hint`.

## Read the result

The job returns `{ok, job, title, summary, dryRun, steps[], data?, errorClass?, hint?}`. A successful `ok` does **not** mean all four probes passed: inspect each step's `ok`/`summary`, and the failed ones' `errorClass`/`hint`. `data` may be dropped for size; per-step summaries and counts are the contract.

Interpretation:

- **Age rating**: declaration exists and has values; missing/empty answers suggest an incomplete questionnaire. Confirm in App Store Connect or `asc age-rating edit`; verify with the view.
- **Encryption**: declarations and their state; no usable declaration for the build/version can block submission. Create/assign via the encryption commands after `discover`; the web UI also works.
- **Accessibility**: declarations by device family and state (`DRAFT`/`PUBLISHED`/`REPLACED`). Report what is declared; do not assume `DRAFT` is acceptable.
- **Pricing**: current price and territory. A missing price/base territory blocks release; availability is separate, so do not claim sellable from this step.

Do not quote field names from memory; read the result.

## Manual and web items

No public API, so the sweep cannot verify and must not claim these clean:

- Agreements, tax and banking (Agreements, Tax, and Banking).
- Resolution Center messages and review responses.
- App Privacy publication (web-only unless a cached web session already exists; the plugin never starts a login).

List them as "not checked" and ask the user to confirm in App Store Connect.

## Turn findings into a fix plan

Order by release impact:

1. **Blocking**: encryption declaration missing, pricing missing, age rating incomplete.
2. **Required declarations**: accessibility states.
3. **Manual/web**: agreements, tax, Resolution Center, privacy.

For each finding record: area, evidence from the step, fix path (API vs web), owner, and verification command. Then re-run `compliance-sweep` and `asc_job action:"release-check"`. A sweep pass is not a submission pass.

For API-fixable items, use `asc action:"discover"` to find exact commands and flags, then a write action with `mode: write`, `confirm` and approval. `approvedActions` may waive the prompt, never `confirm`. Never change pricing, age rating, encryption or accessibility declarations without explicit user agreement.

## Do not

- Treat job `ok` as "compliant"; inspect all four steps.
- Claim agreements, tax, Resolution Center or App Privacy are clean — they are not probed.
- Change age rating, pricing, encryption or accessibility without agreement.
- Guess flags; `discover` first.
- Report a count as a pass; counts only show presence or volume.
- Paste tester/customer PII or full raw data.
