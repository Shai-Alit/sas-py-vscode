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

### Fixed

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

### Changed

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

[Unreleased]: https://github.com/Shai-Alit/sas-py-vscode/commits/main
