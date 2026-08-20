# Review 008f: portable resource-name profiles

- Slice: `feat: profile portable resource names`
- Reviewers: independent subagents `/root/review_derived_core_provenance` and
  `/root/design_resource_graph`
- Author: subagent `/root/design_unicode_generator`, finalized by root agent
- Date: 2026-08-19
- Final result: PASS

## Scope and guarantees

The new internal profiler converts one already-observed directory entry name into a frozen,
nominally branded record containing its exact spelling and byte length plus NFC and pinned Unicode
15.1 full-fold comparison values. Only the exact spelling is eligible for later filesystem calls;
the NFC and fold values are comparison keys. A non-NFC entry remains a successful profile with an
explicit projection so the later collision index can diagnose it without silently changing the
path.

The profiler enforces a 255-byte observed-name limit, rejects separators and dot aliases, gates
every scalar on Unicode 15.1 assignment, and uses the pinned default-ignorable table alongside
fixed control, line-separator, and noncharacter rules. Windows forbidden syntax and trailing space
or dot are checked on the exact spelling. Device names are checked against the pinned fold key with
a case-sensitive regular expression, not host Unicode casing. NFC projection reuses the same
captured, runtime-verified normalizer as the filename-key module and is keyed again before use.

Failures are frozen, input-independent singletons. Successful and failed results are registered in
a private WeakSet whose operations are captured at module initialization. The internal provenance
guard checks identity without reading caller properties, so copied, cloned, inherited, proxied, or
cross-module objects cannot forge a profile.

## Independent review

One reviewer exercised decision priority, byte boundaries, comparison-key expansion, normalization
import order, Windows device spelling, hostile intrinsics, and provenance forgery. Another built an
independent full-domain oracle and ran the compiled candidate on Node.js 22.0.0, 24.0.0, and
26.0.0. All three runtimes produced zero mismatches and the same semantic digest
`a5f1969147594f1d345bb615341773278e4a5efc1440a60f8fe1ad240e06027b` across every integer code
point from U+0000 through U+10FFFF.

The full-domain classification contained 285,743 NFC successes, 1,120 non-NFC successes, 826,700
unassigned values, two separators, one dot alias, 538 unsafe Unicode values, and eight Windows
nonportable characters. The unsafe set independently matched 32 C0 controls, 33 DEL/C1 controls,
two line separators, 66 noncharacters, and 405 assigned default-ignorables. All 1,120 non-NFC
projections and a 279-case Windows reserved-name corpus were identical across the three runtimes.

## Verification

The focused suite passes 25 tests. The complete check passes 320 tests with 97.60% statement and
96.33% branch coverage; the resource-name profiler itself reaches 98.80% statements and 96.05%
branches. Formatting, lint, generated freshness, type checking, and the production dependency
audit pass with zero vulnerabilities.

A real package contains 139 entries and the new internal JavaScript, declarations, and source maps
while excluding source tests and raw Unicode inputs. A clean consumer install and root import pass.
The profile API is intentionally absent from the package root, and the export map blocks deep
imports until the complete validator integration is ready.
