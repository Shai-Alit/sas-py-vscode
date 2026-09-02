# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Until `1.0.0`, minor versions may contain breaking changes; they will always be
called out under **Changed** with a migration note.

## [Unreleased]

### Added

- **Python on Viya can now actually run Python on Viya.** Slice 3d-i
  ([ADR-0011](docs/adr/0011-choosing-where-python-runs.md)) adds `Python on
  Viya: Run File`, `Run Selection`, `Cancel` and `Reset Python State`, wiring
  3a–3c-ii's `ProcPythonBackend` to real commands for the first time. Each run
  streams to a new **Python on Viya: Output** channel — separate from the
  existing log channel, because a program's stdout and the extension's own
  diagnostics are two different transcripts — naming its target as the first
  line. `text/html` and `image/png` outputs are reported as produced but not
  yet rendered; the result panel that actually shows them is 3d-ii. `Run File`
  clears the interpreter's globals first (`freshNamespace: true`); `Run
  Selection` does not, so a selection can build on state a previous selection
  run left behind, the same way a notebook cell would.
  `editor/title/run` and `editor/context` entries for `Run File`/`Run
  Selection` are gated on a new `pythonOnViya.runTarget` context key, so they
  appear only when the workspace's run target is Viya — see the status bar
  change below. No default keybinding ships; ADR-0011 explains why every
  plausible default collides with something already on that key.
- **A result panel actually renders `text/html`, `image/png` and a structured
  traceback.** Slice 3d-ii
  ([ADR-0021](docs/adr/0021-result-panel-webview.md)) adds this repository's
  first webview — a single, reused panel beside the editor, CSP-locked (no
  script may execute except this extension's own bundle; a `text/html`
  output's own markup is inserted safely because of that policy, not despite
  it) and fed by a buffered host↔webview message protocol. It only pops open
  when a run produces something the output channel cannot already show in
  full — an image, a table, or a traceback — so an ordinary `print()`-only
  script stays exactly as quiet as it was in 3d-i; its content still stays in
  sync in the background if a panel from an earlier run is already open. An
  image gets localised alt text; a `text/html` output keeps its own real
  `<table>` semantics rather than being flattened; a traceback becomes a
  heading, a message and a genuine list of frames.
- **The connection-profile status bar item is now the run-target switch.**
  Still `pythonOnViya.activeProfile`, same status bar slot, but its command
  changes from `pythonOnViya.switchProfile` to the new
  `pythonOnViya.selectRunTarget`, and its text/tooltip now say **Local
  Python** or **SAS Viya**, not just which profile is active.
  `pythonOnViya.switchProfile` is unchanged and still reachable from the
  Command Palette. The run target itself lives in `workspaceState` (never a
  setting — the same reasoning ADR-0002 already applies to the profile
  settings), defaults to **Local**
  ([ADR-0020](docs/adr/0020-run-target-defaults-to-local.md), superseding
  ADR-0011's original "defaults to Viya" — a manual check found this
  extension's own run button became the editor's *primary* one, ahead of
  `ms-python.python`'s, before anyone had configured anything), and the
  extension never changes it on the user's behalf: a run against Viya with no
  profile, or a dead session, fails with an actionable message rather than
  silently falling back to Local.

- **`Python on Viya: Show Environment` — the interpreter's version, path and
  installed packages, on demand.** Slice 3e adds
  `ExecutionBackend.probeRuntime()`, widening `BackendCapabilities.runtime`
  from the `"unprobed"`-only type 2b-i left it as. The probe runs a fixed,
  extension-authored script (never user code) that writes its answer to a
  file in the session's working directory rather than printing it — finding
  62 already established that the log wraps any sufficiently long `print()`
  line at a hard character count with no way to tell a wrapped continuation
  from a genuine new line, and a package list is exactly the shape of payload
  that triggers it, so this reuses the byte-exact file-fetch mechanism 3c-i
  built for matplotlib/pandas output instead of a second, log-based channel.
  A distribution whose metadata is too broken to name or version is skipped,
  so one bad package on the deployment cannot blank the whole list.
  The result is cached per profile (`globalState`, since a profile is
  user-global) with **no automatic refresh** — probing costs a real
  `PROC PYTHON` round trip, so it only happens the first time a profile is
  probed and whenever `Python on Viya: Refresh Environment Info` is run
  explicitly. Both commands are reachable from the Command Palette and from a
  new status bar item, visible only once a Viya profile is selected. The
  answer opens as a read-only, plain-text virtual document — chosen over a
  second webview for this slice's size, and over the output channel because a
  package list is a reference to search, not a log line to scroll past.
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

- The authentication core: PKCE, the SASLogon token grants, and the OAuth client
  id rule — `src/auth/`, with no `vscode` import, so it is specified by unit
  tests rather than exercised through an editor. The browser sign-in that uses
  it follows in the next slice. It is a port of the SAS extension's `auth.ts`
  and it deliberately differs from it in five places, each recorded in
  [ADR-0008](docs/adr/0008-auth-core-transport-and-security-deltas.md): the code
  verifier comes from a CSPRNG rather than `Math.random()`; `state` is random
  and is checked rather than being set to the callback URL and ignored, which is
  the code injection RFC 6749 §10.12 describes; base64url comes from Node
  instead of three chained `.replace()` calls; `expires_in` is kept as an
  absolute instant so a refresh can happen ahead of expiry instead of costing a
  request to discover it; and the OAuth `error` and `error_description` fields
  are read instead of discarded. There is no HTTP client dependency — the
  production dependency tree stays empty and the transport is an injected port.

- The default HTTP transport, `src/auth/transport.ts`, over `node:https` rather
  than `fetch`. Requests made through Node's `http`/`https` modules inherit the
  proxy and certificate arrangements the editor makes for extensions; `fetch`
  goes through undici and inherits neither. The certificate half is the reason it
  matters — an internal certificate authority is ordinary in enterprise Viya, and
  a transport that cannot see the operating system trust store fails such a
  deployment at sign-in, before any authentication code runs. This closes the
  proxy question [ADR-0008](docs/adr/0008-auth-core-transport-and-security-deltas.md)
  left open, and closes it with no new dependency. Redirects are deliberately not
  followed: the request body holds a client secret and an authorization code.

- Browser sign-in: **Python on Viya: Sign In** and **Python on Viya: Sign Out**.
  The browser opens on the deployment's own login page, and the authorization code
  comes back either through a `vscode://` callback or through a paste box, both
  racing so that whichever the deployment supports is the one that finishes. The
  callback URI goes through `env.asExternalUri()` **before** it is put into the
  authorize URL, which is what makes sign-in work in Codespaces and remote/SSH
  windows rather than only on a laptop. A callback whose `state` is not the one
  this window issued is discarded and — deliberately — does *not* end the attempt,
  so a forged link cannot be used to break a sign-in that is legitimately in
  progress. Only the refresh token is persisted, in `SecretStorage`, keyed on the
  profile's generated `id` so that renaming a profile does not orphan it; the
  access token is short-lived and can be re-derived, and a second long-lived copy
  of a credential on disk buys nothing.

- The sign-in decisions live in `src/auth/signIn.ts`, which imports no `vscode`
  and is therefore specified by unit tests: which arm of the race won, whether a
  callback belongs to this attempt, whether a rejected one should end the wait,
  and what is worth persisting. The five modules around it hold only the calls
  that need an extension host. Upstream's equivalent is a single function that
  does all of it, reachable only by launching an editor.

- `npm run check:coverage-scope`, which asserts that a module is excluded from
  the unit coverage denominator **if and only if** it imports `vscode`. It joins
  `npm run verify`, and it exists so that the exclusion in the entry below is a
  rule rather than a list of exceptions: a pure module parked in the list is
  caught, and so is a new shell module missing from it. Globs are refused, and
  the import test is TypeScript's parser rather than a text search, so comments
  discussing `vscode` are not mistaken for imports and a type-only import — which
  is erased before the code runs — keeps its coverage floor.

- An integration suite per module of the sign-in shell, run in a real editor.
  Because those modules are outside the coverage denominator by construction,
  these tests are the only thing holding their line, and they are aimed at the
  parts a double would have to invent: callbacks parsed by the host's own
  `vscode.Uri`, the race settled by real cancellation tokens, and every sign-in
  failure rendered through the real `vscode.l10n.t()` — where a placeholder left
  without an argument reaches the user as `{0}` and no type-check would say so.
  `SecretStorage` reaches an extension only through the context handed to
  `activate`, so the store is specified against an in-memory double and the real
  keychain is exercised the one way a test can reach it, by running
  **Python on Viya: Sign Out** end to end; the trade-off is written up in
  `test/helpers/auth-host.ts` rather than left for a reader to infer.

- Sign-in is now an **account** in the editor's Accounts menu rather than only a
  pair of commands. The extension registers `pythonOnViya` as an authentication
  provider labelled **SAS Viya**, so the Accounts menu can sign in, show who is
  signed in, and sign out; the commands call straight through to the provider,
  because two implementations of signing in is how a menu and a command palette
  end up disagreeing about who is signed in. Every connection profile is its own
  account, so a test deployment and a production one can be signed in at the same
  time in the same window and signing out of one leaves the other alone — an
  account is keyed on the deployment plus the Viya user id, which is why renaming
  a profile, or an administrator fixing a typo in a display name, does not sign
  anybody out. It differs from upstream's provider in four places, each one a
  defect the audit under slice 1c in `PRODUCTION_PLAN.md` records: upstream stores
  a single session blob, so a second profile overwrites the first; `getSessions`
  refreshes on every call, and the Accounts menu polls, so opening a menu is a
  network round trip and a moment of bad Wi-Fi is a silent sign-out; an
  unrecognised id in `removeSession` falls back to the active profile, which turns
  a caller's bug into signing the user out of something they never named; and the
  session write is not awaited, so a window closing straight after sign-in can
  lose the session it just established. Here a held token is served from memory
  and renewed only against the absolute `expiresAt` 1b-i already computes, an
  unknown id is an error, and the write is awaited. Both provider calls honour the
  account a caller names — `getSessions` answers for that one, and `createSession`
  signs in to the profile it belongs to rather than whichever is active — while
  still publishing the whole session list, because narrowing what is published
  would announce every other session as removed.

