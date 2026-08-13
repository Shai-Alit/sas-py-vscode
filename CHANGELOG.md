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
  and is counted in the output. That `path=` is the one place where a string in
  a document chooses a filename to write to, so it is validated as untrusted
  input — a location must be relative, free of `..`, not drive-qualified, and
  the resolved target is asserted to be inside the repository before anything is
  written.
- `npm run docs:links` and a weekly `link-check` workflow that sweeps external
  links and opens a `link-rot` issue instead of failing a pull request. A 403 or
  429 is reported as unverified rather than broken, because that is what a
  working link returns when the far end dislikes a datacentre IP.
- `npm run docs:links:self`, part of `check:docs`, which resolves every link that
  points back at this repository against the working tree and fails the build if
  it names a file that is not there. Links out of `docs/` have to be written as
  absolute GitHub URLs because VitePress cannot resolve a path above its
  `srcDir`; checking them on disk keeps them gated per pull request, and needs no
  network. It was also the only *correct* check while the repository was private —
  GitHub answers 404, not 403, to an anonymous request for a private repo, so the
  first live run of the weekly sweep reported five broken links and all five were
  fine. The repository is public now; the check stays, because being exact and
  early never depended on that.
- ADR-0004 (documentation toolchain), recording why VitePress was chosen over
  Docusaurus, why external links are swept on a schedule rather than gated, why
  self-links are resolved on disk instead, and why TypeDoc waits for an exported
  API.
- A `supply-chain` CI job answering two questions about the dependency tree: what
  may run code at install time, and which advisories somebody has actually read.
- An install-script policy. Every package that can run code at install time —
  `@vscode/vsce-sign`, `esbuild` at two versions, `fsevents`, `keytar` and `msw` —
  is denied through `allowScripts` in `package.json`, and `strict-allow-scripts`
  turns npm's "scripts were blocked" warning into a failed build. Denying them was
  proven harmless against a clean install: the unit tests, the build, the docs
  build and packaging all pass without them. A unit test reads `package-lock.json`
  and fails if anything marked `hasInstallScript` is missing from the list, because
  the list was written by hand and had already drifted once — `fsevents` is
  optional and darwin-only, so it never shows up in an install on the machine the
  list was written on.
- `npm run check:audit`, which fails on any advisory in the production tree at any
  severity — that tree has no dependencies in it, so an advisory there is news —
  and requires every dev-tree advisory to appear in
  `scripts/advisory-allowlist.json` with a reason and an unexpired date. The
  allow-list is keyed on the GHSA identifier rather than the package, because
  `npm audit` counts packages: its "6 vulnerabilities" covered 7 advisories, and
  the one it folded away was a high-severity Windows-specific `vite` issue. An
  audit that could not run is not reported as a clean one: `npm audit --json`
  announces its own failure as valid JSON on stdout and exits 0, so the report is
  checked for shape before it is believed, and a broken run exits 2 rather than
  passing. Both audits have a two-minute timeout, so a hung registry fails the
  job instead of holding it open.
- CodeQL static analysis, as a committed workflow rather than GitHub's default
  setup, so the query suite and the schedule are reviewable in a pull request
  instead of living on a settings page. `security-extended`, on pull requests and
  weekly, because query packs update on GitHub's timetable rather than on a
  commit.
- `npm run check:secrets`, part of `npm run verify`, which looks for
  credential-shaped strings in the tracked working tree: a JWT, a literal
  `Authorization` header, a base64 `Basic` credential, a PEM private key, a
  credential-named field assigned a literal, and a password in a URL. GitHub's
  secret scanning matches vendor *partner patterns*, and a Viya OAuth token is a
  plain JWT issued by the customer's own deployment — no prefix, no vendor to
  notify — so the two run alongside each other rather than one replacing the
  other. A false positive is silenced with a `credential-scan: allow` comment
  carrying a reason, on the line or the line above; findings are reported
  redacted, because on a public repository the CI log is public too.
- ADR-0006 (scanning posture), recording why CodeQL is a file rather than a
  setting, why the scanner reads the tracked tree and not history, why there is
  no entropy detector, and why `gitleaks` was not used instead.
- ADR-0005 (supply chain policy), recording why the audit gate is asymmetric
  between the production and development trees, why every allow-list entry
  expires, why esbuild's `postinstall` turned out not to be load-bearing, and why
  the whole thing runs in one pinned CI job — `allowScripts` needs npm 12, which
  needs a Node newer than this project's supported floor.
- `PYTHON_ON_VIYA_TEST_VSCODE`, which points the integration tier at a VS Code
  that is already on disk instead of downloading one. `@vscode/test-electron`
  caches per platform in a location it does not let you configure, so a checkout
  shared between two platforms pays the 330 MB twice. A path that does not exist
  is an error rather than a fallback, because falling back would perform exactly
  the download the variable exists to avoid — silently, on a typo. Unset, which
  is the case in CI, nothing changes.

### Fixed

- Profile validation messages shown under an input box are now localisable. The
  model returns a `ValidationProblem` code with its parameters instead of English
  prose, and `src/profile/problems.ts` renders it through `vscode.l10n.t()`;
  adding a code without handling it there is a compile error. Reasons written to
  the output channel stay English by design, because a diagnostic that changes
  language with the editor's locale is harder to search, not easier to read.
- `npm run lint` no longer runs out of memory after the integration tier has been
  run once. ESLint flat config does not read `.gitignore`, so the gigabyte of VS
  Code that `@vscode/test-electron` downloads into `.vscode-test/` was being
  linted; the ignore list now covers it, and a unit test asserts that through
  ESLint's own resolver.

### Changed

- CI classifies each pull request before running it. A change that touches only
  `docs/` or a top-level markdown file now runs the `docs` job alone —
  `verify`, `test`, `package` and `supply-chain` are skipped — while any change
  outside those paths, and every push to `main`, still runs everything. The
  secret scan moved into `docs` so it covers documentation-only changes too.
- **Relicensed from MIT to Apache-2.0** to match the upstream
  `sassoftware/vscode-sas-extension` code this project derives from, and to give
  users an explicit patent grant. See `docs/adr/0000-repository-licence.md`.

[Unreleased]: https://github.com/Shai-Alit/sas-py-vscode/commits/main
