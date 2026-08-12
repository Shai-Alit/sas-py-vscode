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
- Continuous integration: `npm run verify` on every pull request, the unit and
  integration tiers across ubuntu / windows / macOS × Node 20.19.0 and 22, and a
  packaging job that uploads an installable `.vsix` as an artifact.
- `npm run check:package`, which reads the built `.vsix` and fails if it contains
  sources, source maps, internal documents or anything shaped like a credential —
  or if it is missing something it should contain. `.vscodeignore` is
  allow-by-default, so a packaging mistake ships rather than failing.
- `docs/dev/ci.md` — what each CI job does, why the matrix is shaped the way it
  is, and what is deliberately not gated yet.
- A generated settings and command reference. `npm run docs:reference` builds
  `docs/reference/` from `package.json` and `package.nls.json`; the output is
  committed, and CI fails if it drifts from its source.
- A documentation site built with [VitePress](https://vitepress.dev), chosen
  because it fails its own build on a dead internal link — the link check rides
  along with a build the project wants anyway. Building it is a CI job;
  publishing it is a later slice.
- `npm run docs:samples`, which compiles every TypeScript block embedded in
  `docs/`. A sample that imports from the repository declares where it lives
  (` ```ts path=test/unit/example.test.ts `) and is checked against the project
  that owns that directory; a deliberate fragment marks itself ` ```ts no-check `
  and is counted in the output.
- `npm run docs:links` and a weekly `link-check` workflow that sweeps external
  links and opens a `link-rot` issue instead of failing a pull request. A 403 or
  429 is reported as unverified rather than broken, because that is what a
  working link returns when the far end dislikes a datacentre IP.
- `npm run docs:links:self`, part of `check:docs`, which resolves every link that
  points back at this repository against the working tree and fails the build if
  it names a file that is not there. Links out of `docs/` have to be written as
  absolute GitHub URLs because VitePress cannot resolve a path above its
  `srcDir`; checking them on disk keeps them gated per pull request, and is the
  only correct check while the repository is private — GitHub answers 404, not
  403, to an anonymous request for a private repo, so the first live run of the
  weekly sweep reported five broken links and all five were fine.
- ADR-0004 (documentation toolchain), recording why VitePress was chosen over
  Docusaurus, why external links are swept on a schedule rather than gated, why
  self-links are resolved on disk instead, and why TypeDoc waits for an exported
  API.

### Fixed

- `npm run lint` no longer runs out of memory after the integration tier has been
  run once. ESLint flat config does not read `.gitignore`, so the gigabyte of VS
  Code that `@vscode/test-electron` downloads into `.vscode-test/` was being
  linted; the ignore list now covers it, and a unit test asserts that through
  ESLint's own resolver.

### Changed

- **Relicensed from MIT to Apache-2.0** to match the upstream
  `sassoftware/vscode-sas-extension` code this project derives from, and to give
  users an explicit patent grant. See `docs/adr/0000-repository-licence.md`.

[Unreleased]: https://github.com/Shai-Alit/sas-py-vscode/commits/main
