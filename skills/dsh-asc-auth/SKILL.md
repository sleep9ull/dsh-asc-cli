---
name: dsh-asc-auth
description: "Use when asc reports auth failures, exit code 3, 401 or 403, or when setting up profiles, keychain access, headless/CI credentials, or multiple teams."
whenToUse: "errorClass auth; /asc-doctor flags credentials; the user changes profile or team; a keychain prompt blocks a command."
---

# asc authentication

`asc` resolves an App Store Connect API key from the system keychain, `~/.asc/config.json`, or environment variables. The plugin never reads or prints key material and refuses `asc auth login`/`logout`: the user authenticates in a terminal.

## Terminal login

```bash
asc auth login --name "MyApp" \
  --key-id "ABC123" --issuer-id "DEF456" \
  --private-key /path/to/AuthKey_ABC123.p8
asc auth status --validate
```

- Omit `--name` only on first login (becomes `default`). With profiles stored, `--name` is required.
- Individual keys: add `--key-type individual`.
- The `.p8` must not be readable by others. Ask the user to `chmod 600`, or use `--fix-permissions` if they request it.
- `--network` validates during login; `--skip-validation` defers it. Neither replaces `auth status --validate`.
- Headless: add `--bypass-keychain`; credentials go to `ASC_CONFIG_PATH` or `~/.asc/config.json`.

Checks (the user can also run `/asc-doctor`):

```
asc_setup { action: "auth-status" }   # auth status --validate
asc_setup { action: "doctor" }        # keychain, config, key files
```

`auth-status` is the network truth; `doctor` diagnoses local storage. With `checkUpdates` (default true), `/asc-doctor` also reports the latest upstream release and an upgrade hint; the plugin never upgrades itself.

## Failure branches

| Signal | Meaning | Action |
|---|---|---|
| `exitCode: 3`, `missing authentication` | No usable credentials for this profile | User logs in; re-validate |
| 401 / `Unauthorized` | Key rejected or revoked | Regenerate the key, log in again |
| 403 / `Forbidden` | Key valid, role lacks permission | User changes the role in Users and Access |
| Keychain prompt or hang | macOS waits for unlock | User unlocks/approves; do not spawn retries |
| Works locally, fails in CI | No keychain or key file | `bypassKeychain: true` + env credentials |
| `system-status` incident | Apple-side outage | Wait; auth changes will not help |

The plugin maps auth-looking stderr to `errorClass: auth` with a hint. Treat the hint as a lead, not proof.

## Profiles and teams

One profile per team. Set `profile: "MyApp"` in the plugin config to pass `asc --profile MyApp`; `ASC_PROFILE` covers direct `asc` runs. `auth-status` shows the active profile and stored credentials with `storageBackend`. Switching profiles is a config edit plus reload; do not mix keys from different teams.

## Headless and CI

The plugin forwards `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY_PATH`, and `ASC_PRIVATE_KEY` because the harness scrubs credential-shaped variables. Prefer a path over inline key material, a dedicated least-privilege key, and `bypassKeychain` on runners without a keychain. Never put keys in plugin config, `cordis.patch.yml`, or the workspace `.asc/` directory (`--local` writes repository-local credentials).

## Audit and approvals

With `auditLog`, each asc call writes JSONL (tool/action/argv/exit/duration/errorClass/app), never keys. `approvedActions` globs waive only the approval prompt, only in write mode; `confirm` remains; neither bypasses auth or read-only.

## Private-key hygiene

Use paths only, never contents. Do not ask the user to paste a `.p8` or a base64 key. Do not write key material into the repo, logs, spill files, or examples. If a key appears in output, stop, tell the user to rotate it, and do not repeat it.

## Do not

- Run `asc auth login`/`logout`, or any `web auth` command through `asc action:"run"`.
- Set `mode: write` or disable approval to fix auth.
- Treat 403 as a missing login; it is a permission problem.
- Retry keychain-hanging commands in a loop or in parallel.
- Store private keys in the repo, profile config, or chat.
