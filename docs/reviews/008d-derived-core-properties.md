# Review 008d: Unicode 15.1 derived core properties

- Slice: `chore: vendor Unicode 15.1 core properties`
- Reviewers: independent subagents `/root/review_derived_core_provenance` and
  `/root/design_resource_graph`
- Author: subagent `/root/vendor_unicode_data`, finalized by root agent
- Date: 2026-08-19
- Final result: PASS after two test-strength fixes

## Findings and resolution

The provenance review independently downloaded `DerivedCoreProperties.txt` from unicode.org and
matched it byte-for-byte. The fixed source has 1,072,686 bytes, 12,832 lines, SHA-256
`f55d0db69123431a7317868725b1fcbf1eab6b265d756d1bd7f0f6d9f9ee108b`, the Unicode 15.1.0
header, and the 2023 Unicode copyright notice. An independent parser found 27
`Default_Ignorable_Code_Point` records, 4,174 code points, and 17 merged ranges. The existing
Unicode License V3 file also matched the current official license byte-for-byte.

The first package test only locked the top-level npm allowlist. Review showed that a raw UCD file
could be renamed into an already allowed directory such as `schemas/` and enter the tarball. The
final test reads the real `npm pack --dry-run` manifest, requires the Unicode license and notice,
rejects `vendor/`, and hashes every packed entry to reject all three raw source files regardless of
their packaged names.

The first provenance assertions also accepted an additional conflicting table row as long as the
correct row remained present. The final test compares the complete Markdown provenance table and
locks each source filename occurrence, so stale or contradictory source records fail.

## Verification

The reviewers reconstructed the candidate from clean archives. Official downloads of all three
vendored UCD files matched their pinned bytes and hashes. The two adversarial package/provenance
mutations now fail the focused test, while the final focused suite passes all six tests.

The complete check passes 302 tests with 97.65% statement and 96.40% branch coverage. The
production dependency audit reports zero vulnerabilities. A real package contains 135 entries,
includes `LICENSES/Unicode-3.0.txt` and `THIRD_PARTY_NOTICES.md`, excludes raw vendor data, and
passes clean CLI and root-API installation smoke tests. This slice adds no parser, generated table,
runtime query, or validator behavior; those changes remain separate commits.
