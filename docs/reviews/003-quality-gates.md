# Review 003: repository quality gates

- Slice: `chore: enforce formatting, typecheck, tests, and coverage`
- Reviewer: independent subagent `/root/review_quality_gates`
- Author: root agent
- Date: 2026-08-19
- Final result: PASS

## First review

The first pass demonstrated that a global 90% threshold was insufficient. A new, completely
untested source file could remain at 0% while aggregate coverage stayed above 90%, allowing the
gate to pass.

## Resolution

- Enforced statement, branch, function, and line thresholds per source file.
- Added a build clean step after a deliberate probe revealed that TypeScript can leave removed
  source files behind in `dist/`.
- Added a regression test that creates stale output, rebuilds, and verifies it is absent.
- Kept only the three-line process wrapper outside instrumentation; its help, version, and error
  paths are exercised through real subprocess tests.

## Verification

```text
npm ci --ignore-scripts
npm run check
npm audit
```

Results: formatting, lint, strict typecheck, 14 tests, clean build, and dependency audit passed;
current source coverage is 100% per file. An independent 0%-covered source probe correctly made
the suite exit 1. A removed-source/stale-dist probe was excluded from `npm pack --dry-run` after the
clean build. The reviewer repeated these checks with Node.js 22 and returned PASS.
