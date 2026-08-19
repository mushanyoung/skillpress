# SkillPress

SkillPress builds, evaluates, packages, and publishes production-grade Agent Skills. It combines
an installable skill with a typed CLI so open-ended authoring stays agent-friendly while quality,
testing, provenance, and publication gates remain deterministic and auditable.

The project is under active development. The future npm package is
`@mushanyoung/skillpress`; the unscoped `skillpress` name belongs to a different project and will
not be used.

```bash
npm install
npm run build
node dist/bin.js --help
```

SkillPress distinguishes local readiness from Tessl's official Quality and Impact scores. It will
only report the latter when current Tessl evidence exists, and the release profile defaults to a
minimum of 90 for both.

See [the reviewed implementation plan](docs/PLAN.md) for architecture, security boundaries,
registry capabilities, and the small-commit delivery sequence.

## License

MIT
