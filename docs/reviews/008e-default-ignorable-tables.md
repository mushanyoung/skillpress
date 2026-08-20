# Review 008e: generated Unicode default-ignorable tables

- Slice: `build: generate Unicode default-ignorable tables`
- Reviewers: independent subagents `/root/review_derived_core_provenance` and
  `/root/design_resource_graph`
- Author: subagent `/root/design_unicode_generator`, finalized by root agent
- Date: 2026-08-19
- Final result: PASS after three fail-closed fixes

## Findings and resolution

The generator parses every data row in `DerivedCoreProperties.txt`, validates its full property
group sequence, and extracts the exact `Default_Ignorable_Code_Point` section. The generated
internal query represents the complete Unicode 15.1 property: 4,174 code points in 17 ranges.
Callers that need assigned characters compose it with the existing pinned assignment query; that
intersection contains 405 code points in 19 ranges.

Initial review found three mutations that preserved superficial record and range counts. Replacing
U+00AD with U+00AE changed the property without being rejected. A range with scalar endpoints
could cross the surrogate block. Finally, the target heading and total could be exchanged with
another property section because their presence was counted globally instead of being associated
with the intervening data.

The final generator binds the target heading, its 27 contiguous data records, and its total marker with
a state machine. Every input range must avoid the entire surrogate interval. It also fixes two
independent, low-bit-first semantic bitset digests: the complete property is
`c8984091f29193139ea640ff7fc181d77f209fe34867cb0368af1f07f260a3bd`, and its Unicode 15.1
assigned intersection is
`47369767624770346e80491eece207fde8e876a257bdf676c0f92fc073773615`. Direct generator tests
lock the three original attacks. The parser also rejects target records outside their section,
non-target data inside it, valued target records, and malformed or misplaced totals.

## Verification

Both reviewers reconstructed the seven-file candidate from a clean archive and replayed the
original attacks. Each now reaches its specific fail-closed check. Independent full-domain
oracles match the generated query for every code point from U+0000 through U+10FFFF and verify the
complete and assigned semantic digests.

The complete check passes 307 tests with 97.65% statement and 96.41% branch coverage. Generated
freshness, formatting, lint, and type checking pass, and the production audit reports zero
vulnerabilities. A real package contains 135 entries and the required Unicode license and notice
while excluding raw UCD data, generator scripts, and tests. The new query remains internal: it is
absent from the package root API, and the export map blocks deep imports.
