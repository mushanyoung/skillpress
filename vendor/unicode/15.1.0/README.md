# Unicode 15.1.0 portability data

This directory contains byte-for-byte copies of two Unicode Character Database
15.1.0 files used as development inputs for SkillPress's deterministic Unicode
portability tables.

- Source retrieval date: 2026-08-19
- SPDX license identifier: `Unicode-3.0`

| File | Upstream | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `CaseFolding.txt` | <https://www.unicode.org/Public/15.1.0/ucd/CaseFolding.txt> | 84,870 | `4e55acfdc32825a22e87670e9056a3bf94ad7c5400065778e9e10f8314372bcf` |
| `DerivedAge.txt` | <https://www.unicode.org/Public/15.1.0/ucd/DerivedAge.txt> | 131,154 | `04e16379344bdb9973cdb6f6bf0a5dd66f7cd41b014cd9f79d848768ae757256` |

The data is licensed under Unicode License V3; see
[`LICENSES/Unicode-3.0.txt`](../../../LICENSES/Unicode-3.0.txt) and the repository's
[`THIRD_PARTY_NOTICES.md`](../../../THIRD_PARTY_NOTICES.md).

These files are repository-only generation inputs. The npm package allowlist
deliberately excludes `vendor/`; generated runtime artifacts must be committed
separately.
