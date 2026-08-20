# Review 009a: portable directory-name index

- Slice: `feat: index portable directory names`
- Reviewers: independent subagents `/root/review_derived_core_provenance` and
  `/root/design_resource_graph/review_directory_index_impl`
- Author: subagent `/root/design_resource_graph`, finalized by root agent
- Date: 2026-08-19
- Final result: PASS

## Scope and guarantees

The new internal index accepts at most 1,024 genuine resource-name profiles, snapshots only dense
own data slots, and copies primitive profile fields before building deterministic exact, NFC, and
pinned Unicode 15.1 full-fold tables. Exact spellings remain the only values eligible for later
filesystem access. NFC and fold values are comparison keys and never replace an observed name.

All ordering uses binary UTF-16 code-unit order. Findings have a fixed priority: non-NFC spellings,
NFC collisions, then fixed-fold collisions spanning multiple NFC groups. Findings are group-based,
not pair-based, and are capped at 2,048. Exact duplicates fail closed. Genuine profile failures are
aggregated in a fixed order without retaining input text, while an unsupported Unicode runtime
dominates other profile failures.

Indexes and lookup results are deeply frozen and nominally registered in a private WeakSet. Lookup
accepts only a genuine current-module index and a genuine NFC request profile, then resolves exact
spelling before NFC, fixed fold, and missing. Singleton NFC and fold buckets are retained so a
stronger match cannot accidentally fall through to a broader collision group.

The implementation captures the intrinsics used after module initialization. Array inputs are
bounded before numeric slots are inspected, inherited and accessor slots are rejected, and
internal array writes do not invoke inherited setters. Caller mutation, iterators, forged or
cross-module brands, and hostile proxies cannot alter a completed index or make untrusted data
cross its trust boundary.

## Independent review

One reviewer rebuilt the candidate from the clean baseline and checked the API, provenance,
failure priority, descriptor handling, intrinsic hardening, deep freezing, package boundary, and
256 randomized subsets against a separate naive implementation. The other reviewer constructed an
independent oracle for overlapping canonical and case-fold groups and exercised all 5,040
permutations of the seven-name fixture on Node.js 22.0.0, 24.0.0, and 26.0.0. Every permutation
produced the expected collision semantic digest
`0b498d46c06a0c624ff2506e864c81546e31cfac24722f67b38d61c95110d333`.

The reviews also proved binary UTF-16 ordering with an astral-versus-private-use sentinel, exact
over NFC over fold lookup priority, early rejection of 1,025 entries without touching element
descriptors, and a 1,024-entry stress case producing 1,280 bounded group findings without pair
explosion. Sparse arrays, inherited or accessor slots, throwing and revoked proxies, cloned and
foreign-module brands, input mutation, prototype setters, and post-initialization intrinsic
pollution were all rejected or left results unchanged.

## Verification

The focused suite passes 27 tests across the implementation and committed contract tests. The
complete check passes 335 tests with 97.60% statement and 96.02% branch coverage; the new module
reaches 97.20% statements, 90.83% branches, 100% functions, and 97.04% lines. Formatting, lint,
generated freshness, type checking, and both dependency audits pass with zero vulnerabilities.

A real package contains 143 entries and is 92,271 bytes. It includes only the expected internal
JavaScript, declarations, and source maps for the index, not source tests. A clean consumer install
and root import pass; the package root remains at 18 exports, and the export map blocks deep imports
until the complete validator integration is ready.
