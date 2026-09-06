---
name: gate
description: Run the full pre-commit verification gate — forced typecheck, lint, all tests, format check, build — and report per-leg exit codes. Use before every commit, and after any change worth keeping.
---

# The verification gate

Run every leg and judge **only exit codes** — never grep output for success
(`… | tail -3 && echo OK` chains the `&&` to `tail` and prints OK on failure;
that happened in this repo). The forced typecheck exists because `tsc -b` can
pass stale off its `.tsbuildinfo`.

From the repo root:

```sh
bunx tsc -b --force > /dev/null 2>&1; echo "typecheck=$?"
bun run lint         > /dev/null 2>&1; echo "lint=$?"
bun run test         > /dev/null 2>&1; echo "test=$?"
bun run format:check > /dev/null 2>&1; echo "format=$?"
bun run build        > /dev/null 2>&1; echo "build=$?"
```

All five must print `=0`. Report the five codes.

On failure, re-run the failing leg without the redirect to see why:

- **format** → `bun run format` (prettier --write), then re-run the gate — a
  fix must not break another leg.
- **lint / typecheck** → fix the code; never disable a rule to get past it
  without saying so explicitly.
- **test / build** → read the failure output in full before touching anything.

Never commit on a red gate, and never chain `git commit` off anything but the
full green chain — commit only after every leg has printed `=0` in this run,
not a previous one.
