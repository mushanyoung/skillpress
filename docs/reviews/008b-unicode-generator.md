# Review 008b: generated Unicode 15.1 portability tables

- Slice: `build: generate pinned Unicode portability tables`
- Reviewers: independent subagents `/root/design_unicode_generator` and
  `/root/review_unicode_runtime`
- Author: subagent `/root/implement_unicode_generator`, finalized by root agent
- Date: 2026-08-19
- Final result: PASS

## Findings and resolution

The initial generator was a 599-line file. Before review it was mechanically separated into a
41-line entry point and four single-purpose parser, compression, and renderer modules, each no more
than 206 lines. The generated table remains a deliberately mechanical file and is protected by an
exact regeneration check.

Both reviewers independently verified the pinned source lengths, SHA-256 digests, version headers,
strict grammar, record order, status combinations, range overlap rules, and EOF contracts. Synthetic
invalid records, surrogates, duplicates, reordered records, overlap, missing declarations, stale or
missing generated output, and invalid generator arguments all failed closed without modifying the
candidate output. The selected full fold contains 1,530 mappings; the generated representation has
91 stride ranges and 204 exceptions, and the assigned-scalar representation has 715 ranges.

The runtime reviewer exercised Node.js 22.23.2, 24.19.0, and 26.7.0. An independent UCD parser
checked every code point from U+000000 through U+10FFFF, including isolated surrogate behavior,
against fixed semantic digests. The generated module does not depend on host casing, locale,
normalization, or `Intl` data. Its declaration file exposes only the pinned version and two internal
helpers; the package root and npm export map do not expose the tables.

## Verification

Clean snapshots passed 288 tests with 97.55% statement and 96.29% branch coverage. The generated
runtime file reached 100% statement, branch, function, and line coverage. Production dependency
audit reported zero vulnerabilities. A real package contained the generated JavaScript,
declarations, source maps, Unicode license, and third-party notice while excluding the raw UCD,
generator scripts, source, and tests. The generated TypeScript SHA-256 was
`38bf495f59b5e3eb7da395b686de484cb5c78db40a209f75a58dde80c7201ae5` in every regeneration.