- `src/auth/identity.ts`, which reads the signed-in user, and asks for
  `application/vnd.sas.identity.user.summary+json` **explicitly**. That header is
  the entire data-minimisation story: the full representation on the probed
  deployment carried a street address with postal code, a work email and two
  phone numbers for a real person, and upstream sends no `Accept` header at all,
  so it pulls all of that into the extension host and keeps two fields. The
  summary type is the same URL and the same `200` without them, and what never
  arrives cannot reach a crash dump, a heap snapshot or a log attached to an
  issue. A `406` — which finding 6 established is what a media type a deployment
  does not serve looks like — retries with the full type and drops the personal
  fields as it parses, which is what lets Viya 3.5 be *unverified* rather than
  *unsupported*. Only `id`, the display name and the login are kept; the account
  label falls back from one to the next, because only `id` was established as
  always present, and `title` is deliberately not in that chain — it is a job
  title, and nobody's idea of who is signed in.

- `onDidChangeSessions` fires on real transitions only, and the comparison lives
  in a pure `diffSessions(before, after)` so "did anything actually change" is a
  unit test rather than an observation about event volume. The
  `pythonOnViya.authorized` context key is set alongside it, for the `when`
  clauses Phase 2 onward will gate on.

- `TransportResponse` now exposes response headers, and `src/auth/challenge.ts`
  parses RFC 6750's `WWW-Authenticate`. Probe finding 9: a dead Viya token is a
  **401 with a zero-byte body**, so any error path that builds its message from
  the body renders an empty string for the most common recoverable failure there
  is. The parser separates three states that all arrive as that same 401 — a
  token the deployment rejected (`error="invalid_token"`, sign in again), a
  request that carried no credentials at all (a bare `Bearer` challenge, which is
  our bug and not the user's), and no Bearer challenge whatsoever — and a comma
  inside a quoted `error_description` survives, which is the difference between
  showing the server's sentence and showing the first half of it.

- `docs/signing-in.md` — signing in and out, what the Accounts menu shows, why
  opening it makes no network request, what is written to disk (the refresh token,
  and only that) versus held in memory (the access token), what the extension asks
  Viya about you and why the answer is deliberately small, and what happens when
  each of it fails.

- `PROBE-FINDINGS.md` findings 10-12, from the first real sign-in against a live
  Viya 4 deployment: that the built-in `vscode` OAuth client registers
  `urn:ietf:wg:oauth:2.0:oob` and no custom-scheme address, that `state` cannot
  be used to smuggle a callback URL past it, and that SASLogon quotes the
  `code_verifier` it received back at you. Each is the evidence for a fix below,
  written down where the next person will look for it rather than left in a
  commit message. Unlike findings 1-9 this evidence could not be gathered with
  `curl`, because the authorize leg needs a human to type a password; the
  methodology note at the head of the section says so.

- `src/compute/` — the Compute client, hand-written against the observed wire
  shape rather than generated, and pure enough to unit test: `links.ts` for link
  lookup and href resolution, `problems.ts` for the Viya error envelope as a
  problem union, `client.ts` for one request driven by a link, `contexts.ts` for
  resolving the context a profile names, and `session.ts` for the session
  lifecycle. Every request follows a relation the deployment sent; the only URL
  this project writes down is the endpoint from the profile, which is ADR-0010
  and is also why a link pointing at another host is refused rather than
  followed — every request built from one carries the user's bearer token.

- Compute contexts resolve in a **single request**. The collection item already
  carries a fully formed `createSession` link, so the follow-up
  `GET /compute/contexts/{id}` is unnecessary. Two rules the live deployment
  taught us are enforced by tests rather than by comment: a name containing an
  apostrophe is escaped by **doubling** it before percent-encoding (finding 15 —
  a backslash is a `400`, and encoding first leaves no quote to double, and
  finding 22 measures the apostrophe as the *only* character needing it), and the
  collection's `count` is `null` whenever the page does not already hold
  everything (finding 16), so paging follows the `next` link and never the count.

- Compute sessions can be created, watched, cancelled and torn down. The state
  poll is a **server-side long poll** — `?wait=N` with `If-None-Match` returns a
  `304` after exactly N seconds (finding 19) — so there is one round trip per
  window and no client-side timer, and the request's own timeout is stretched past
  the server's wait so the client is never the thing that gives up first. An
  unchanged reading carries no state at all, which is what stops a caller
  re-fetching the value it just declined to be sent. Teardown sends no `If-Match`,
  because a stale validator turns a working teardown into a `412` and leaves a SAS
  process running until the 900-second inactivity timeout reaps it, and a session
  that is already gone counts as torn down. A `404` on a session becomes
  `session-gone`, a recoverable event rather than an error; a `401` deliberately
  does not, since creating a new session with a credential that just failed only
  fails again.

- `PROBE-FINDINGS.md` findings 13-22 and the first Compute fixture, captured from
  a live Viya 4 deployment and scrubbed per `test/fixtures/README.md`. Per
  ADR-0010 these stand in for the specification that does not exist, so the
  fidelity is the point: field names, types and null-versus-absent patterns are
  exactly as the server sent them. Finding 21 is the load-bearing one — a session
  representation arrives carrying 22 link relations, which is the entire session
  API, and it is why `session.ts` composes no URLs.

- ADR-0011, recording how a user chooses to run a file on Viya rather than on the
  local interpreter — the one question about this extension that the repository
  had never answered in writing. Each workspace gets a **run target**, set from
  the status bar, which decides whether the extension puts a run affordance in the
  editor at all; with the target on Local it contributes nothing and starts no
  interpreter. The record exists mostly for the alternatives it rejects, chiefly
  claiming the editor's play button whenever a profile happens to be signed in.
  Nothing ships yet — this is the design 3d-i executes, and the plan and runbook
  now carry its punch list.

- `PROBE-FINDINGS.md` findings 23-29, from the first **mutating** probe in the
  file: three throwaway compute sessions, each deleted in the same shell call.
  They settle what a stale session id costs (a `404`, identically on every verb,
  and indistinguishable from an id that never existed), that a session settles to
  `idle` rather than `running`, that completion belongs to the job and the session
  lags it, and that the state long poll does nothing at all unless `If-None-Match`
  travels with `wait`. Finding 8's claim that the identity `id` is opaque is
  corrected in place: on the probed deployment it is an email address, which makes
  it personal data subject to the same minimisation rule as the rest of the
  identity payload.

- ADR-0012, recording where a compute session id is persisted and what happens
  when it is stale: `workspaceState` keyed by profile id, one session per
  workspace and profile, and the stored id treated as a hint validated by use
  rather than a fact. Reclaim-by-listing was the leading alternative and the
  probes talked us out of it — session names are not unique, so the filter returns
  candidates rather than an answer. Executed in 2a-ii.

- **Python on Viya: Connect to SAS Viya** and **Disconnect from SAS Viya**. Connect
  signs in if needed, resolves the profile's compute context, opens a compute
  session and remembers it; disconnect deletes the session and forgets it. Nothing
  runs Python yet — this is the connection the run command will use.

  The session is remembered per workspace and per profile, so reloading the window
  reattaches to the same SAS process and the Python namespace survives it. A
  remembered id is treated as a hint: it is tried, and a session that has since
  ended is replaced without a prompt rather than reported as a failure. Two
  profiles can hold sessions at once, which the SAS extension's process-global
  session cannot. The access token is borrowed from the authentication provider on
  every request rather than captured once, because a session lives fifteen minutes
  and a token may not.

  Connect refuses in an untrusted workspace, before it reads a profile or makes a
  request, and *Connect* is not offered in the palette there. It names the account
  belonging to the active profile's deployment, so a window signed in to two Viyas
  resumes the right session rather than offering a list on which only one entry can
  work, and a deployment nobody has signed in to yet goes straight to its own
  sign-in. Where an account cannot identify a profile — two profiles pointing at
  the same deployment, or two people signed in to one — it asks rather than
  guesses, and still refuses outright if what comes back belongs to another
  profile. A profile with no compute context configured is asked once, and the answer is
  written back into the profile once a session has actually started on it — a
  context that turns out not to work leaves the profile alone, so the picker is
  still there next time. Cancelling the progress notification stops the connect
  and says nothing further, because a cancelled request is indistinguishable on
  the wire from a deployment that is down.

- Signing in connects. **Python on Viya: Sign In** now opens a compute session
  once it has signed you in, because there is no other reason to sign in to a
  compute server and asking for two commands to reach one outcome is friction
  with nobody paying for it. The two commands meet in the middle: *Connect*
  already signed you in if you were not, so from a cold start either one now
  gets the whole way. A sign-in whose connect does not happen still says the
  sign-in worked — the connect has already reported its own failure, and what
  would otherwise be lost is the one fact that stops you signing in twice.

  The **Accounts menu** deliberately does not connect. That menu is polled by the
  editor, it is opened to read rather than to start something, and it can act on
  a profile other than the active one — so a SAS process started from it would be
  one nobody asked for, on a deployment the user was not looking at. The connect
  therefore lives in the command rather than in the authentication provider,
  which is what both routes share. *Connect* survives for reconnecting: after a
  session times out, after switching profile, after ending one deliberately.
  Recorded as ADR-0013, with the alternatives that lost.

- `PROBE-FINDINGS.md` findings 31-39, settling how Python will be submitted before
  the backend interface freezes around the wrong shape. It will be an upload plus
  `proc python infile=<fileref>;` rather than an inline `submit`/`endsubmit`
  block: a line reading `endsubmit;` inside a triple-quoted Python string does end
  the block, and the truncated remainder leaves the SAS tokeniser in a state where
  the **next** job reports `completed` while executing nothing at all. That is the
  failure this project has been most worried about, and it is worse than expected
  — silent rather than loud, and it outlives the submission that caused it. Inside
  an intact block nothing else misbehaves: `%let` and `&sysuserid` are literal
  text and an apostrophe opens no SAS quote. Also settled: `SYSCC` is readable
  from the session variables endpoint rather than only from log text, so failure
  detection does not have to wait on the log filter, and `proc python restart;`
  clears the Python namespace in about three seconds while the compute session,
  its libraries and its filerefs carry on.

- ADR-0014, recording that decision and the reasoning the changelog bullet above
  cannot carry: why the tempting middle path was rejected (sending the
  `*';*";*/;quit;run;` recovery incantation before every inline submission heals
  the poisoning but leaves the truncated code executing as SAS, and its
  `nosyntaxcheck` would suppress genuine errors on every run), why scanning user
  code for `endsubmit;` is the same mistake as writing an escaper, and what the
  probe left open — `ECHO`, `TIMEOUT`, `COMMAND` and `SRC`, large files and
  concurrency, where the uploaded file should live and who can read it, and
  cleanup when a session dies mid-run. Nothing ships yet; this is the shape 2b
  freezes and 3a implements.

- The `ExecutionBackend` seam — the interface everything above execution talks
  to, so that `PROC PYTHON` is one implementation rather than the shape of the
  extension. A program is **bytes and an origin**, never a string of code, which
  is ADR-0014 expressed as a type: there is no code text in between for an
  `endsubmit;` to be interpolated into. `execute` returns a handle that streams
  output and settles separately, because waiting for a finished result would
  foreclose live output, cancellation and notebook rendering — and the aggregate
  is still one short function away, which is the argument for the ordering.
  Output is a list of typed parts rather than one HTML string. A second run while
  one is in flight is **rejected**, naming the run in the way, rather than
  queued: a queue is a visible policy decision and belongs to the slice with a
  status bar in it.

  The seam has its own failure vocabulary, separate from the Compute client's,
  because ETags and status codes mean nothing to a backend that is not Viya. The
  distinction it is built around: **a program that raises is not a failure** — the
  backend did its job, and conflating the two is how a user's own
  `ZeroDivisionError` gets presented as an extension malfunction. Recorded as
  ADR-0015, with the two-phase `stage`/`run` seam, the aggregate return and the
  queue among the alternatives that lost.

- The dialect layer: `Dialect`, the Viya 4 and Viya 3.5 dialects, and
  `resolveDialect()`, which returns the reason it chose along with the choice.
  The dialects are nearly empty and stay that way — a method appears when a probe
  or a known defect proves the generations differ, not in anticipation — because
  nothing in this project has ever been run against Viya 3.5, and an empty seat
  says so more honestly than a table of guesses would. Stage-1 probing's signal
  is a three-way union rather than a string that might be missing: "answered, no
  cadence version" means 3.5, while "could not ask" means unknown, and collapsing
  them is how a permissions problem becomes a confident wrong claim about the
  deployment. An inconclusive answer assumes Viya 4, says it assumed, and marks
  itself uncertain.

- Nothing implements the seam until 3a, so it ships with its specification
  executable: a complete test double in `test/helpers/`, and a contract test file
  whose tests read as sentences from ADR-0015 — including the `endsubmit;` string
  from probe finding 31, carried through byte for byte. The `PROC PYTHON` backend
  should be able to run that same file.

- `docs/architecture/execution-backends.md` and `docs/architecture/dialects.md`.
  Their interface listings are compiled by `docs:samples`, so a rename that
  leaves them stale fails the build. The listing in ADR-0015 is marked
  `no-check`, which is now the convention: an architecture page describes the
  code as it stands, while an ADR records what was decided on a date and is
  superseded rather than edited.

- `contracts/` — the REST footprint this extension depends on, one file per Viya
  generation, checked by `npm run check:contracts` as a step in `verify`. Three
  things have to agree — the contract, the dialect layer and the fixture
  directories — and the agreement is asserted in **both** directions. The reverse
  half is the one that earns its keep: a one-way check catches a contract naming
  a generation nobody supports, which is a mistake people make while deleting
  things, and misses the one people actually make — adding a generation to the
  union and never writing its contract, a failure whose only evidence is a file
  nobody created.

  `viya35.yaml` has no endpoints and an `absent` list instead, because stage-1
  probing identifies a deployment as 3.5 by *not* finding something and the thing
  not found has to be written down somewhere other than a branch. Every id under
  `absent` must appear as an endpoint in another contract, so the list cannot
  decay into notes about endpoints that no longer exist anywhere. Nothing in that
  file has been observed; endpoints arrive there when something has talked to a
  3.5, not when a manual describes one.

  YAML, with a dev-only parser, because better than half of each file is prose —
  which probe found this, which media type is required, which field is
  deliberately not read — and a format whose comments live in a sibling document
  is a format whose comments go stale separately. Nothing under `src/` imports
  the parser, no contract is read at run time, and `contracts/**` is excluded
  from the VSIX. ADR-0016 records the alternatives, including a TypeScript module
  — rejected because a contract importable from `src/` is a version branch with a
  data file to read from.

- Stage-1 capability probing: the extension now asks a deployment which
  generation it is, and says so in the log. Two requests rather than one — from
  `/deploymentData` to whatever its `cadenceVersion` relation points at — because
  ADR-0010 expresses a version difference as the presence or absence of a link
  relation, and a composed path cannot tell a missing feature from a moved one.
  The relation is selected by media type as well as by name: it appears **twice**
  in that document, differing only in `type` (finding 44), so selecting on the
  name works today by luck.

  It runs after a session has been established, never before, and that ordering
  is the design rather than an implementation detail. A routed Viya service
  answers a bad path with a Viya error document; an unrouted one is answered by
  the ingress with a bodyless 404 carrying no content type, and a proxy or a VPN
  portal produces something in the same family (finding 42). So a 404 alone can
  never mean "Viya 3.5" — read that way, anything in the network path could name
  the generation on the deployment's behalf, and the user would then be told
  their deployment has no built-in OAuth client. A live compute session is the
  evidence that closes the gap: it proves the host is a reachable Viya that this
  token works against.

  The answer is logged as one line whose **level is the certainty** — information
  when the version was determined, a warning when it was assumed — carrying what
  the resolver's own reason throws away: the release's support-track display
  name, or the detail that separates a proxy in the way from a deployment that
  really has no such endpoint. Everything done after an assumed resolution is
  done on an assumption, and a bug report opening with that warning has already
  named its most likely cause.

  Cached per profile, keyed on the endpoint as well as the id — a profile is a
  settings entry people edit in place, and one repointed at another deployment
  must not be answered for by the deployment it used to name. Only *certain*
  resolutions are cached: an inconclusive answer is a report about one attempt to
  ask, not a finding about the deployment, and caching it would let a cancelled
  connect decide how the window talks to a deployment until it is reloaded.

- `docs/architecture/capability-probing.md` and
  `docs/architecture/contracts.md`.

- `PROBE-FINDINGS.md` findings 46-53, measuring the job log before the log
  stream is written. The load-bearing question was whether the log endpoint's
  `timeout=` parameter really long-polls, because the upstream loop being ported
  passes it and nothing had ever checked: it does. Against a job deliberately
  silent for 25 seconds, `timeout=10` blocked the full 10.27 seconds while the
  same request without it came back empty in 0.56 seconds; against a job
  printing a line a second, it released in about a second each time, the moment
  the line appeared. So the stream is driven by the log rather than by a
  state long poll — but the parameter is the only thing between that loop and a
  busy-wait against a corporate network, which is why it belongs at the call
  site rather than in an options bag a caller can leave out. Expiry is a `200`
  carrying an empty array, where the session state's expiry — the only other one
  measured — is a `304`, and the log carries no `ETag` at all, so `start` is the
  entire cursor.

  The drain turns out to be free: a job that has reached a terminal state
  short-circuits the wait and answers in 0.26 seconds, so there is no trailing
  ten-second stall at the end of every execution. Reading past the end is a
  `200` with zero items rather than an error, and the `next` link disappears
  even on a *full* final page — so the drain terminates on the link's absence
  and must never key on a short page.

  Also settled: the job representation and its ten link relations, two of which
  carry `type: null`, which answers the question finding 21 left open and
  constrains what the contract checker may require. And the line `type`
  vocabulary 3b's filter will be built on — `source`, `note`, `normal`, `error`,
  an open set in which `note` is a catch-all covering continuation lines,
  whitespace and blank lines rather than a `NOTE:` prefix test. A real log is
  predicted to carry no `source` lines at all, because those only appear for
  inline submission and ADR-0014 chose upload plus `infile=`, which echoes
  nothing — a prediction this probe could not check, since it submitted inline.

- ADR-0017, recording what those measurements decide about the stream that has
  not been written yet: the loop is driven by the log's own long poll, the job
  module stays neutral about what the statements it submits say, and the stream
  is a **self-driving pump** behind the `AsyncIterable` that ADR-0015 froze —
  polling that runs whether or not anything is consuming it. The obvious
  implementation is an `async function*`, and it is the alternative this record
  exists to reject: a generator's body does not run until something calls
  `next()`, so a caller that awaits the outcome and ignores the output would
  deadlock against a job that completed on the server minutes earlier. ADR-0015's
  "must not stall waiting for a consumer that never arrives" is not a defensive
  nicety — it is what keeps the two members of `ExecutionHandle` independent.

- `src/compute/job.ts` — submitting statements into a live session, asking
  whether the job has finished, and reading a page of its log. Four calls, each
  making exactly one request and reporting what happened, in the shape
  `src/compute/session.ts` established: no retry, no loop, no timers, and no URL
  composed anywhere. The loop that turns these into a stream is the next slice;
  this one is the parts that have no concurrency in them.

  Three of those calls exist as they do because of something measured. The job
  state is read **unconditionally** — no `wait`, no `If-None-Match`, and so no
  `304` arm at all, since a `wait` is inert without a validator and the loop above
  only asks for the state when it already wants an immediate answer. That also
  leaves nowhere for the upstream `getState()` recursion — which answers a `304`
  by fetching the state it just asked not to be sent — to be ported into. The log
  read always sends its `timeout`, and refuses a value that is not a positive
  integer, because the parameter is the only thing standing between the loop above
  and a busy-wait. And the five terminal states are read the right way round:
  upstream's `isDone` tests `indexOf(state) === -1` and therefore answers `true`
  when the job is still running.

  Blank lines are kept. Six of the twenty-one lines in the sampled log are empty
  or whitespace-only, and the "drop empty values" rule that the link and context
  readers both apply would quietly delete the log's vertical spacing. Nothing here
  interprets a line's `type` either — the vocabulary is an open set the deployment
  owns, and filtering on it is a later slice's job.

  A page reports how far the cursor moves separately from what it could parse.
  The two are the same number on every page a real deployment has sent; they come
  apart when an item arrives with no text in it, and a reader that advanced by
  what parsed would show the following line twice — or, on a page holding one
  such item, would stop advancing altogether and poll a position the deployment
  answers instantly. That is the busy-wait the mandatory `timeout` exists to
  prevent, reached through the parser instead of through the query string.

- Seven compute endpoints declared in `contracts/viya4.yaml` — the whole
  contexts → session → job → state → log chain, each entry naming the link
  relation it is followed from rather than a path, plus the session *attach*
  endpoint, whose composed URL had been live since 2a-ii without ever being
  written down. Two scrubbed fixtures come with them, and the fixture README now
  separates, item by item, what came off the wire from what was reconstructed —
  including the one assertion a test makes on a reconstructed part, and why that
  assertion is about the parser rather than about the service.

- `src/compute/logStream.ts` — a job's log as a stream that runs while you read
  it. `streamJobLog` returns three things: an `AsyncIterable` of log events, a
  promise that settles when the job reaches a terminal state, and a `cancel`.
  The loop behind them starts on the call and keeps running whether or not
  anything ever iterates, which is the point — an `async function*` does not
  execute until it is iterated, so a caller that awaited the completion promise
  while ignoring the output would have waited forever for a job that finished on
  the server minutes earlier. Buffering what the reader has not taken yet is the
  price of keeping the two halves independent, and it is a price with a cap on
  it.

  The loop has no timer in it. The log endpoint's own `timeout` parameter is the
  clock: a page that returned lines advances the cursor and asks again
  immediately, and an empty page is the only place a decision is made. Two
  measured numbers make that decision — a live but silent job blocks for the
  whole window, while a job that has finished answers the same request in a
  quarter of a second — so an empty page that came back in under half the window
  is treated as a reason to go and read the job's state. It is only a reason to
  ask. The state resource remains the sole authority on whether the job is
  finished, and being wrong about the timing costs one extra request. Because
  that timing is one observation on one deployment, the state is also read after
  six empty windows regardless, so a deployment that behaves differently gets a
  slower stream rather than one that never ends.

  Draining after the job ends reads once more from the live cursor before
  following the collection's `next` links, because output can land between the
  last empty poll and the state read, and the line that would be lost is the
  last one. The `next` links are then followed until the relation is absent
  rather than until a page comes back short: a 21-line log read three at a time
  gave a full final page with no `next` on it, so stopping on a short page would
  stop early on precisely the log that filled its last one. That the relation
  eventually goes away is one observation of one log, so the drain also stops
  after ten thousand pages — twenty times what the buffer will hold — and reports
  a malformed response rather than presenting a truncated log as a whole one. The
  loop that never ends is the worst failure available to a module like this, and
  both of its loops now have a bound that does not depend on the deployment.

  The buffer is capped on lines **and** on characters, whichever is reached
  first, because a hundred thousand short lines and one enormous line are the
  same hazard and a single cap catches only one of them. When the cap is hit the
  oldest output is dropped, and the loss is reported twice: as a marker in the
  stream, sitting where the hole is so a reader can see which output went
  missing, and as a total on the completion promise so a caller that never
  iterates still learns the log is incomplete. Either report on its own leaves
  one of the two kinds of caller unable to tell a truncated log from a short one.

- Cancelling a job. `cancelJob` follows the job's `cancel` relation with its
  query string intact, sends no validator and reads nothing back, in the same
  one-request shape as everything else in `src/compute/`. What it promises is
  that the request was accepted — whether a long-running Python step stops
  promptly or runs to the end of the step first has not been measured, and is
  recorded as unmeasured rather than assumed.

  Cancelling a stream aborts the poll first and sends the request second, so the
  completion promise settles for the person who pressed the button rather than
  at the end of a ten-second window. The request itself goes out carrying **no
  cancellation signal at all**: sending it on the one just aborted would abort
  the very request meant to stop the job, leaving the program to run to
  completion unattended — the session's inactivity timeout is no help there,
  because a session running a job is not inactive and its clock only starts once
  the program has finished. Nothing here has a reason to abort the request that
  stops a job, so there is no replacement signal either. Cancelling a stream
  whose job has already finished sends nothing and succeeds, because the
  alternative is a request to a job whose session has since been reaped, which
  answers `404` — reporting a failure to someone for cancelling a run that was
  already over. "Already finished" starts at the job's terminal state and not at
  the settling of the completion promise, since the drain runs between the two
  and cancelling there would also abandon the tail of a log that is complete on
  the server, with nothing left to count and so no marker to leave.

  The completion promise reports every failure it is *able* to describe as a
  settled result rather than a rejection, so awaiting it never needs a `try`. Two
  things outside that are caller defects rather than conditions — a supplied
  clock that throws, and an HTTP client that rejects instead of returning a
  failure — and while neither is caught, the rejection is always handled, so a
  caller exercising its right to ignore the promise entirely cannot be killed by
  an unhandled rejection for a mistake it did not make.

  There is deliberately no way to delete a job. A `404` from a job resource is
  read as "the session is gone", and that reading is only sound while nothing in
  this extension can have deleted the job itself; the missing function is part
  of the reasoning rather than an omission, and says so where it would have been.

- Three more endpoints in `contracts/viya4.yaml` — a session's `cancel` and
  `delete`, and a job's `cancel` — which required relaxing the contract checker
  first. A relation that involves no representation has no media type, and the
  deployment says so two different ways: a session's links omit `type` entirely
  while a job's carries it as `null`. The checker demanded a string and so could
  not express either. It now accepts a media type or `null`, while still
  requiring the key to be *written*, since a forgotten media type and a
  genuinely absent one are otherwise the same absence and only one of them is
  correct.

  The same three endpoints needed the same treatment for the `Accept` header they
  send, and getting there removed three values that had been invented rather than
  observed. A `PUT` or `DELETE` link that carries no `responseType` produces a
  request with no `Accept` header at all, because the client falls back to the
  link's `type` only on a `GET`. The inventory had claimed `text/plain` for all
  three. It now says `null`, on the same media-type-or-null shape, in a file
  whose whole purpose is to record what this extension actually depends on.

- The claim that the contract checker catches an endpoint the code calls but the
  inventory omits was **wrong**, and it had reached both an architecture decision
  record and the runbook. Nothing in the checker reads the client code or looks
  at a request; it checks the contract against the dialect layer, against the
  fixture directories, and against the existence of the dialect factory it names.
  A call the inventory does not describe passes in silence — which is how a
  composed URL went undeclared for four slices. Both copies of the sentence are
  struck through and corrected in place rather than deleted, because what the
  gate does *not* check is the part worth remembering.

- The coverage ratchet rises to 92 / 92 / 91 / 95 (lines, statements, functions,
  branches) from a measured 92.25 / 92.25 / 91.41 / 95.31 over 853 tests. The
  branch floor is unchanged only because it was already at the rounded-down
  figure. A slice this size normally pulls the aggregate *down* — a thousand new
  lines land in the denominator at once — and this one moved it up because the
  new module is fully covered but for two `if (… === undefined) break` guards
  after a `shift()` on a queue already proved non-empty, which no test can reach
  and which exist because `Array.prototype.shift` types as `T | undefined`.

- A live test that runs the whole of slice 2c against a real deployment —
  resolve a context, start a session, submit a job, read its log to the end,
  delete the session — asserting that a per-run marker submitted as a `%put`
  comes back out of the log. The unit tier proves each module reads a recorded
  response correctly; this proves the responses a deployment sends are still the
  ones that were recorded.

  It is also the first test anywhere that *writes* to a live Viya, and therefore
  the first caller of the mutation gate. That gate had been unit-tested and never
  reached, which is the state in which a safety check quietly stops working. The
  suite skips itself when `PYTHON_ON_VIYA_ALLOW_MUTATION` is unset rather than
  failing — a tier that goes red for someone with read-only access is a tier that
  gets switched off — and still calls the gate at the point of the first write,
  where restructuring the hooks cannot get round it. The compute context it runs
  in defaults to the one the SAS extension ships and is overridable per machine.

  A live failure still prints its code and HTTP status and nothing else. The
  first live run of the corpus suite failed every case with a bare
  `compute-unreachable`, which reads as a deployment outage; the real cause was
  a local Node trust-store problem, and widening the failure message to carry
  `problem.detail` was tried on 2026-08-20 and rejected — that detail is
  `` `${method} ${link.href}` ``, which carries a live session id, and on a DNS
  failure it carries the deployment's hostname. `test/helpers/live-gate.ts` says
  a live failure may name the endpoint and the status code and nothing else, and
  it means it. Both suites carry a comment pointing at RUNBOOK **P33** instead,
  which names the symptom and the `NODE_OPTIONS=--use-system-ca` that fixes it.

- `src/compute/fileref.ts`, the upload half of ADR-0014's mechanism: create a
  fileref, then write its content with a fresh `If-Match` read immediately
  before every `PUT`. It composes no `infile=<fileref>;` and touches no job —
  that boundary belongs to slice 3a, on top of this module and `job.ts`.
- The submission-fidelity corpus (`test/fixtures/submission-corpus/`), the
  "Before 3a" item in `RUNBOOK.md`: fourteen hand-written Python files chosen to
  be hostile to SAS's tokeniser, plus a unit suite that drives every one through
  a real `ComputeClient` over a recording transport and compares what reaches
  that transport against a second, independent read of the fixture, and a
  live-tier suite round-tripping a curated five-file subset against a real
  Viya 4. The corpus's job changed on 2026-08-16 (findings 31–36) from choosing a
  submission mechanism to proving the chosen one — upload plus `infile=` — is
  faithful. It covers the upload path only: no tier of it runs any Python, so
  what the interpreter reads is 3a's to prove.
  `.gitattributes` marks the directory `-text` and `.editorconfig` exempts it
  from the line-ending and final-newline rules, because the repository-wide
  `text=auto eol=lf` would otherwise rewrite the CRLF fixture on the way into a
  commit and break that case on every fresh clone, CI included.
- `ComputeRequest.rawBody` on `src/compute/client.ts`, and
  `TransportRequest.body` widened to `string | Uint8Array` in
  `src/auth/transport.ts`: the one path in this codebase that sends bytes
  verbatim rather than as JSON, with `Content-Type` defaulting to
  `application/octet-stream` rather than `application/json` when a link names
  none — a default the fileref path does not reach, since finding 57 measured
  the `upload` relation advertising that type itself. `ComputeRequest.body` and
  `.rawBody` are mutually exclusive and a request carrying both is refused
  before any network call.
- Finding 57 in `PROBE-FINDINGS.md`: the media type every fileref relation
  advertises, and that a bare relative `path` resolves inside the session's own
  run directory, so a fileref is session-scoped and dies with it. Closes the two
  gaps `fileref.ts` had been citing finding 36 for.
- Findings 58–59 in `PROBE-FINDINGS.md` (slice 3a-i, docs-only): ADR-0014's two
  open hand-over questions, settled against a live Viya 4 deployment. `TIMEOUT=`
  on `PROC PYTHON` bounds only the connect handshake, not a running submit
  block, and does not exist at all on `SUBMIT` — a syntax error there, not a
  silent no-op. `SRC=` parses but is the same file-open code path `INFILE=`
  already uses, failing with an error that names `INFILE=` even when `SRC=` is
  what was written, so it is not a second inline hand-over path. Neither result
  changes anything 3a was going to build; both close open questions the 2-pre
  write-up and finding 34 had left unprobed.
- `ComputeSessionManager.startSubmission`/`endSubmission`/`isBusy` (slice
  3a-ii): a per-profile busy-submission guard, keyed like the existing session
  map. A bare start/end pair rather than a wrapping helper, since ADR-0017's
  log-streaming pump has no design yet to wrap. Now called by `ProcPythonBackend`
  (the `PROC PYTHON` backend slice, below), through a narrow `SubmissionGuard`
  port rather than the concrete manager, so `src/backend/procPython.ts` stays
  free of `vscode`.
- `test/helpers/backend-contract-suite.ts` (slice 3a-ii): the ADR-0015
  contract suite, exported as `describeExecutionBackendContract(createBackend)`
  instead of being hard-wired to `createFakeBackend()`. `test/unit/backend-
  contract.test.ts` is now nine lines registering it against the fake; 3a's
  real backend can register its own double against the same twenty-three
  cases without copying them.
- Finding 60 in `PROBE-FINDINGS.md` (probed 2026-08-21 against a live Viya 4
  deployment, before writing the module below): the session's `variables`
  relation is a real link, and a name filter on the collection returns the
  value inline, so reading `SYSCC` is one request rather than a filter-then-
  follow. `src/compute/variables.ts` reads `SYSCC`/`SYSERR`/`SYSERRORTEXT` this
  way.
- `src/backend/procPython.ts`: the `PROC PYTHON` `ExecutionBackend` — ADR-0014's
  mechanism behind ADR-0015's seam. Uploads a program to a fresh fileref per
  run (`fileref.ts`), submits `proc python infile=<fileref>;` (or, with
  `freshNamespace`, `proc python restart infile=<fileref>;`) as a job
  (`job.ts`), streams its log (`logStream.ts`) into `text/plain` output — every
  line except one typed `note` or `source`, per finding 35's "what remains is
  Python's own output plus SAS's NOTEs" — and once the job is terminal reads
  `SYSCC` to learn whether it raised, per ADR-0014 rather than the job's own
  terminal state. An unhandled exception (`SYSCC=1012`) is parsed into a raw,
  unmapped `Traceback` — outermost frame first, wrapper frames intact — because
  neither ADR-0014's own write-up nor `backend.ts`'s `TracebackFrame` doc
  assigns the mapping or the wrapper-frame drop to this slice, and they
  disagree with each other about which later one it belongs to; both readings
  agree it is not 3a's, and the disagreement is recorded in the module rather
  than resolved by guessing. `close()` cancels a run in flight, and a reset in
  flight, before disconnecting. Covered by `test/unit/proc-python-backend.test.ts`
  against a fake `ComputeClient`, and by a second run of the ADR-0015 contract
  suite over `test/helpers/recorded-proc-python.ts`, a double that drives this
  same real backend through a simulated wire. One assertion in
  `backend-contract-suite.ts` changed to make that second run possible: it
  compared an emitted output's `data` byte-for-byte, which does not hold for a
  backend whose transport is a SAS log and therefore appends a trailing
  newline per forwarded line, the same as a real `print()` call's output would
  read back as. `contracts/viya4.yaml` gained the `variables_get` entry finding
  60 established.
- An adversarial review of the `PROC PYTHON` backend (above) before it was
  proposed for merge found one blocking defect and two worth fixing, all now
  fixed. **Blocking:** `cancel()` delegated entirely to `LogStream.cancel()`
  once a job existed, which `logStream.ts` documents as a no-op once the job
  is observed terminal — a state reached before the trailing log drain and
  well before `SYSCC` is read — so a cancel arriving in that window did
  nothing and `done` went on to resolve with a real outcome instead of
  ADR-0015's required `cancelled` failure. `cancelActive` now aborts the
  run's own controller unconditionally, which reaches both `readVariable`
  calls that follow, and one further check closes the sliver of the window
  still open after a `SYSCC` read has already succeeded. **Worth fixing:**
  `close()` could not stop an in-flight `reset()` — it has no
  `ExecutionHandle` and no entry in `this.active`, so `close()`'s own
  "cancels whatever is in flight" contract silently did not reach it;
  `reset()` now carries its own `AbortController` that `close()` also aborts.
  Also worth fixing and **deliberately not closed in this slice**: if
  `cancel()` arrives while `createJob`'s `POST` is in flight and the
  deployment has already created the job before the client gives up waiting
  on the response, the abandoned job keeps running against the shared
  Compute session — and since `SYSCC` is live, mutated session state
  (finding 37/60), a later run in the same session risks its own `SYSCC`
  being read at an unlucky moment. Closing this needs `job.ts` to hand back
  an id even on a client-side abort, which is a change below this slice's
  layer; it is recorded here rather than silently accepted.
- A second automated-review round on the `PROC PYTHON` backend (above) found
  one more real correctness gap and five test-coverage gaps, all now closed.
  **Fixed:** the `isCurrentRunAborted()` check that closes the cancel-race
  window was present after the `SYSCC` read but not repeated after the
  `SYSERRORTEXT` read that follows it on a failing run — an asymmetry between
  the two reads that let a cancel arriving during the second one fall through
  to a genuine outcome instead of ADR-0015's required `cancelled` failure.
  **New test coverage, no behaviour change:** a session carrying no `SYSCC`
  variable (the `backend-failed` branch `readVariable`'s own "every session is
  expected to have one" contract can still be wrong about); `parseTraceback`'s
  two `undefined`-return paths (no traceback header at all, and a header with
  no frame lines following it), both of which fall back to a plain-message
  diagnostic; the fixture in `test/unit/proc-python-backend.test.ts` gaining a
  `racingGuard()` double alongside the existing `guard()`, since the latter
  backs `isBusy()` and `startSubmission()` with one boolean and so cannot
  represent the genuine cross-window race the module's own doc comment
  describes — `execute()` and `reset()` are now both exercised against it;
  and `writeFilerefContent`'s two failure paths (the `self` ETag re-read, the
  `upload` PUT) plus a `compute-unreachable` submission failure, none of which
  had a test distinct from the `assign`/`session-gone` cases already covered.
  **Deliberately not closed in this slice:** `close()`'s own cancellation of
  an in-flight run discards whatever `cancelActive` reports rather than
  logging it, because this module must never import `vscode` and so has no
  output channel to write to, and `close()`'s ADR-0015 contract returns
  nothing for a caller to inspect either. A failure to cancel here is
  therefore invisible by construction at this layer, the same shape as the
  `createJob`-abort-race gap above; closing it would mean handing `close()` an
  injectable log sink this backend does not have today, or having
  `ComputeSessionManager` inspect a call it cannot observe. Recorded here
  rather than silently accepted.
- `src/backend/logFilter.ts` — the log filter, Phase 3b. `job.ts`'s own doc
  comment on `LogLine.type` already said "interpreting a type is 3b's filter,"
  and it shipped once before this, inline inside `procPython.ts`, because 3a
  could not produce any visible output at all without deciding *something*
  about which log lines were noise. This slice gives that decision its
  dedicated, fixture-tested home: `isNoiseLine` (only `note` and `source` are
  excluded; `source` should not occur at all through the `infile=` path, and is
  kept out defensively rather than because a real run is expected to produce
  one), `logLineOutput`, and `droppedLinesOutput`, all pure and switching on a
  line's `type` rather than scanning its text. `procPython.ts` now calls into
  this module instead of carrying its own copy, and its own doc comment is
  updated to say so. Covered by `test/unit/backend-log-filter.test.ts`,
  including finding 52's 21-line recorded log verbatim — the real example a
  future change to this filter should keep passing — and a case mirroring a
  predicted-but-unmeasured real 3a log (no `source` lines at all, per finding
  35).

  The plan originally described this slice as stripping "page-break headers,
  `>>>` markers, and procedure NOTEs," which was the shape of the problem
  before 2c-pre measured the log at all. Neither concern survives contact with
  what that probe found: the log arrives as a collection of already-typed
  lines rather than text a client has to parse, and a type switch cannot be
  split mid-line the way raw paginated text could be, so "a page break splits
  the stdout region mid-stream" — the awkward case the original text
  named — cannot happen to it. **Correction (2026-08-25, 3c's probe):** a
  page-break banner has since been observed on the wire — it arrives typed
  `title`, not the `note` this entry originally guessed, and `isNoiseLine`
  does not exclude it, so it currently passes through as visible output.
  Recorded as an open item in `docs/phases/phase-3.md` rather than fixed here.
  Separately, `PAGESIZE=MAX` (named under 3a in `docs/phases/phase-3.md`) is
  not currently sent at session creation — `sessionManager.ts`'s `open()`
  calls `createSession` with no `options` — a real gap, recorded here rather
  than folded into this slice silently, since fixing it is a one-line change
  to a different module and does not change this filter's design either way:
  a banner still arrives as its own atomic, already-typed log item, and this
  filter already drops or passes a whole line at a time regardless of which
  type it carries.

  **`npm run verify` is green** — 979 passing, coverage
  93.05/95.1/92.48/93.05 (statements/branches/functions/lines), against the
  93/95/92/93 floor — ratchet raised from 92/95/91/92, since three of the four
  measured values' integer truncations moved past the existing floor
  (branches alone stayed at 95). Both AI reviewers approved. Codex's one
  finding — the dropped-lines marker bypasses `l10n.t()` — is real but its
  suggested fix is not (`procPython.ts` cannot import `vscode` any more than
  this module can) and the underlying gap already exists, unflagged, in
  merged 3a code; recorded rather than patched, in `src/backend/backend.ts`'s
  `RichOutput` doc comment and in this item's own "Open item" note above.
- Matplotlib/pandas rich output (slice 3c-i). A matplotlib figure or a pandas
  DataFrame's HTML repr is captured by diffing the session's working
  directory before and after a run
  ([ADR-0019](docs/adr/0019-rich-output-is-captured-by-diffing-the-working-directory.md):
  a passive diff, not a helper library the user's script would have to
  import), filtering to a closed `.png`/`.html` whitelist, decoding into the
  existing `RichOutput` union, and deleting each captured file afterward.
  New: `src/compute/files.ts` (`getFiles`/`getDirectoryMembers`/`getFile`/
  `deleteFile`, finding 68's confirmed relation names) and
  `src/backend/richOutput.ts` (pure diff/filter/order/cap/decode logic, no
  I/O, fixture-tested independent of a real Compute client). A prerequisite
  surfaced while implementing this: the transport layer (`auth/transport.ts`,
  `src/compute/client.ts`) had no way to carry a binary response body
  byte-for-byte, or above a 1 MiB cap (finding 69) — both gained optional,
  additive capabilities (`TransportResponse.bytes()`,
  `ComputeRequest.maxBodyBytes`, `ComputeResponse.rawBody`), with no change to
  any existing caller's behaviour. Verified live against a Viya 4 deployment:
  9/9 `test/live` passing, including the new rich-output capture test.
  Reviewed by two adversarial subagent passes over the finished diff, in
  addition to the CI reviewers. *(Entry added retroactively — the PR that
  shipped this, #59, merged without one, a gap CONTRIBUTING.md's "every pull
  request updates `CHANGELOG.md`" rule should have caught at the time; see
  the matching note on the `### Fixed` entry below.)*
- **Test-infrastructure only, no behaviour change (Phase 4's 4a slice).**
  `test/integration/run/commands-backend.test.ts` covers three
  `src/run/commands.ts` paths that only exist once a real backend is running
  against a session, and that `commands.test.ts`'s own guard suite cannot
  reach (`sessionsThatMustNotConnect()` throws before `backendFor()` ever
  calls `connect()`): `backendFor()`'s reconnect-orphan `close()` (a
  still-busy cached backend closed before being overwritten, when a new
  `ComputeConnection` arrives for the same profile), `cancelRun`'s
  `currentReset` fallback (interrupting an in-flight `reset()` via `close()`,
  since a reset produces no `ExecutionHandle`), and the `backend.busy`
  serialisation guard in `runNow`/`resetPythonState` (stopping a second
  invocation's own `finally` from clobbering `currentRun`/`currentReset` while
  the first is still running) — the gap Claude Bot's review on PR #63 named,
  and `phase-3.md`'s own 3d-i Runbook entry named before that review. New
  `test/helpers/recorded-connection.ts` builds a real `ComputeConnection`
  over `recorded-proc-python.ts`'s same simulated wire, so `backendFor()`'s
  real, hardcoded `new ProcPythonBackend(...)` construction
  (`commands.ts:326` — there is no injectable backend factory) runs against
  it rather than being bypassed. That wire gained two small, backward-
  compatible additions for this: `SimulatedJob.nextPage` now resolves an
  in-flight poll early when the request's `AbortSignal` fires (so a
  `close()`-driven cancellation is actually observable, rather than hanging
  forever against a wire that used to ignore signals entirely), and
  `buildClient`'s new `autoFinishReset` option (default `true`, unchanged for
  every existing caller) lets a test hold a reset open long enough for Cancel
  to interrupt it.
- **A `ModuleNotFoundError` now points at `Show Environment`.** Phase 4c,
  the ask `phase-3.md`'s 3e entry left for this phase: an unhandled Python
  exception whose message starts `ModuleNotFoundError:` now gets one
  sentence appended — `Run "Python on Viya: Show Environment" to see what
  is installed on this connection.` — pointing at 3e's own cached
  installed-package list rather than leaving the user to guess whether a
  missing import is a typo or a genuinely absent package. Only the
  diagnostic message carries the addition; the structured traceback the
  result panel will eventually consume keeps the exception's own text
  unmodified. Also new, greenfield groundwork for 4d rather than anything
  user-visible yet: `src/backend/tracebackDiagnostics.ts`'s
  `mapFrameToOrigin`/`primaryFrame`/`primaryPosition`, mapping a `<string>`
  traceback frame back to a zero-based editor position through
  `ProgramOrigin.lineOffset` (ADR-0014's identity mapping — a `<string>`
  frame's own line number needs no adjustment beyond the offset a Run
  Selection call already carries).
- **A failed Python run now lands in the Problems panel, and its traceback
  frames jump to the editor.** Phase 4d wires 4c's mapping to its two
  consumers. A run that raises publishes one `Diagnostic`
  (`languages.createDiagnosticCollection("pythonOnViya")`) at the innermost
  frame in the user's own file — `severity: Error`, `source: "Python on
  Viya"`, the rest of the `<string>` call stack as `relatedInformation` —
  cleared at the start of every run. Nothing is published when no frame maps
  into the file (a SAS-side error, an all-library stack): a diagnostic
  planted at line 0 would point at code that is not the problem, and the
  output channel and result panel already carry the message. In the result
  panel, a traceback frame from the user's file (`<string>`) is now a
  keyboard-reachable button — activating it reveals that line in the editor,
  resolved host-side through the same 4c mapping via a new `revealFrame`
  message on ADR-0021's existing protocol. No new command, setting, webview
  surface or CSP change. `src/run/diagnostics.ts` is new; `resultPanelModel.ts`
  / `resultPanelDom.ts` / `resultPanel.ts` / `webview/entry.ts` /
  `commands.ts` gained the wiring.
- **A deployment behind a private certificate authority, or one that serves an
  incomplete chain, can now be reached** by setting
  `pythonOnViya.userProvidedCertificates` to the PEM file paths for the missing
  authority (slice 5d-i, the deferred 1c-ii;
  [ADR-0008](docs/adr/0008-auth-core-transport-and-security-deltas.md)'s
  2026-09-02 amendment). The certificates are added to a dedicated
  `https.Agent` used only by this extension's own requests — never
  `https.globalAgent`, which is shared with every other installed extension —
  and that agent is threaded through both the sign-in path and the compute
  session path. The setting is `machine`-scoped so a checked-in workspace
  settings file cannot widen TLS trust, read once at window load (a change
  applies on reload), and an unreadable path is reported in the **Python on
  Viya** log while the rest are still used. Once set, the list replaces the
  operating-system certificate store for the extension's Viya requests, so it
  must name every authority the chain needs. The raw setting value is validated
  before use, so a mistyped `machine`-scoped entry cannot fail activation.
  `src/auth/caAgent.ts` is new; `src/auth/transport.ts` gained
  `createNodeHttpTransport({ agent })` with `nodeHttpTransport` unchanged as its
  zero-config form. Not yet exercised against a real private-CA deployment — the
  manual-test row for it is pending.
- **Test-only, no behaviour change (Phase 5's 5d-ii slice).** The
  submission-fidelity corpus gains a fifteenth case,
  `test/fixtures/submission-corpus/utf8-bom.py` — three `EF BB BF` bytes ahead
  of an ASCII `print()` — so the upload path is now pinned against a file that
  opens with a UTF-8 byte-order mark. `test/unit/submission-corpus.test.ts`
  asserts the leading bytes and drives the case through the recording transport
  with the other fourteen; a live probe (Finding 77, `docs/phases/phase-5.md`)
  had already confirmed `proc python infile=` runs a BOM-prefixed upload
  cleanly, so this fixture keeps that true rather than re-opening it.
  `.editorconfig` unsets `charset` for the corpus directory so an editor
  honouring the repo-wide `charset = utf-8` ("no BOM", per the EditorConfig
  spec) cannot strip the mark on save — the same class of guard `.gitattributes`
  `-text` already provides.

### Fixed

- Three regressions found by the first full run of the manual test pass
  (2026-08-27), all closed in the same slice (Phase 3's 3f). **Signing out,
  an idle session reap, or a window reload could all leave the `Connect to
  SAS Viya` command hidden indefinitely** — `pythonOnViya.connected` was
  computed from an in-memory cache that only ever cleared on an explicit
  `Disconnect`, so a session that died on its own terms (or a sign-out that
  never told the cache) left the palette showing `Disconnect` for a
  connection that no longer worked, with no way back to `Connect` short of
  running `Disconnect` first. Signing out now ends the session — before the
  credential is dropped, so the teardown request still has a token — and
  re-syncs the context key the same way `Connect`/`Disconnect` already do,
  whether the sign-out came from the palette's `Sign Out` or from VS Code's
  Accounts menu; and a run/reset/probe that discovers its session is
  actually gone now tells the session manager to drop it immediately.
  **Most failures at the run/reset
  seam were reported with nothing written to the log**, despite every one of
  their messages ending "See the Python on Viya log for details" — three
  call sites in `runFile`/`runSelection`/`Reset Python State` never logged
  the underlying detail before showing that sentence. Separately, and worse:
  a session that had already died reported its very first request of a run
  (uploading the program) as a generic transfer failure rather than "The SAS
  Viya session ended. Connect again and re-run.", because that
  classification was never checked during the upload stage. Both fixed
  together, so a dead session is now both loggable and correctly named.
  **The page-break banner ("The SAS System …") could bleed into a run's
  output** — roughly once every 58 lines in a large run, and intermittently
  in ordinary ones — because the log filter never excluded the banner's own
  line type, and the session never asked the deployment to suppress page
  breaks in the first place. Both are fixed now.
- **The first program you run after reloading the window no longer fails
  with a stale-fileref collision.** A reload builds a fresh backend, whose
  per-run fileref counter (`PY000001`, `PY000002`, …) restarts at zero,
  against a compute session it re-attaches to
  ([ADR-0012](docs/adr/0012-compute-session-lifetime-and-storage.md)) that
  still holds the names the pre-reload backend assigned — so `assign`
  answered HTTP 400 ("the fileref … already exists") on every submission
  for the 60–90 seconds it took repeated attempts to walk the counter past
  them (Finding 72, surfaced by the 2026-08-30 re-run of the manual test
  pass against the 3f build). The backend now reads the session's fileref
  collection once on the first run after connecting and starts the counter
  past whatever is already there; a bounded retry under the next name
  covers the remaining case of two windows sharing one session and
  counting independently.
- Sign-in against a default Viya 4 deployment now works at all. The built-in
  `vscode` OAuth client registers exactly one redirect value —
  `urn:ietf:wg:oauth:2.0:oob`, "show the user a code" — and no custom-scheme URI,
  so sending it any `redirect_uri` failed *after* the user had typed their
  password. Confirmed against a live deployment, which rejected this extension's
  callback address and the SAS extension's own alike. The callback URI is now
  sent only when the profile names a client, which is the only case where an
  address could have been registered for it; RFC 6749 §4.1.3 requires the
  authorize and token legs to agree, so the decision is made once, where both
  read it. The paste box is consequently the ordinary route on a stock
  deployment rather than the fallback, and `docs/signing-in.md` now says so.
- The callback address no longer reaches the deployment double-encoded.
  `asExternalUri` appends a `windowId` parameter, and the URI arrived at SASLogon
  as `…/auth-callback%3FwindowId=2` — the `?` escaped while the `=` beside it was
  not. It is now rebuilt from the parsed URI's components, so the encoding
  happens exactly once, where the authorize URL is built.
- Neither the PKCE code verifier nor a refresh token can reach the log. SASLogon
  echoes the field it objected to back inside `error_description`, and that field
  is quoted verbatim into the output channel — deliberately, because it is the
  most useful diagnostic in the flow and people paste the log into issues. Rather
  than drop the field and trade one leak for permanent blindness, the credentials
  that were just sent are scrubbed out of the server's text. The scrub happens
  where the form is posted, so it covers both grants from one place: the
  authorization-code exchange, where the verifier leaked live, and the refresh
  exchange, which matters more because it runs unattended and a refresh token
  *is* the session. Everything a caller could have sent is scrubbed except
  `client_id`, `grant_type` and `redirect_uri`, which are not secret and which
  carry the diagnosis — "invalid redirect …" is the message that identified the
  `oob` problem above, and a scrub that ate it would have hidden it. A value
  under eight characters is left alone, because substitution can only hide
  something distinctive: scrubbing a one-character secret replaces that letter
  everywhere it occurs, wrecking the sentence while a reader recovers the
  character from the words either side.
- A deployment that cannot be reached while the extension asks who signed in is
  no longer reported as a token problem. The identity call's transport failure
  said `token-endpoint-unreachable`, which names the wrong host and sends the
  reader to the wrong side of the deployment; it now returns an identity failure
  carrying the path and the underlying reason.
- Signing in again now asks Viya who signed in, instead of reusing the answer it
  already had. The identity of a held session is cached so that renewing a token
  costs no extra round trip, but a fresh sign-in is exactly the moment the user
  could have chosen a different account — reusing the cache there would have
  labelled the new session with the previous user's name. The cache is now
  reached only on the renewal path.
- Response headers are collected into a null-prototype map before they become an
  object, so a header named `__proto__` or `constructor` cannot reach an object
  literal's prototype (CodeQL: remote property injection).
- Reloading the window no longer signs you out. The extension declared no
  activation events, on the correct reasoning that a contributed command
  activates its extension implicitly and an `onCommand` entry is redundant from
  VS Code 1.74 on — but a reloaded window runs no command. Nothing woke the
  extension, so the authentication provider was never registered, VS Code had
  nobody to ask for sessions, and the Accounts menu came back empty while the
  refresh token sat in the keychain untouched. `onStartupFinished` is now
  declared: it fires after the window is up, and activation still reads no
  secret and makes no request.
- A background failure to read who is signed in no longer interrupts you with a
  dialog. Renewing an expired token happens because a menu was opened or a token
  aged out — nobody asked — and a modal there talks over whatever the user was
  actually doing. Both paths now log and nothing more, at warning for a renewal
  and at error for a sign-in; the sign-in path was showing the message twice
  anyway, because a failed `createSession` already rejects with its own and VS
  Code shows that to whoever asked.
- Workspace trust is now enforced, not just declared. ADR-0002 has said since
  slice 0b that connecting requires a trusted folder, and `docs/signing-in.md`
  said so to users, but nothing checked: a folder cloned this morning could
  supply the endpoint a token was requested from and sent to. All three
  authentication entry points now check `vscode.workspace.isTrusted` —
  `getSessions` serves nothing and publishes `pythonOnViya.authorized` as false,
  `createSession` and `removeSession` reject with a message naming **Workspaces:
  Manage Workspace Trust** — and the two sign-in commands carry
  `isWorkspaceTrusted` in their enablement so the palette stops offering what the
  provider will refuse. Nothing is signed out and nothing is deleted; trusting
  the folder restores the session through `onDidGrantWorkspaceTrust`, without a
  reload.
- A sign-out that fails now says so. The command caught everything the provider
  could throw and reported all of it as "You are not signed in" — which described
  the one case it was written for and misdescribed every other, including the
  workspace-trust refusal added above and a secret store that would not delete.
  The user was told the credential was gone in the reassuring voice, while it was
  still on disk. An id the provider does not recognise is now a distinct error
  type rather than a sentence to match on, which a translated build would not
  have matched at all; only that case is treated as ordinary, and everything else
  reaches the log and a message.
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
- A profile whose OAuth client is registered without a secret is no longer asked
  for one at every sign-in. An empty answer is now recorded rather than dropped,
  which needs three states — the secret, "this client has none", and "nobody has
  said yet" — because only the last is a reason to prompt. The record is *not* an
  empty string in `SecretStorage`, which is the obvious fix and does not work:
  VS Code encrypts a secret on write and discards it on read when the **stored**
  value is falsy, so with an OS keyring an empty secret survives as ciphertext,
  and without one — a Linux container, a remote/SSH host, CI — the fallback
  backend "encrypts" with the identity function and reads `""` back as
  `undefined`. So the claim is kept in `globalState`, where a fact about
  configuration belongs, and the secret store holds only secrets.
- One unreachable deployment no longer stalls the Accounts menu, or anything
  else that asks who is signed in. Profiles were renewed one after another, so a
  test Viya that was switched off held every account behind it for up to
  forty-five seconds — the token request's thirty plus the identity request's
  fifteen — and the editor polls that menu, so the stall repeated. Profiles are
  now renewed concurrently, in the order they were given so the menu does not
  reorder itself by network weather, and each answer is bounded at ten seconds.
  The bound is on the *answer*, not on the work: the slow renewal keeps running,
  and when it lands it is kept, so the next caller is served from memory rather
  than starting again. That, in turn, is why a renewal already in flight is now
  shared instead of restarted — without it, polling a dead host would open a
  fresh socket every few seconds and never close one.
- A caller that names an account is no longer bounded. Connecting asks for one
  particular account, and it would rather wait than be told there is no session
  when there is; a menu poll names nothing and takes the ten seconds. The
  distinction falls out of the `getSessions` signature, so it needed no new
  plumbing. Not yet solved: a connect that has no account to name — two profiles
  pointing at one deployment — is still bounded like a poll.
- One unreadable keychain entry no longer empties the Accounts menu. A rejected
  renewal took the whole list down with it, so a single corrupt stored secret
  hid every other signed-in account; each profile's failure is now confined to
  that profile and written to the log at warning level.
- Closing the browser without signing in is now treated as an answer rather than
  a fault. It used to end in an error dialog saying the sign-in did not complete,
  which told the user that the thing they had just chosen to do had gone wrong;
  now it shows nothing, on the command and on the connect alike, and only the log
  records it. Dismissing the client-secret prompt counts the same way, which it
  did not before — that prompt appears before the browser opens, so the sign-in
  flow could not see it. Everything that is not a cancellation is still reported
  exactly as loudly as it was.
- A session that is not restored now says why. Finding nothing stored for a
  profile used to be completely silent, which is right when nobody has signed in
  — the Accounts menu asks constantly, and that answer goes to the log at debug —
  but wrong when a session that was working has just ended. A deployment
  configured to issue no refresh token can only keep you signed in for as long as
  the access token lasts, and the account leaving the menu on its own looked
  exactly like a fault; it is now stated once, at information level, naming the
  deployment. Neither line quotes a token or a correlation id.
- Connecting after switching profile no longer signs you in to the deployment you
  switched *away* from. Found by hand against two live deployments. Asking the
  editor for a session without naming an account does not leave the choice open:
  VS Code fills in the account it remembered from the last interactive sign-in
  and passes that to the provider, which honours a named account above the active
  profile — deliberately, because that is how the Accounts menu's *sign in again*
  row has to behave. The two rules are each correct and together they sent the
  browser to the wrong SASLogon. The request now clears that remembered account,
  so a deployment nobody has signed in to yet is decided by the active profile and
  nothing else. Only the interactive request clears it: a request that already
  names an account never consulted the preference, and the Accounts menu's poll
  must not write anything at all.

  The mapping from "which kind of session do we want" to the options the editor
  actually receives now lives in a module of its own, `src/auth/sessionRequest.ts`,
  and is unit-tested. It was previously inline, one frame *below* the seam the
  tests inject at, which is why a green suite had nothing to say about a wrong
  deployment: every test could see which request was chosen and none could see
  what it turned into.
- The weekly external link sweep no longer reports the Visual Studio Marketplace
  as broken. `scripts/check-links.mjs` asks with `HEAD` first and falls back to
  `GET` only for the statuses a server plausibly returns because it dislikes the
  method; `404` was not among them. The Marketplace answers `404` to a `HEAD` of
  an extension page it serves `200` for on `GET` — measured 2026-08-18 against
  the SAS extension's own listing, which `docs/connection-profiles.md` links to.
  `404` now joins that list. The verdict on a genuinely missing page does not
  change, because it is the second answer that is returned: a URL that is `404`
  to both methods is still reported `404`, at the cost of one extra request.
- The live tier now passes against a real Viya 4, having never been run before
  2026-08-19. Its one test asked `/identities/users/@currentUser` for
  `application/vnd.sas.identity+json` — the media type this project had already
  measured as a **406** (finding 6), and which `src/auth/identity.ts` names as
  the guess to avoid. It now imports `CURRENT_USER_PATH` and
  `IDENTITY_SUMMARY_TYPE` from the module under test rather than restating
  either, so the strings cannot drift apart again. Nothing in the unit or
  integration tiers could have caught this: a live test is only wrong against a
  live deployment.
- `docs/dev/testing.md` now says what to do when the live tier fails on the TLS
  handshake rather than on the request. A deployment behind an internal
  certificate authority produces `unable to verify the first certificate`,
  because the tier runs under bare `node`, which carries its own CA store —
  unlike the extension, whose requests VS Code routes through the operating
  system's certificates by default.
- A missing link relation no longer blames the deployment. Connecting to a
  compute context that offered no `createSession` link reported "This SAS Viya
  deployment does not offer that operation here", which sends the reader to an
  administrator to ask about a capability that is probably present. Findings 54
  and 55, probed 2026-08-19, measured why that is the wrong reading: the item the
  picker reads is the *summary* representation, and the resource it points at
  carries three relations the summary never does — so an absent relation
  describes the response one account received, not the deployment. The
  notification now offers both readings, permission first; the log line says what
  was seen rather than what it implies; and the comments in `contexts.ts` that
  asserted the old inference are corrected. `docs/connecting.md` no longer
  records the behaviour as unexplained.

  The first pass of that sweep reached `describeComputeProblem` and stopped
  there, leaving the same superseded claim in the four failure `reason` strings
  that `contexts.ts`, `session.ts` and `job.ts` compose alongside it — including
  one directly beneath a comment stating it had been corrected. All four now read
  "carried no `…` link in the response this account read". `docs/connecting.md`
  had also quoted the old wording as though it were the message a user sees, and
  attributed the missing link to permission "most often", which is a frequency
  the finding cannot support: with one identity available, "summaries omit
  administrative relations" and "the link set is computed per caller" are not
  separable, and both forbid the same inference. The page now quotes the message
  the extension actually shows and gives both readings without ranking them.

- The live tier's second gate no longer confuses "half-configured" with "not
  configured" (slice 3a-ii). `test/helpers/live-gate.ts`'s `liveTarget` used to
  return `undefined` — a silent skip, exit 0 — whenever exactly one of a
  generation's URL/token pair was set, the same as when neither was. Found by
  accident during RUNBOOK P40 on 2026-08-19, on a tier whose whole reason to
  exist is that it talks to a real deployment. It now throws, naming which
  variable is present and which is missing, and only returns `undefined` when
  neither is set at all.
- `test/live/viya4-connectivity.test.ts` no longer hand-rolls its own request
  with a bare `fetch` call (slice 3a-ii). It now calls `fetchCurrentUser` —
  `src/auth/identity.ts`'s actual production function for asking the
  deployment who the token belongs to — which gets the summary/full
  media-type fallback finding 6 measured for free, rather than re-deriving it
  by hand. `ComputeClient` was considered and does not fit: the identities
  service is not `/compute/...`, and `ComputeClient.send` only follows a
  `Link` under ADR-0010.
- `proc python infile=<fileref>;` submitted alone, with no trailing `run;`,
  never closed its SAS step (finding 70, an ADR-0014 amendment). A fresh
  session's first job could report `completed` in under a second — far
  faster than a real matplotlib import — while its log, `SYSCC`, and any
  file it wrote all stayed unflushed for 60+ seconds, until an unrelated
  second job forced the step closed. This affected **every**
  `execute()`/`reset()` call, not only the rich-output capture slice (3c-i)
  that found it, and had gone undetected since 3a because no live test
  before that slice ever submitted `infile=` end to end against a real
  deployment and checked a session's *first* job. Fixed by appending
  `"run;"` as a second statement in both `runProgram`'s and `reset()`'s
  `createJob` calls; `logFilter.ts` needed no change, since `run;`'s own echo
  is `source`-typed and already excluded by `isNoiseLine`. Confirmed live,
  twice: once via a hand-rolled job sequence, once by driving the real
  `ProcPythonBackend` class end to end. *(Entry added retroactively,
  alongside the `### Added` entry above — see its note for why.)*
- A Python exception's structured traceback no longer includes `PROC PYTHON`'s
  own harness frames (slice 3c-ii, finding 39). Since 3a, `parseTraceback`
  read every frame the runtime printed unfiltered, including the two frames
  the harness wraps around the user's code, both labelled `File "<stdin>",
  line N, in <module>` — every traceback the result panel will eventually
  render pointed at two extra frames the user never wrote. `parseTraceback`
  now drops the **leading contiguous run** of `<stdin>`-labelled frames only,
  stopping at the first frame that is not one: a first version dropped every
  frame with that label wherever it appeared, which an automated PR review
  caught as wrong — user code that itself calls
  `compile(src, "<stdin>", "exec")` can legitimately raise from a frame
  labelled `<stdin>` too, and such a frame can only ever sit below a real
  frame, never at the very top. `src/backend/backend.ts`'s
  `TracebackFrame.file` doc is corrected to match: wrapper-frame dropping is
  done here, and mapping a frame's line number to an editor position is
  Phase 4's job, not this slice's.
- **Cancel now actually sends a validator the deployment requires, and a
  failure to reach the server is no longer silently discarded** (Phase 4b's
  Findings 75/76, fixed in 4c). `cancelJob()` used to send a job's `PUT
  …/state?value=canceled` with no `If-Match` at all, on the strength of a
  comment claiming none was needed — measured wrong against a live Viya 4
  deployment: every such request answered `428 Precondition Required`, and
  `cancelRun()` awaited the failure without ever inspecting it, so a user
  who pressed Cancel saw "Cancelled." regardless of whether Viya was ever
  actually asked to stop anything. `cancelJob` now reads a fresh `ETag` off
  the job's own `self` relation immediately before the `PUT` — the create
  response's own `ETag` is already stale a second later — and `cancelRun`
  now logs and reports a failure here instead of discarding it. Separately,
  live probing also found that even an *accepted* cancel does not preempt a
  Python statement already running — a 60-second loop cancelled ~6s in
  still ran its full 60.01s before SAS tore the interpreter down — so the
  "Cancelled." message is reworded to say only what is true
  unconditionally, rather than implying an immediate stop it cannot promise.

### Changed

- The copyright check now scans `contracts/`, and its header extractor
  understands `#` comments alongside `//`. YAML has no other comment form, so a
  header there is a run of `#` lines ended by the first key — the same shape as
  everywhere else, in different punctuation. `.vscodeignore` gains `contracts/**`
  in the same change: it is allow-by-default, so a new top-level directory ships
  inside the VSIX unless it is named. Both gaps were recorded in advance in
  `RUNBOOK.md` as things this slice would inherit, and both are closed here
  rather than carried forward.

- The coverage ratchet rises to 91 / 91 / 90 / 95 (lines, statements, functions,
  branches). The branch figure moved twice: the new gate script pushed it *down*
  first, because its defensive arms — the ones that fire on a malformed contract
  rather than an incorrect one — had no cases. Those are now stated as tests, on
  the grounds that a gate whose failure mode is a stack trace three frames in
  gets read as a broken gate.

- The coverage rule gains a second way to be unreachable, and ADR-0009 is
  amended rather than worked around. A file of nothing but types compiles to an
  empty JavaScript file, so no test can execute a line of it — while c8 charges
  its whole source, doc comments and all, to the denominator. `backend.ts` is the
  first such module here and cost three points of aggregate coverage for a file
  the contract tests specify completely. The rule is now *excluded if and only if
  the unit tier cannot reach it*, and the check enforces the new arm in both
  directions: a file qualifies only while **every** top-level statement in it is
  erased at compile time, so the day one grows a helper it returns to the
  denominator and `verify` says so by name. The alternative — inventing a runtime
  export so that something could be executed — would have added code nobody asked
  for to satisfy an instrument.

- `vite` is pinned to `^6.4.3` through an `overrides` block, which clears four of
  the seven dev-tree advisories the audit gate was allow-listing — three in
  `vite` itself, including a high-severity Windows `server.fs.deny` bypass, and
  one in the `esbuild` nested underneath it. Those four entries are deleted from
  `scripts/advisory-allowlist.json` rather than left to expire, because an entry
  matching no current advisory fails the gate too. They had been recorded as
  unfixable, which was wrong: the fix was to override the child rather than move
  the parent, and only the parent had been checked. `vitepress@1.6.4` declares
  `vite ^5.4.14`, so the pin overrules it deliberately; `npm run docs:build` is
  the evidence it holds. Three advisories remain, all reached only through
  `mocha`, which has no fixed release.

- The authentication provider's label goes through `vscode.l10n.t()` like every
  other string the editor shows. It is a product name and will usually come back
  unchanged, but the manifest already contributes it as `%authentication.label%`,
  and a locale that transliterates it needs somewhere to say so — a bare literal
  in the source is the one place a translator cannot reach. It is resolved when
  the provider is registered rather than when the module loads, because a
  module-level call would freeze the English string before the language bundle
  is available.

- The coverage ratchet is measured over **unit-reachable code**. Modules that
  import `vscode` are excluded from the c8 denominator: they cannot be loaded
  outside an extension host, so they score zero however well the integration
  tier tests them, and leaving them in meant a slice that added shell code
  pushed the aggregate down while increasing the amount of tested code — forcing
  the ratchet to be lowered. Thresholds are re-baselined against the new
  population, which is smaller and higher. The guarantee that shell code is
  tested moves to a process gate: a slice that adds a shell module adds an
  integration test for it, because no threshold will now notice if it doesn't.
  [ADR-0009](docs/adr/0009-coverage-scope.md) records the alternatives, including
  merging integration coverage in, and why they were rejected for now.
- CI classifies each pull request before running it. A change that touches only
  `docs/` or a top-level markdown file now runs the `docs` job alone —
  `verify`, `test`, `package` and `supply-chain` are skipped — while any change
  outside those paths, and every push to `main`, still runs everything. The
  secret scan now also runs as a step in `docs` — it remains part of the
  `verify` chain — so it still covers documentation-only changes.
- **Relicensed from MIT to Apache-2.0** to match the upstream
  `sassoftware/vscode-sas-extension` code this project derives from, and to give
  users an explicit patent grant. See `docs/adr/0000-repository-licence.md`.
- The supported Node floor is **22.18.0**, raised from 20.19.0, and it is now
  derived from `engines.vscode` rather than chosen: 22.18.0 is the Node that VS
  Code 1.104 embeds in its extension host, and 1.104 is already the floor
  `engines.vscode` claims. The old number described a runtime the extension
  cannot be loaded on, and Node 20 reached end of life on 2026-04-30. The `test`
  matrix legs change from 20.19.0 and 22 to **22.18.0 and 24** — the floor, and
  the current Active LTS as a forward-break detector, replacing a bare `22` leg
  that matched `.nvmrc` and that after the raise differs from the floor only at
  patch level. `esbuild.mjs` targets `node22`.
  `.nvmrc` is unchanged at an unpinned `22` and remains the reason the
  `supply-chain` job can install npm 12. That job's design is unaffected: 22.18.0
  is still below npm 12's own `^22.22.2` floor, so the install-script policy
  still runs in exactly one pinned job.
  [ADR-0018](docs/adr/0018-the-node-baseline.md).
- `@types/node` moves from **26.2.0 to 22.18.13**, and is held there by a
  Dependabot `ignore` entry. It had been typing the project against a Node four
  majors above the one the extension host runs, which means `tsc` was accepting
  calls that do not exist at runtime — nothing had broken, and that is the
  failure mode rather than a reason to leave it. `22.18.x` is the line that
  describes Node 22.18.0, the Node VS Code 1.104 embeds and the one
  `engines.node` is derived from, so the pin follows the floor rather than being
  chosen. Same discipline `@types/vscode` is already held to, and for the same
  reason: the types are what tell the compiler which APIs exist.
- `RUNBOOK.md` now records what is actually outstanding, closing the Phase 2
  review's last finding. Two punch-list headers were unticked while every item
  beneath them was done; five Section E steps kept their ☐ boxes under a banner
  saying they would never be run; and six items had been deferred to slice 3a
  from five separate places with no 3a punch list to arrive in — one of them
  only as a comment in a test file. Phase 3 now opens with a written list of
  what it inherits, slice 2b-i has the completion record it never got, and the
  context write-back re-check that #84 unblocked is a numbered procedure rather
  than a sentence. No source, tests, or published documentation change.

[Unreleased]: https://github.com/Shai-Alit/sas-py-vscode/commits/main
