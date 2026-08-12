# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Until `1.0.0`, minor versions may contain breaking changes; they will always be
called out under **Changed** with a migration note.

## [Unreleased]

### Added

- Repository scaffold: hygiene files, contribution and security policy, issue and
  pull-request templates, Dependabot configuration, and the documentation skeleton.
- `PROBE-FINDINGS.md`, recording behaviour confirmed against a live SAS Viya 4
  deployment — the evidence base the implementation plan rests on.
- ADR-0000 recording the repository licence decision.
- Dual AI pull-request review (Claude and Codex), running on every pull request.
- TypeScript toolchain: extension manifest, strict `tsconfig`, type-aware ESLint,
  Prettier, esbuild bundling, and a single `npm run verify` gate that mirrors CI.
- A minimal extension that activates and contributes **Python on Viya: Show Log**.
- Copyright-header check enforcing the Apache-2.0 §4(b) modification notice on
  files ported from `sassoftware/vscode-sas-extension`.
- ADR-0001 (extension identity and configuration namespace), ADR-0002 (workspace
  trust posture), and ADR-0003 (extension host target).
- `docs/dev/building.md` — prerequisites, the inner loop, and the toolchain
  constraints that fail silently rather than loudly.
- Three-tier test harness: Mocha with `node:assert/strict` and Sinon for unit
  tests, `@vscode/test-electron` for integration tests that launch a real editor,
  and an opt-in live tier gated three separate ways behind
  `PYTHON_ON_VIYA_TEST_*` environment variables.
- HTTP mocking at the boundary with [msw](https://mswjs.io), configured so an
  unmocked request fails the test rather than escaping to the network.
- Coverage via c8 with a ratchet: thresholds start at zero, and every slice that
  adds code to `src/` raises them in the same pull request. `npm run coverage`
  joins `npm run verify`.
- `docs/dev/testing.md` — the three tiers, the fixture rules, and the reasoning
  behind what the stack deliberately leaves out.
- Copyright check now requires any file referencing the upstream SAS extension
  to declare the relationship as `Ported from:` or `Structure follows:`, closing
  a gap where a ported file that dropped the SAS header passed silently.

### Changed

- **Relicensed from MIT to Apache-2.0** to match the upstream
  `sassoftware/vscode-sas-extension` code this project derives from, and to give
  users an explicit patent grant. See `docs/adr/0000-repository-licence.md`.

[Unreleased]: https://github.com/Shai-Alit/sas-py-vscode/commits/main
