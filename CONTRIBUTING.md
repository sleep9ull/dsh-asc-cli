# Contributing

Thanks for helping with `@sleep9ull/dsh-asc-cli`. The full process lives in [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md); this page is the short version.

## Setup

```bash
npm install
npm run build
npm test
```

`asc` is external: install it (`brew install asc`) or place a binary at `vendor/asc` for the contract test.

## Before you open a PR

- Read [`docs/CONTRACT.md`](docs/CONTRACT.md) (what the plugin promises and refuses to do).
- For behavior changes, write a spec first: [`docs/SPECS.md`](docs/SPECS.md) + [`docs/specs/000-template.md`](docs/specs/000-template.md).
- Run the gates:

```bash
npm run typecheck && npm test
node scripts/contract.mjs ./vendor/asc
npm run build
```

- Keep one logical change per branch; use `feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:` commit subjects.
- Update the docs that your change touches (matrix in [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) §4).

## Review

PRs need a clear description (what / why / verification / known limits), green checks, and synced docs. A maintainer merges; ask before using squash, rebase, or force-push.

## Security

Never commit App Store Connect keys, `.p8` files, or `vendor/asc`. Report credential-handling issues privately to the maintainer.
