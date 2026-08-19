# Review 005a: capability brief and canonical renderer

- Slice: `feat: render canonical skill projects from capability briefs`
- Reviewer: independent subagent `/root/review_config_schema`, with separate schema and renderer
  audits
- Author: root agent
- Date: 2026-08-19
- Final result: PASS

## First review

The first passes found reproducible blockers rather than accepting the happy-path tests:

1. TODO/TBD variants and markers inside multiline license text could reach the generated project.
2. Machine-field exclusions were keyed only by field name, accidentally exempting author and test
   command prose.
3. Training prompts copied into holdouts could evade duplicate detection through whitespace,
   punctuation, case, zero-width, or other ignorable-character changes.
4. A valid brief command name could produce a project document rejected by the project schema.
5. Prose beginning with a Markdown fence, list, thematic break, or raw HTML could corrupt the
   generated instruction structure.
6. Activation conditions and expected/forbidden behaviors could contradict one another.
7. ESC/C1 controls in license or instruction text could reach terminals and archives.
8. YAML-escaped, unpaired UTF-16 surrogates could be accepted in memory and silently change to the
   replacement character when encoded as UTF-8.

## Resolution

- Scan only exact machine-field paths as non-prose and detect placeholder markers on every logical
  prose line.
- Normalize comparable scenario text with NFKC, case folding, punctuation/symbol removal,
  ignorable-character removal, and collapsed Unicode whitespace.
- Reject globally duplicated cases, training/holdout leakage, use/do-not-use overlap, and behavior
  that is both expected and forbidden.
- Align every rendered project field with the project schema and declare the `0.1.0` default in
  the authoritative brief schema.
- Escape user prose before placing it into fixed Markdown structure.
- Reject unsafe C0/C1 controls and unpaired surrogates while retaining valid Unicode and emoji.
- Keep generation pure and deterministic: seven necessary files, byte-identical root/skill
  licenses, sorted cases and paths, SHA-256 digests, and no pass, score, or evidence claims.

## Verification

```text
npm ci
npm run check
npm audit
npm pack --dry-run --json
```

Results: 46 tests passed; statements were 96.47%, branches 92.3%, functions 100%, and lines 96.38%.
The reviewer replayed every exploit above, confirmed the generated `skillpress.yaml` round-trips
through the strict loader, verified the package contains both schemas and all create runtime/types,
and returned PASS from a fresh source copy with no reused dependencies or build output.
