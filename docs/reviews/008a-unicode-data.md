# Review 008a: Unicode 15.1 portability data

- Slice: `chore: vendor Unicode 15.1 portability data`
- Reviewers: independent subagents `/root/review_unicode_provenance` and
  `/root/review_unicode_packaging`
- Author: subagent `/root/vendor_unicode_data`, finalized by root agent
- Date: 2026-08-19
- Final result: PASS

## Findings and resolution

The source review independently downloaded `CaseFolding.txt`, `DerivedAge.txt`, and Unicode License
V3 from unicode.org. All three files matched the candidate byte-for-byte, including fixed lengths,
SHA-256 digests, version headers, record counts, and copyright notices. The reviewer confirmed the
`Unicode-3.0` SPDX identifier, OSI approval, MIT compatibility, and the sufficiency of shipping the
complete permission notice in associated documentation.

The first packaging test only required selected allowlist entries to be present. Review showed that
a future `src/` or `test/` addition could leak files while the test still passed. The final test
locks the complete npm allowlist, official URLs, complete provenance table rows, display byte counts,
and license links without locale-dependent formatting.

## Verification

Two independently reconstructed clean-state candidates passed 284 tests with 97.49% statement and
96.23% branch coverage, a zero-vulnerability production audit, package-lock identity checks, and
both dry-run and real package installation. The final tarball contains the Unicode license and
third-party notice while excluding `vendor/`, `src/`, and `test/`. Installed CLI and root API smoke
tests passed. This slice contains no generator, Unicode algorithm, runtime table, or validator
integration.
