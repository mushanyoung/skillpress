# Review 007c: Markdown body coordinates

- Slice: `feat: preserve Markdown body coordinates`
- Reviewer: independent subagent `/root/review_validator_yaml`
- Author: root agent
- Date: 2026-08-19
- Final result: PASS

## Findings and resolution

The envelope now records the body start as a zero-based UTF-16 code-unit offset and a one-based
logical source line. LF, CRLF, and lone CR each advance one line; the offset retains their exact
code-unit width. A closing delimiter at EOF with no body points to the virtual following line and
an EOF offset. Frontmatter parsing propagates both values without changing existing YAML locations
or normalizing the body.

## Verification

An independently reconstructed clean-state slice passed 236 tests. Review exercised 110 newline,
mixed-ending, empty-body, astral, and delimiter cases; compared successful and failing diagnostics
against the baseline; and verified both line and unist-style offset translation. BOM, malformed,
and unclosed inputs still return no envelope. The fields remain internal and do not change the
public validation report or package exports.
