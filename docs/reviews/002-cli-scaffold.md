# Review 002: typed CLI scaffold

- Slice: `chore: scaffold the typed CLI package`
- Reviewer: independent subagent `/root/review_scaffold`
- Author: root agent
- Date: 2026-08-19
- Final result: PASS

## First review

The first pass found two release blockers:

1. An installed npm symlink could make the CLI's main-module URL comparison fail, causing the real
   binary to exit successfully without output.
2. `npm pack` from a clean checkout did not build `dist/`, so the package could omit its declared
   binary entirely.

The unit tests had only called `runCli` in memory and therefore did not expose either packaging
failure.

## Resolution

- Added a dedicated `src/bin.ts` wrapper that always calls `runCli` when the binary executes.
- Pointed the npm `bin` field at the compiled wrapper.
- Added a `prepack` build so a clean checkout produces complete package contents.
- Made tests build first and added real-process tests for help, version, stderr, and exit code 2.

## Verification

```text
npm ci --ignore-scripts
npm run check
npm audit
npm pack --dry-run --json
# Install the produced tarball into a clean temporary prefix.
node_modules/.bin/skillpress --version
node_modules/.bin/skillpress --help
node_modules/.bin/skillpress create
```

Results: 10 tests passed; typecheck and build passed; npm audit reported no vulnerabilities; a
clean pack contained only the declared package files; the installed binary returned the expected
output and exit codes. The reviewer reran the clean install path and returned PASS.
