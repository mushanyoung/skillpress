# Review 006a: portable path inputs

- Slice: `refactor: centralize safe filesystem path inputs`
- Reviewers: independent subagents `/root/review_validator_fs` and `/root/review_validator_api`
- Author: root agent
- Date: 2026-08-19
- Final result: PASS

## Findings and resolution

The review reproduced UTF-16 surrogate aliases, all Unicode noncharacters, Windows drive-relative
and device paths, alternate streams, reserved names, and trailing-dot/space aliases. A first fix
also rejected ordinary Windows `.` and `..` structural components and missed `C:` plus the
superscript COM/LPT device forms.

One bounded helper now rejects ambiguous Unicode and platform-specific aliases before filesystem
access while retaining normal relative, absolute-drive, and UNC inputs. The CLI and public project
writer use the same predicate. Tests cover the 64 KiB budget, valid Unicode, controls,
default-ignorables, all noncharacter classes, Windows namespaces, `C:` forms, ADS, DOS devices,
and relative segments.

## Verification

The independently reconstructed clean slice passed `npm run check` with 156 tests. The shared path
module had 100% statement and branch coverage, and the reviewers also checked Node 22/24/26
behavior and the existing CLI/writer contracts.
