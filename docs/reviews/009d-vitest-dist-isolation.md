# Review 009d: deterministic compiled-artifact tests

- Slice: `test: serialize compiled-artifact checks`
- Review: independent test-infrastructure review and repeated clean checks
- Date: 2026-08-20
- Frozen base: `724499673a499b73b7179d6a90d6f510f9b0c347`
- Final result: PASS

## Scope and rationale

The compiled-binary test suite includes a deliberate rebuild check: it writes a stale file under
`dist/`, invokes `npm run build`, and proves that the build removes stale output before recreating
the binary. The build begins with the repository clean script, which removes the complete `dist/`
tree. With Vitest's default cross-file parallelism, declaration and package-boundary tests could
read `dist/` while that rebuild test had temporarily removed it. The resulting `ENOENT` failures
depended on scheduling even though the product and every individual test were correct.

The test configuration now sets `fileParallelism: false`. Vitest 4.1.11 defines this option as
serializing test files and resolves it with one worker. The repository has no concurrent test or
suite declarations, and the rebuild itself uses a synchronous child process, so this single
configuration boundary removes the only overlapping owner of `dist/` without changing production
code, assertions, coverage policy, or the compiled-binary lifecycle being tested.

The tradeoff is intentional: the complete check takes roughly ten seconds instead of allowing
test files to compete over a shared build directory. That cost is small for this repository and
makes the required per-commit gate reproducible. If the suite later needs file-level parallelism,
the rebuild test should first move to an isolated copied workspace rather than reintroducing shared
`dist/` mutation.

## Verification

The frozen configuration SHA-256 is
`34c2d3c09ff2d5993ce6d5ff4901596ff17a50555d040d27d8ece5a0e932c1d5`. Local Vitest type
declarations and runtime code independently confirm that `fileParallelism: false` serializes files
and sets the resolved worker count to one.

After dependency state was stable, six valid complete checks passed across two verification runs.
The final three consecutive checks completed in 10.61, 9.23, and 10.73 seconds. Each check ran all
31 test files and all 382 tests, including the stale-build cleanup test, with no skip. Coverage
remained 97.18% statements, 95.52% branches, 99.65% functions, and 97.49% lines. Formatting, type
checking, and `git diff --check` also pass. The slice changes no source file, package manifest,
dependency, generated artifact, or public export.
