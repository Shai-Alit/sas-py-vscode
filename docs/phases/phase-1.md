# Phase 1 — Authentication and connection profiles

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 1 — Authentication and connection profiles

**1a — Connection profiles.** `pythonOnViya.connectionProfiles` setting, profile
add/edit/delete/switch commands, a one-time import from the SAS extension, and a
status bar item. Collapsed to a single Viya profile type — no SSH/COM/IOM
branches, so the upstream JSON-Schema `if`/`then` discriminator collapses with
them and is not ported. Every profile carries a `version`; the active profile
lives in `workspaceState`; the client secret lives in SecretStorage and never in
settings (ADR-0007). *Medium.*

> **The unit tier cannot import `vscode`,** so this slice establishes the seam
> every later one inherits: the profile *model* — types, validation, migration,
> the import filter — is a module with no `vscode` import and is specified by
> unit tests, while the thin store that wraps `workspace.getConfiguration` and
> `SecretStorage` is exercised in the extension host. Logic that drifts into the
> shell becomes untestable at the cheap tier, which is how a suite quietly stops
> being a specification.

**1b — OAuth2 + PKCE.** Port `auth.ts`: authorization-code flow with PKCE, the
**dual code capture** (URI handler *and* paste box racing, whichever lands first)
which is the pragmatic fallback for deployments without a registered redirect URI,
and 401-triggered refresh. **Corrected 2026-08-14 against a live deployment:** the
built-in `vscode` client registers `urn:ietf:wg:oauth:2.0:oob` and no
custom-scheme URI, so on a stock Viya 4 the paste box is not the fallback — it is
the only arm that can win, and the URI handler only ever fires against a client an
administrator registered with this extension's redirect URI. The race stays,
because which of the two applies cannot be known until after the user has
authenticated. An empty `clientId` falls back to the built-in
`vscode` client (decision 9); 3.5 and pre-2022.11 Viya 4 have no such client and
must be told to supply an id and secret in those words, because the failure they
would otherwise see is a generic OAuth rejection. Also add corporate
**proxy support**, which the SAS extension lacks and which is a known failure
class behind an enterprise proxy. *Medium.* **Split into 1b-i and 1b-ii on
2026-08-13**, along the same seam 1a used: the part that can be specified by
unit tests, and the part that can only be exercised in an extension host.

**1b-i — the auth core.** `src/auth/`, with no `vscode` import anywhere in it.
Three modules. `pkce.ts` mints the code verifier, the S256 challenge, and — see
the audit below — a random `state`. `tokenEndpoint.ts` builds the authorize URL
and makes the two SASLogon calls, `authorization_code` and `refresh_token`,
parsing the OAuth error envelope into a typed failure and converting `expires_in`
into an absolute `expiresAt` at the moment the response is read. `clientId.ts`
resolves decision 9, returning either the built-in `vscode` client or a typed
problem code in the style `src/profile/problems.ts` already establishes — codes
and parameters, never English prose, so the core stays free of `vscode.l10n` and
the message is still localisable in the shell. HTTP arrives as an injected
`fetch`-shaped port (ADR-0008), which means the whole slice is testable at the
cheap tier with no editor and no network. *Small-to-medium.*

**1b-ii — the VS Code shell.** `env.asExternalUri` and `env.openExternal`,
`window.registerUriHandler`, `window.showInputBox`, and the race between the last
two; validating the returned `state` on the URI-handler arm; proxy support; and
persisting tokens through `SecretStorage` next to the profile they belong to.
*Medium.* **As built,** proxy support arrives by making the request through
`https.request` and inheriting whatever the extension host has already arranged
on Node's `https` module — not through the undici `ProxyAgent` this paragraph
originally named. undici was evaluated in the slice and rejected: it buys a
`ProxyAgent` and loses the operating-system certificate trust that
`https.request` gets for free, and the internal-CA case is both more common than
the proxy case and indistinguishable from it in a bug report. ADR-0008 records
the reversal. The transport sets no `agent` deliberately, leaving that parameter
free for 1c-ii to attach an explicit CA bundle to.

> **Audit ported security code; do not transcribe it.** A close read of upstream's
> 145-line `auth.ts` on 2026-08-13 found five things worth changing, not one.
>
> 1. **The PKCE code verifier is built with `Math.random()`**, which is not a
>    CSPRNG and does not satisfy RFC 7636. Worse, it is drawn character-by-character
>    from a 66-character alphabet, which is also a modulo-bias shape. Use
>    `randomBytes(32).toString("base64url")`: 43 characters, uniformly distributed,
>    and every character is in the unreserved set by construction rather than by
>    a lookup table that has to be audited.
> 2. **The `state` parameter is never validated.** Upstream packs the callback URL
>    into `state` and then ignores it on the way back — `handleUri` reads `code`
>    out of any inbound URI and accepts it. A registered URI handler is not a
>    private channel, so this is the authorization-code CSRF that RFC 6749 §10.12
>    exists to prevent. Mint a random `state` and require it to match. This one is
>    arguably more serious than the verifier and was not previously recorded here.
> 3. **base64url is hand-rolled** as three chained `.replace()` calls on a base64
>    digest. Node has done this correctly since v15: `.digest("base64url")`.
> 4. **`expires_in` is discarded**, so the only way the extension can discover that
>    a token died is to spend a request finding out — which is exactly what
>    `refreshToken()` does, firing `headersForRoot()` on every call purely to see
>    whether it 401s. Keep the expiry and refresh ahead of it; a 401 from a real
>    request stays as the fallback, not the mechanism.
> 5. **The token endpoint's error envelope is dropped.** OAuth returns `error` and
>    `error_description`, and both are thrown away inside an axios rejection, which
>    is a large part of why a misconfigured client id surfaces as noise. Parse them.
>
> The same rule applies to every security-relevant file we port — upstream
> `CAHelper.ts`, for instance, arrives with a `console.log` inside a `catch`,
> violating two §5 gates on arrival.

**1c — AuthenticationProvider and secret storage.** VS Code `AuthenticationProvider`
so Viya appears in the Accounts menu; per-profile token namespacing in
SecretStorage; session change events; the `authorized` context key. Plus the
self-signed-certificate helper — deployments with private CAs are common and this
is 30 lines that prevents a class of unactionable failures. *Medium.* **Split into
1c-i and 1c-ii on 2026-08-13.** The two halves share a slice number and nothing
else: one is an editor integration whose risk is state management, the other is a
TLS change whose risk is that it silently widens what the extension will trust.
A single review would have to hold both, and the certificate half is exactly the
kind of change that gets waved through when it is the small half of a big diff.

**1c-i — the AuthenticationProvider.** Register a `pythonOnViya` provider so Viya
appears in the Accounts menu, with `getSessions`, `createSession`, and
`removeSession`; store one session per profile rather than one blob for all of
them; fire `onDidChangeSessions` on real transitions; set the
`pythonOnViya.authorized` context key that later `when` clauses gate on; and
resolve the account's name from `GET /identities/users/@currentUser`. Follows the
1a seam: the session model, the identity-response parse, and the decision of when
a change event is warranted are pure modules under unit test; only the provider
registration itself imports `vscode`. *Medium.*

> **The account model, settled 2026-08-13.** `account.id` is the **endpoint plus
> the Viya user id**, not the user id alone. One person with a dev deployment and
> a production deployment is two accounts, and they must be two rows in the
> Accounts menu — collapsing them means signing out of one signs out of the other,
> and worse, it means a token minted against dev is a candidate for a request to
> production. `session.id` is the profile's generated id, not its name, so
> renaming a profile does not orphan its session. Probe findings 8 and 9 pin the
> rest: key on `id` and never on `scimId` or the login name, request the
> `…identity.user.summary+json` representation so the user's address and phone
> numbers never enter the process, and read the sign-in failure out of
> `WWW-Authenticate`, because the 401 body is empty.

> **Audit, not transcription — upstream `AuthProvider.ts`.** Four things this
> slice deliberately does differently, found by reading it on 2026-08-13.
>
> 1. **All sessions live in one `SecretStorage` blob** under a single `SASAuth`
>    key, serialised together. Removing one session rewrites every other one, a
>    partial write loses all of them, and the blob grows without bound as profiles
>    come and go. One key per session, namespaced by profile id.
> 2. **`writeSession` does not await the store.** `this.secretStorage.store(...)`
>    is fired and dropped, so a window closing shortly after sign-in can lose the
>    session that sign-in just produced, and nothing surfaces the failure. Await
>    it, and let the caller see a rejection.
> 3. **Every `getSessions` call refreshes the token.** The Accounts menu polls;
>    this turns opening a menu into a network round trip and, when the refresh
>    fails transiently, into a silent session removal. Refresh against the
>    `expiresAt` that 1b-i already computes, and treat a 401 from a real request
>    as the fallback rather than the mechanism.
> 4. **`removeSession` falls back to the active profile when the id is unknown.**
>    An unrecognised id is a bug in the caller, and guessing which session was
>    meant makes it a bug that signs the user out of something they did not name.
>    Reject the unknown id.
>
> A fifth, on storage rather than upstream: the refresh token is what persists,
> the access token is held in memory for its lifetime. There is no value in
> writing a credential to disk that will be dead in an hour.

**1c-ii — private CAs and the TLS agent.** Read a user-supplied list of CA
certificate paths, build a dedicated `https.Agent` from the system roots plus
those certificates, and pass it as the `agent` 1b-ii's transport left open.
*Small.*

> **Do not port `CAHelper.ts` as written.** Upstream sets
> `https.globalAgent.options.ca`, which is process-global state in a host shared
> with every other installed extension: it changes what *they* trust, silently,
> and nothing in the extension's own tests could ever catch it. A dedicated agent
> is the same feature scoped to our own requests. And the `console.log` inside the
> `catch` around `fs.readFileSync` — named above as the example of why ported
> security code gets audited rather than transcribed — comes due here: an
> unreadable or malformed certificate path is a configuration error the user has
> to be told about, through the log channel, with the path named.

*Exit:* user can sign in to Viya and see their identity; tokens survive a reload;
signing out of one deployment leaves the other signed in; a deployment behind a
private CA reaches sign-in instead of failing at TLS; no secrets in logs.


---

## Runbook

# 1a — connection profiles
git checkout -b phase-1a-connection-profiles
git commit -m "feat(auth): add Viya connection profiles and profile commands"
```

☑ **Implemented 2026-08-12.** `src/profile/` in two halves, because the unit tier
runs outside an extension host and so cannot import `vscode`: `model.ts` and
`import.ts` are pure and carry every rule (endpoint normalisation and refusals,
name validation, per-profile tolerant reading, active-profile resolution, the
secret key), while `store.ts`, `commands.ts` and `statusBar.ts` are a thin shell
over the editor APIs and are covered by `test/integration/profile.test.ts`. That
split is the testing seam the rest of the project inherits — put the decisions on
the side the coverage number can see.

☑ **Coverage ratchet raised for the first time, 2026-08-12** (open decision #6):
55% lines and statements, 63% functions, 86% branches, each set a little under
what the suite measures so a three-OS gate does not fail on rounding. 187 unit
tests, up from 136.

☑ **Two upstream behaviours deliberately not inherited**, both recorded in
ADR-0007. Secrets are keyed on a stable generated `id` rather than on the profile
name (`AuthProvider.ts:134-141`), so renaming a profile does not orphan its
secret. And a missing `connectionType` is inferred from the fields present rather
than defaulted to `rest` (`components/profile.ts:206-225`), so a SAS 9 profile
that predates the field is skipped with a reason instead of being imported as a
Viya one.

☑ **1b split in two, 2026-08-13, along the seam 1a established.** The crypto and
the protocol can be specified by unit tests; the browser handoff and the code
capture can only be exercised in an extension host. Keeping them in one slice
would have put the PKCE audit in the same review as a URI-handler race, and the
audit is the part that needs undivided attention.

☑ **Upstream `auth.ts` audited before porting, 2026-08-13** — all 145 lines of
`client/src/connection/rest/auth.ts`, recorded in
[ADR-0008](docs/adr/0008-auth-core-transport-and-security-deltas.md) and in the
block quote under 1b in the plan. Five deltas, where the plan had previously
recorded one. The one it had not: **upstream never validates `state`**, so its
URI handler accepts an authorization code from any inbound URI. That is the
RFC 6749 §10.12 injection, and it is arguably worse than the `Math.random()`
verifier the plan already knew about. Finding it is the argument for the rule —
"audit, don't transcribe" has to mean reading the whole file, not confirming the
defect you arrived looking for.

☑ **Transport settled, 2026-08-13** (ADR-0008): no `axios`, no runtime
dependency. Node's floor here is 20.19.0 so `globalThis.fetch` exists, msw
already intercepts it, and `"dependencies": {}` is what makes 0d's supply-chain
gates cheap. The core takes a `fetch`-shaped port so 1b-ii has a seam to attach a
proxy dispatcher to.

> **The cost is real and is not fully paid yet.** `fetch` ignores `HTTP_PROXY`,
> and VS Code's proxy support patches `http`/`https` — which global `fetch` never
> touches. Routing it through a proxy needs a custom dispatcher, and Node does
> *not* expose `ProxyAgent` or `setGlobalDispatcher` publicly on the 20.19.0
> floor; those need the `undici` package installed. 1b-ii picks between one
> runtime dependency, a hand-rolled `CONNECT` tunnel, or a narrower supported
> configuration. Recorded now so it arrives as a decision instead of a surprise.

> **Amended 2026-08-18.** Two values above are superseded and neither changes the
> outcome. The floor is 22.18.0, not 20.19.0 (ADR-0018) — `ProxyAgent` is still
> not public API there. And `package.json` has no `dependencies` key at all
> rather than an empty one, which is strictly stronger than what this entry
> claims. 1b-ii resolved the choice a fourth way, through `node:https`.

```bash
# ⛔ BARRIER: merge 1a first.
# 1b-i — the auth core, no vscode import
git checkout -b phase-1b-i-pkce-core
git commit -m "feat(auth): add PKCE, token exchange, and client id resolution"
```

☐ **1b-i punch list.** `src/auth/`, and nothing in it imports `vscode`.

- `pkce.ts` — `randomBytes(32).toString("base64url")` for the verifier, 43 chars
  in the unreserved set by construction; `createHash("sha256").digest("base64url")`
  for the challenge; the same CSPRNG for a random `state`. No alphabet table, no
  chained `.replace()`.
- `tokenEndpoint.ts` — `buildAuthorizeUrl`, `exchangeAuthorizationCode`,
  `refreshTokens`. Parse `error` / `error_description` into a typed failure.
  Convert `expires_in` to an absolute `expiresAt` at the moment the response is
  read, so refresh can happen ahead of expiry instead of costing a probe request.
- `clientId.ts` — decision 9. Falls back to the built-in `vscode` client, or
  returns a typed problem code in the `src/profile/problems.ts` style — codes and
  parameters, never English prose, so the shell renders it through `vscode.l10n.t()`
  and the core stays testable.
- The `fetch` port is a structural type defaulting to `globalThis.fetch`.

☐ **Tests that actually pin the thing.** Two matter more than the rest.

- **RFC 7636 Appendix B's own test vector.** Verifier
  `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` must produce challenge
  `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`. A hand-rolled base64url passes a
  round-trip test against itself; it does not pass this.
- **Stub `Math.random()` to a constant with Sinon and assert two successive
  verifiers still differ.** A charset-and-length test would pass on upstream's
  broken implementation. This is the test that fails on it, and so it is the only
  one that actually encodes the CSPRNG requirement.

Then: charset and length bounds, uniqueness across many calls, the OAuth error
envelope, `expiresAt` arithmetic against a faked clock, and the decision-9 matrix
across Viya 3.5 / 4 2022.10 / 4 2022.11+ with `clientId` present and absent.

☑ **Coverage ratchet raised, 2026-08-13.** Measured 63.21 statements, 63.21
lines, 72.04 functions, 90.08 branches; floor set to **62 / 62 / 71 / 89**, about
a point under each. `src/auth` itself measures 98.78 statements with 100%
functions — the global number is far lower because `extension.ts` and the four
`src/profile` shell modules are only reachable from an extension host and score
zero here.

> **This ratchet is about to work against us.** 1b-ii is all shell code — the
> URI handler, `SecretStorage`, the browser handoff — which lands in the
> denominator and scores zero in the unit run, so the global percentage will
> *fall* even though the slice is fully tested by the integration suite. Ratchets
> that have to be lowered are not ratchets. Decide in 1b-ii scoping whether to
> exclude the shell modules from the c8 denominator, run separate thresholds per
> directory, or merge integration coverage in — but decide it before the number
> forces the decision.
>
> **Settled 2026-08-13, before it forced anything:** the first option, in its own
> slice below. ADR-0009.

☑ **Comment the 3.5 path in the code**, not only in the plan: it is built from
SAS's documentation and has never been observed against a live 3.5 deployment,
because there isn't one to observe. Decision 9 was amended on 2026-08-13 to stop
calling that a pending pre-release check — nobody can clear it, and a blocker
nobody can clear is a line people learn to step over.

```bash
# ⛔ BARRIER: merge 1b-i first.
# Interlude — fix the denominator before the slice that would bend it
git checkout -b chore/coverage-denominator
git commit -m "chore(coverage): measure unit-reachable code and check the exclusion"
```

☐ **Coverage-denominator punch list.** Small on purpose, and its own slice on
purpose: a threshold re-baseline has to be measured on a tree where nothing else
moved, or the new number is unattributable.

- `.c8rc.json` — the five `vscode`-importing modules join `exclude`.
- `scripts/check-coverage-scope.mjs` — asserts the rule in **both** directions
  (everything excluded imports `vscode`; everything importing `vscode` is
  excluded), refuses globs, and uses TypeScript's parser so that a comment
  mentioning `vscode` is not read as an import and an erased `import type` does
  not cost a module its floor. Joins `npm run verify`.
- Its unit test, including one case that runs the check against this repository —
  so drift fails by file name in the tier that runs on three operating systems,
  not only in the gate.
- ADR-0009, `docs/dev/testing.md`, `docs/dev/ci.md`, `docs/dev/building.md`,
  `CHANGELOG.md`.

☑ **Ratchet re-baselined, 2026-08-13.** Measured 79.30 statements, 91.87
branches, 77.77 functions, 79.30 lines; floor set to **77 / 90 / 76 / 77**. The
run added no tests and touched no source file — the sixteen points against 1b-i's
63.21 are the measurement changing, which is the size of the distortion the old
denominator was carrying.

> **The next argument about this number will be about `scripts/`.** It measures
> 64.76% and is now the only drag, against `src/auth` at 99.65 and `src/profile`
> at 98.30. Most of what is uncovered is each script's `main()`, behind the
> `process.argv[1]` guard that lets the unit tier import a script without running
> it — so what is untested is precisely the part that decides whether a gate
> exits non-zero. Worth its own slice; do not let it be bolted onto a feature.

```bash
# ⛔ BARRIER: merge the denominator slice first.
# 1b-ii — the VS Code shell
git checkout -b phase-1b-ii-auth-shell
git commit -m "feat(auth): add browser sign-in, dual code capture, and proxy support"
```

☑ **An integration test per shell module — this one is now load-bearing.**
ADR-0009 took the shell out of the coverage denominator, so no threshold will
notice a missing test any more. The guarantee is this line and a reviewer's
attention, which is weaker than a number and is why it is written down here.
Done 2026-08-13: five suites under `test/integration/auth/`, 36 tests, one per
shell module. Two things the tier caught that no unit test could have. First, a
`vscode.LogOutputChannel` is identified by its **name**: dispose one and create
another by the same name and the host hands back the cached, already-disposed
logger, after which every write throws `Channel has been closed` — a per-test
create/dispose cycle in the helper killed seven browser-flow tests and reported
the failures against `browserFlow.ts`. Channels are now created once per name and
outlive the run, which is what an extension does anyway. Second, `SecretStorage`
is unreachable from a test — it arrives only through `ExtensionContext`, which
only `activate` is given — so the store suites run against an in-memory double and
the real keychain is reached the one way a test can, by running
`pythonOnViya.signOut` end to end. The trade-off is written up in
`test/helpers/auth-host.ts` rather than left implicit.

☑ **1b-ii punch list.** Every item below done 2026-08-13.

- ☑ **Two commands, not in the original list.** `pythonOnViya.signIn` and
  `pythonOnViya.signOut`, on the active profile rather than behind a picker —
  the active profile is already in the status bar, and a second place to choose
  it invites the two to disagree. Sign-in prompts for the client secret when the
  profile names a `clientId` and none is stored, which is the promise the import
  command already makes ("you will be asked for the client secret the first time
  you connect") coming due.
- ☑ **`env.asExternalUri` on the callback URI _before_ it goes into the authorize
  URL**, then `env.openExternal`. `asExternalUri` is what makes this work in
  Codespaces and remote/SSH windows; skipping it is the classic "works locally,
  fails remote" auth bug. Done 2026-08-13 in `browserFlow.ts`. A host that cannot
  produce an external URI degrades to a paste-only sign-in rather than failing —
  `beginSignIn` omits `redirect_uri` entirely and the deployment falls back to
  whatever it has registered.
- ☑ **Wire `stateMatches()`.** This is the whole reason 1b-i shipped a state
  primitive with no caller. The URI handler compares the inbound `state` against
  the one generated for _this_ attempt and drops any callback that does not
  match. **1b-ii cannot merge without it** — the RFC 6749 §10.12 injection is
  closed at this point and nowhere else. Done 2026-08-13, in `readCallback`
  rather than in the handler itself: dispatch to the right attempt *is* the state
  check, so the handler offers each callback to every outstanding attempt and the
  one that issued the `state` recognises it. The check runs before anything else
  is read out of the query, and on the `error` arm as well as the success arm.
- ☑ **The paste-box arm carries no `state` and cannot be protected the same way.**
  Say so in the code. That is an argument for narrowing the paste box later, not
  for skipping the check on the arm where it works. Said, at length, in the
  `browserFlow.ts` module doc. A pasted *URL* is routed through `readCallback` and
  so is state-checked; only a bare code is not.
- ☑ **`registerUriHandler`** on activation, disposed on deactivate. One handler for
  the extension, dispatching to whichever attempt is outstanding. Done 2026-08-13:
  `registerAuthUriHandler` in `extension.ts`, with the disposable on
  `context.subscriptions`. Upstream registers inside its sign-in function, so a
  second sign-in registers a second handler.
- ☑ **The dual-capture race.** URI handler versus `showInputBox`. Whichever lands
  first wins; the loser is cancelled rather than left dangling, and the input box
  closes on a successful callback. Done 2026-08-13. The subtlety worth keeping in
  mind: `showInputBox` resolves `undefined` both when the user dismisses it *and*
  when its cancellation token fires, and the second is the case where sign-in
  succeeded — so the paste arm asks `token.isCancellationRequested` before
  interpreting `undefined` as a cancellation. That started as a shared `settled`
  flag; type-aware lint was right to reject it, because the flag was a second copy
  of something the cancellation token already knew. A paste that cannot be used
  re-prompts, bounded at five attempts so a stubbed box cannot spin.
- ☑ **`SecretStorage`** keyed on the profile's generated `id`, not its name
  (ADR-0007's delta from upstream). Persist the refresh token; the access token
  can be re-derived and need not outlive the session. Done 2026-08-13 in
  `sessionStore.ts`, under `pythonOnViya.session.<id>` — distinct from the client
  secret at `pythonOnViya.profile.<id>`, so signing out destroys the session
  without destroying configuration the user typed. An entry that will not parse is
  deleted rather than logged about forever.
- ☑ **`vscode.l10n.t()` renderer for `AuthProblem`** — the codes-not-prose seam from
  1b-i. Exhaustive switch, explicit `string` return, no `default`, so a new code
  is a compile error rather than a silently untranslated message. Done 2026-08-13
  as `messages.ts`. Named differently from its profile counterpart because
  `problems.ts` in `src/auth/` was already the codes; renaming it would have
  churned five importers to buy symmetry.
- ☑ **Swap the default transport to `https.request`** and rename `FetchLike`.
  Done 2026-08-13: `src/auth/transport.ts` exports `nodeHttpTransport`, and the
  port is now `HttpTransport`. Superseded plan: this line previously read "the
  undici `ProxyAgent` dispatcher". Research on 2026-08-13 found a fourth option
  ADR-0008 had not considered, and it is better than all three it did — requests
  through the `http`/`https` modules reach enterprise proxies **and internal
  certificate authorities**, at zero dependency cost, while `fetch` reaches
  neither. Stated as the observable consequence on purpose: upstream ships no
  proxy or TLS code at all and works in those environments, which is the evidence;
  *which* host setting arranges it was not verified and is not asserted anywhere.
  The certificate half is the part that matters — internal CAs are routine in
  enterprise Viya and fail at sign-in, a far more common configuration than a
  corporate proxy. ADR-0008 amended on this branch; unit tests run against a real
  loopback server rather than msw, which would otherwise stand in for the code
  under test.

**Test seam.** Everything except the transport swap needs an extension host, so
it lands in `test/integration/`. Keep the pure decisions — which arm won, whether
a state matched, what to persist — in functions the unit tier can still reach.
Same split 1a established, and now the only thing holding the shell's line.

☑ **Ratchet raised, 2026-08-13.** Measured 81.98 statements, 92.69 branches,
80.86 functions, 81.98 lines; floor set to **79 / 91 / 78 / 79**. The measurement
did not move during this slice's test work, and that is the expected result rather
than a disappointment: ADR-0009 excludes every module the new integration suites
exercise, so 36 tests that hold the shell's line are invisible to this number by
construction. What raised it was 1b-ii's *core* — `clientId.ts`, `pkce.ts`,
`signIn.ts` and `tokenEndpoint.ts` all at 100, `transport.ts` at 97.82.

☑ **Review response, 2026-08-13.** Two findings, one of each verdict, and both
were checked against the code rather than acted on.

The 🔴 blocking one — "the `post()` call passes no `AbortSignal`, so the request
can neither be cancelled nor time out" — is a false positive. `tokenEndpoint.ts`
passes `AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS)`, and
`transport.ts` honours it, with tests for an already-aborted signal and for one
that fires mid-request against a real loopback server. The reviewer was
describing the `fetch` code this slice replaced. It did expose a real gap
though: nothing pinned that the token endpoint *supplies* a signal, only that the
transport respects one, so a refactor that dropped the line would have left every
test green and shipped a sign-in that hangs for as long as a proxy will hold the
socket. That is now two tests in `auth-token-endpoint.test.ts`.

The 🟠 major one — a public client is re-prompted for a secret at every sign-in,
because an empty answer is discarded — is correct, and the fix it suggested is
not. "Store the empty string" fails on any machine without an OS keyring: VS Code
guards its read on the *stored* value being falsy, and the in-memory fallback
backend encrypts with the identity function, so `""` goes in and `undefined`
comes out. Verified in the shipped `workbench.desktop.main.js` for 1.133.0, which
`.vscode-test/` already had on disk. So the claim is configuration in
`globalState`, the secret store keeps only secrets, and `secret()` is tri-state.
`ProfileStore`'s constructor now asks for the three context members it uses
rather than the whole `ExtensionContext`, which is what makes any of this
testable without a cast — `test/integration/profile/secret-storage.test.ts`.

**Split into 1c-i and 1c-ii, 2026-08-13.** The two halves share a slice number
and nothing else. One is an editor integration whose risk is state management;
the other is a TLS change whose risk is that it quietly widens what the extension
will trust. Reviewing them together means the certificate half arrives as the
small half of a big diff, which is how that kind of change gets waved through.

**Two of the four things the plan listed under 1c already shipped in 1b-ii.**
Per-profile namespacing in `SecretStorage` is `sessionStore.ts`, keyed on the
generated profile id under `pythonOnViya.session.<id>`, and the refresh-token-only
persistence policy is `toStoredSession`. 1c-i builds the provider **on top of**
those rather than re-deciding them; a punch list that re-lists finished work is
how a slice grows a phantom third of its size.

```bash
# ⛔ BARRIER: merge 1b-ii first.
# 1c-i — the AuthenticationProvider
git checkout -b phase-1c-i-auth-provider
git commit -m "feat(auth): register an AuthenticationProvider and resolve the Viya identity"
```

☐ **Probed first, 2026-08-13, before any of this was written.** Findings 6–9 in
`PROBE-FINDINGS.md`, against the live Viya 4. Three of them change what gets
built, so probing after scoping would have meant scoping twice.

☐ **1c-i punch list.**

- ☑ **`src/auth/identity.ts` — pure, and it stays in the coverage denominator.**
  The response parse, the label fallback chain, and `accountId(endpoint, userId)`.
  No `vscode` import, so ADR-0009 keeps it measured, and the account model gets
  specified by unit tests against a scrubbed fixture rather than by whatever the
  provider happens to do. ~~`id` is required and `name` is required~~; everything
  else is optional, because finding 8 only established `title` and `state` on one
  deployment.
  **Corrected while implementing, 2026-08-13: only `id` is required.** The two
  rules cannot both hold. Decision 10 specifies a label fallback of `name` → login
  → `id`, and a parser that rejects a user carrying no `name` makes both fallback
  arms unreachable — the chain would be dead code and the tests covering it would
  be testing nothing. The one deployment we could probe is SCIM-backed and
  populated `name`; the ones we could not are LDAP-backed and Viya 3.5, which are
  exactly where a missing display name shows up. Requiring a cosmetic field there
  turns "no display name" into "cannot sign in". Recorded in the module doc.
- ☑ **Ask for `application/vnd.sas.identity.user.summary+json` explicitly, and
  say why in the code.** Finding 7: the full representation returned a street
  address, a postal code, a work email and two phone numbers for a real person,
  and upstream sends no `Accept` header at all, so it pulls every one of those
  into the extension host and keeps two fields. The summary type is the same URL
  and the same 200. This is one header and it is the difference between that data
  being in our process and not.
- ☑ **A 406 on the summary type falls back to the full representation, dropping
  the PII fields as it parses.** Not defensive padding: finding 6 showed 406 is
  what a media type this service does not serve looks like, and no Viya 3.5
  deployment exists to check the summary type against. The fallback is what lets
  3.5 be unverified rather than unsupported.
- ☑ **Widen `TransportResponse` to expose response headers.** Today it carries
  `ok`, `status` and `text()`, and finding 9 makes that insufficient: a dead
  token is a **401
  with a zero-byte body**, and the whole diagnosis lives in `WWW-Authenticate`.
  Any error path that builds its message from the body renders an empty string
  for the most common recoverable failure there is. Parse RFC 6750's `error` and
  `error_description` into a new `AuthProblem` code, and distinguish
  `error="invalid_token"` (sign in again) from a bare `WWW-Authenticate: Bearer`
  (nothing was sent). `TransportRequest.body` also needs to be optional or this
  slice sends `""` on a `GET`; decide which in the PR rather than by accident.
  **Decided 2026-08-13: optional.** A `GET` now carries no body and no
  `content-length`, rather than an empty string and a `content-length: 0` that
  says the request had a body which happened to be empty.
- ☑ **`src/auth/authProvider.ts` — the shell.** Register the provider, contribute
  `authentication` in `package.json` ~~with `supportsMultipleAccounts`~~, and hold
  no logic that `identity.ts` or `signIn.ts` could hold instead.
  **Corrected while implementing, 2026-08-13: `supportsMultipleAccounts` is not a
  manifest field.** The `authentication` contribution takes an `id` and a `label`
  and nothing else — upstream's manifest carries exactly those two, and
  `@types/vscode` puts `supportsMultipleAccounts` on the options argument of
  `vscode.authentication.registerAuthenticationProvider`. It is passed there, in
  `registerAuthProvider`. The distinction matters beyond pedantry: had it been
  written into the manifest it would have been silently ignored, and VS Code would
  have treated a second `createSession` as replacing the first — the exact
  single-session behaviour this slice exists to avoid, failing only on the
  two-deployment path a single review pass is least likely to walk.
- ☑ **`createSession` and `removeSession` call the same code the sign-in and
  sign-out commands already do.** Two sign-in implementations is how the Accounts
  menu and the command palette drift into disagreeing about who is signed in.
- ☑ **`getSessions` does not refresh.** Upstream refreshes on every call, and the
  Accounts menu polls, so opening a menu becomes a network round trip and a
  transient failure becomes a silent sign-out. Refresh against the `expiresAt`
  1b-i already computes; a 401 from a real request stays the fallback.
- ☑ **`removeSession` rejects an id it does not recognise.** Upstream falls back
  to the active profile, which turns a caller's bug into signing the user out of
  something they did not name.
- ☑ **`onDidChangeSessions` fires on real transitions only.** Put the comparison
  in a pure `diffSessions(before, after)` so "did anything actually change" is a
  unit test and not an observation about event volume.
- ☑ **`pythonOnViya.authorized` context key**, set through `setContext`, for the
  `when` clauses Phase 2 onward will gate on.
- ☑ **The access token stays in memory.** `sessionStore.ts` persists the refresh
  token and only that; the provider must not widen it. Writing a credential to
  disk that will be dead within the hour buys nothing.
- ☑ **Raise the ratchet** from a measured run. `identity.ts` is unit-reachable, so
  unlike 1b-ii this slice should actually move the number.
  **Measured 2026-08-14: 84.28 statements / 92.33 branches / 83.94 functions /
  84.28 lines**, up from 82.07 / 92.75 / 81.03 at 1b-ii — it did move, and it
  moved most on functions, which is what a slice of new pure modules should do.
  Thresholds set to **82 / 82 / 82 / 91** (lines / statements / functions /
  branches). Branches stays at 91: measured 92.33 leaves 1.33 points of slack,
  and tightening to 92 would leave 0.33 on a three-OS gate.

**Two more folded in on 2026-08-14, after the first sign-in against a real
deployment.** Neither is 1c-i's subject and both block anyone using the branch,
which is the test for folding rather than filing.

1. **The built-in `vscode` client gets no `redirect_uri`.** The sign-in failed
   after authentication with *"Invalid redirect
   `vscode://…/auth-callback%3FwindowId=2` did not match one of the registered
   values"*. Three browser probes settled why, and it is not the extension id:
   sending upstream's own `vscode://sas.sas-lsp` was rejected too, and omitting
   `redirect_uri` produced a consent page announcing
   `urn:ietf:wg:oauth:2.0:oob`. The built-in client has **no** custom-scheme
   redirect registered. So `beginSignIn` now sends the shell's callback URI only
   when the profile named the client, and the decision lives there because both
   OAuth legs read `pending.redirectUri` and RFC 6749 §4.1.3 requires them to
   agree. Two consequences worth keeping: the paste box is the **only** route on
   the built-in client rather than the fallback, and upstream's trick of
   smuggling the callback URL through `state` buys nothing — tested in both
   encodings, SASLogon displayed the code both times. The `state` nonce check
   1c-i wired is therefore safe: on the oob path there is no callback to check,
   and on a registered-redirect path the callback carries the nonce normally.
   The `%3F` was real too and separately fixed: `callbackUri()` now concatenates
   the parsed `Uri` components instead of trusting `toString(true)`.
2. **The PKCE verifier reached the log.** SASLogon echoes the `code_verifier` it
   received back inside `error_description`, and `describeAuthProblem` passes
   that field through verbatim — by design, it is the most useful diagnostic in
   the flow. `redactSecrets` in `problems.ts` scrubs the values this process
   knows are secret out of the server's text. Dropping `error_description`
   instead would have traded one leak for permanent blindness. It was applied in
   `finishSignIn` first and moved into `tokenEndpoint.post` under review (below),
   because one call site per grant is one call site too many.

**Sign-in works end to end against a real Viya 4, 2026-08-14.** The authorize
leg without a `redirect_uri`, the consent page, the pasted code, the token
exchange, the identity read and the session write, in one pass; the output
channel says `Signed in to <endpoint>` and names no user, which is deliberate —
a display name in a log is a real person in an issue report. That closes the
first line of the manual check at the end of 1c-ii. The second line — reload the
window and confirm the account comes back — was run the same day and **failed**,
which found the activation defect recorded below; **re-run after the fix, it
passes**: the window comes up already signed in, and the tell is that the
Accounts menu no longer offers "Sign in with SAS Viya" at all, because there is
nothing left to sign in to. The third — a second profile appearing as a second,
independent account — **also passes**, which is decision 10 confirmed against a
live deployment rather than argued from the code: two rows, two display names,
two refresh tokens under their own `SecretStorage` keys, and signing out of one
leaving the other alone. That is the single-session model upstream carries,
tested and not repeated.

One thing the check surfaced, and it is a real defect rather than a surprise:
**signing in always acts on the active profile**, whichever account row was
clicked, because `createSession` reads `profiles.active()` and VS Code hands the
provider no indication of which account the user meant. Switching profiles first
is a workaround, not the behaviour. Tracked as the "Accounts menu acts on any
profile" correction — the docs claim is wrong in the same place the code is.

**Three source changes the punch list did not ask for, all found by writing the
tests, 2026-08-13.** Recorded here because "the tests caught it" is worth more as
a record than as a memory.

1. `challenge.ts` refused to treat `Bearer <junk>` as a Bearer challenge — a
   guard required the first token after the scheme to contain an `=`, so a
   malformed challenge parsed as *no challenge at all*. That maps to
   `not-authenticated`, which tells the user nothing was sent when something was
   and the server garbled its reply. The guard is gone; a parameter without an
   `=` is now a no-op rather than a verdict.
2. `identity.ts` `root()` did not trim. Two spellings of one endpoint — a stray
   space in a hand-edited setting, a pasted trailing slash — produced two account
   ids, and the same deployment would have appeared twice in the Accounts menu.
3. `authProvider.ts` refreshed with `clientId: profile.clientId ?? ""`, which
   renews nothing on any deployment using the built-in `vscode` client — that is
   every Viya 4 from 2022.11 on, so very nearly all of them. It now resolves the
   same `BUILT_IN_CLIENT_ID` default the sign-in path does. This one would not
   have shown up until a token expired, an hour into a working session.

**Six review findings answered on 2026-08-14**, from CodeQL and the two bot
reviewers on `phase-1c-i-auth-provider`. All six were accepted; none needed an
argument, which is worth noting on its own.

1. **CodeQL, high: remote property injection** in `transport.ts`. Response
   headers were accumulated into an object literal, so a header named
   `__proto__` reached its prototype. They are collected into a `Map` and
   handed to `Object.fromEntries` now, and the collection is an exported pure
   function so it is unit-testable rather than reachable only through a socket.
2. **A transport failure while reading the identity said
   `token-endpoint-unreachable`.** It names the wrong host and points the reader
   at the wrong half of the deployment; it is an `identity-unavailable` carrying
   the path and the reason now.
3. **`createSession` served the cached identity.** The cache exists so renewing a
   token costs no round trip, but a fresh sign-in is precisely when the user may
   have picked a different account, and the new session would have worn the old
   user's name. `establish` now takes an `IdentitySource`, so the seam is in the
   type rather than in a comment. The reviewer's other half was right too — no
   test covered "sign in again while a live session is held", because
   `createSession` would have opened a real browser. `AuthProviderDeps` gained
   the three browser ports, and there are now two tests: one that the second
   sign-in re-asks, one that a renewal still does not.
4. **The refresh failure logged an unredacted problem.** Rather than add a second
   `redactSecrets` call beside the first, the scrub moved into the token
   endpoint's `post`, which is the one place both grants pass through. Four unit
   tests pin the behaviour, including the two that matter most: a refresh token
   echoed back is scrubbed, and `redirect_uri` is *not* — that message is what
   diagnosed the `oob` problem, and an over-eager scrub would have hidden it.
   Writing those tests turned up a real defect in the scrub itself:
   `redactText` had no length floor, so the one-character `code` and
   `codeVerifier` the existing failure tests used matched everywhere and
   rendered the message as `In[redacted]alid redire[redacted]t …`. Values under
   `MIN_REDACTABLE_LENGTH` (8) are skipped now — substitution can only hide a
   distinctive value, and a single character is recoverable from context anyway
   — and the placeholders in those tests are realistic lengths, so they exercise
   the substitution rather than the skip.
5. **`AUTH_PROVIDER_LABEL` was a bare literal.** Now `authProviderLabel()`,
   resolved at registration through `vscode.l10n.t()`. `l10n/bundle.l10n.json` is
   generated at `vscode:prepublish`, so nothing had to be hand-edited.
6. **The live claims were not in `PROBE-FINDINGS.md`.** Fair: they were in a
   commit message and a plan paragraph. Findings 10-12 record them properly, with
   a methodology note admitting this evidence came from driving a browser rather
   than from `curl`, because the authorize leg needs a password typed by a human.

**Three more, from the second review round on 2026-08-14.** Two were bot
findings on the same branch; the first came out of the manual check above and is
the one worth reading twice.

1. **Nothing brought the session back after a reload**, and the cause was not in
   `auth/` at all. `activationEvents` was `[]` — correct as far as it went, since
   a contributed command activates its extension implicitly from VS Code 1.74 —
   but a reloaded window runs no command. The extension never woke, the provider
   was never registered, VS Code had nobody to ask, and the Accounts menu came
   back empty over a perfectly good refresh token. Sign-in had only ever worked
   because running the command was itself the activation. `onStartupFinished`
   now, which fires after the window is up; `onLanguage:python` remains out of
   the question, for the reason `docs/dev/building.md` gives. The comment in
   `extension.ts` and the paragraph in `building.md` both argued for the empty
   list, confidently and at length, and both were wrong in the same place — a
   reminder that a well-written justification is not evidence.
2. **`establish` opened a dialog when the identity read failed.** The reviewer
   asked for the modal to be dropped on the renewal path; it is dropped on both,
   which is stronger and is what the code already implied. `createSession`
   rejects when `establish` returns `undefined`, and VS Code shows that rejection
   — so the dialog was a *duplicate* when the user asked and an *interruption*
   when they did not. Log only now, `error` on `"new-sign-in"` and `warn` on
   `"renewed-token"`, matching the refresh branch directly above it. The
   integration test that pins this asserts the rejection, not the absence of the
   dialog: the message the user gets is now the only one there is, so it is the
   thing that must not regress.
3. **Workspace trust was documented and unenforced.** ADR-0002 has claimed since
   0b that connecting requires a trusted folder; nothing checked. Enforced now at
   the token boundary — all three provider entry points — with the two commands
   carrying `isWorkspaceTrusted` as a courtesy on top. Two details worth keeping:
   `removeSession` is gated as well, though it only deletes, so the refusal names
   the folder instead of blaming the profile id; and trust granted mid-window is
   picked up through `onDidGrantWorkspaceTrust`, because this extension declares
   `supported: "limited"` and therefore keeps running across that transition
   rather than being restarted into a trusted host. The integration host cannot
   be made untrusted — it opens an empty window, and empty windows are trusted —
   so `AuthProviderDeps.isTrusted` exists purely so the closed branch is
   executed by something. ADR-0002 itself warned that "integration tests must
   cover the untrusted path, or the restriction will rot"; it rotted before the
   ink dried.

**Two more, from the third review round on 2026-08-14**, both bot findings on the
pushed branch, both accepted.

1. **The sign-out command swallowed every failure**, reporting all of them as
   "You are not signed in". Worse than the finding said: the case the `catch` was
   written for — the provider not recognising the id — is nearly unreachable from
   that command, because `profiles.active()` supplies the id and `profileById`
   looks it up in the same store, so essentially everything that arm ever caught
   was a real failure. Once trust enforcement landed the day before, the message
   it was most likely to hide became the trust refusal: the one error whose whole
   value is the command name it tells you to run. `removeSession` now throws a
   `NoSuchSessionError`, and the command discriminates on the type rather than on
   the message — the message is localised, so matching it would have worked in
   English and swallowed the refusal in every other display language. The
   integration tests assert the type on the unknown-id path *and* assert that the
   trust refusal is not that type, because a discriminator only earns its keep if
   both sides of it are pinned. The command's own reporting arm has no automated
   cover: it lives in a `vscode`-importing module, and there is no way to read
   back which dialog was shown.
2. **`redactSecrets` was the one switch in `problems.ts` with a `default`.**
   `describeAuthProblem` and `messages.ts` name every variant so that adding one
   is a compile error, and this is the function where that guarantee actually
   protects something: a missing case in a renderer ships an untranslated
   sentence, and a missing case here ships a secret. A `default` returning the
   problem untouched is exactly the shape that lets a future variant quoting a
   server-supplied string compile cleanly and never be scrubbed, and nothing
   reports it, because "not redacted" is indistinguishable from "nothing to
   redact". All eight variants are named now. No behaviour changed; the existing
   `every`-variant test already covered the arm.

**The identity fixture is in `test/fixtures/harness/`, not `viya4/`.** Findings 7
and 8 deliberately recorded field *shapes* rather than values, because the values
were a real person's address and phone numbers, and `creds.json` is no longer
staged in the project folder, so there is no raw body to scrub and no way to
capture one right now. It is hand-written under the escape hatch
`test/fixtures/README.md` provides and says so in the file. Worth replacing with
a real capture when `creds.json` is next staged: one read-only `GET` with the
summary `Accept` header, and — per finding 7 — a correctly captured *summary*
response needs no scrubbing at all, which is the strongest argument for that
header there is.

**Test seam.** `identity.ts` and `diffSessions` are unit tier and are the
specification. The provider registration, the context key, and the session change
event need an extension host, so they land in `test/integration/auth/`. The
identity fetch is tested against `test/helpers/mock-viya.ts` with a fixture
scrubbed per `test/fixtures/README.md` — which requires the `PROBE-FINDINGS.md`
entry that finding 6–9 now provides.

```bash
# ⛔ BARRIER: merge 1c-i first.
# 1c-ii — private CAs and the TLS agent
git checkout -b phase-1c-ii-private-ca
git commit -m "feat(auth): trust user-supplied CA certificates on a dedicated agent"
```

☐ **1c-ii punch list.**

- ☐ **A `pythonOnViya.userProvidedCertificates` setting**, a list of paths, with
  the reference docs regenerated.
- ☐ **A dedicated `https.Agent`**, built from `tls.rootCertificates` plus the
  user's, passed as the `agent` option `transport.ts` deliberately left free.
  **Do not touch `https.globalAgent`.** Upstream's `CAHelper.ts` sets
  `https.globalAgent.options.ca`, which is process-global state in a host shared
  with every other installed extension: it changes what *they* trust, silently,
  and no test of ours could ever catch it.
- ☐ **An unreadable or malformed certificate is reported, not swallowed.**
  Upstream `console.log`s inside the `catch` around `fs.readFileSync`, which
  fails two §5 gates on arrival. Name the path, through the log channel, and
  carry on with the certificates that did load.
- ☐ **A test that proves the agent is scoped.** Build the agent, then assert
  `https.globalAgent.options.ca` is untouched. That assertion is the entire point
  of the slice and is the one a future refactor would otherwise quietly break.

☑ **Done; confirmed 2026-08-16.** Verified by hand against the live deployment
after 1c: sign in, reload the window, the session persisted and the Accounts menu
showed the identity; a second profile pointing at a different deployment appeared
as a **second** account, and signing out of one left the other signed in. That is
decision 10, and it was the behaviour a single review pass was most likely to
miss. Original text kept above in spirit; the box was left unticked at the time
and the confirmation is recorded here late.

The second profile pointed at a genuinely different Viya deployment, not a second
name for the same one, which is the only version of this test worth running.

**Why this passed and #84 still failed later.** The Connect command did not exist
yet. `runConnect` first appears in `b356f6b` (2a-ii, PR #23); this box belongs to
1c-i (`4d87bb8`, PR #19). So what was proved here is the **sign-in and identity**
path — `getSessions()`, which is what the Accounts menu polls and which walks
every profile — and that proof still stands. #84 was not a regression in it. It
was a **new caller**: `runConnect` asked for a session with no `account` hint, and
the host substituted the account it happened to remember, opening the browser on
the first profile's deployment. Nothing in the 1c surface ever gave the host that
opportunity.

That is the part worth carrying forward. A host behaviour can sit dormant through
an entire slice's hands-on verification and surface the moment a second caller
reaches the same API by a different route — so "the two-profile case is proved"
is a claim about the callers that existed when it was proved, and it expires
quietly every time a new one is added. See #137 for the fix
(`clearSessionPreference`, first appearing in `da6ccb0`).

### Phase 2 — Compute session and backend seam

> **1c-ii is deferred, not done, and it does not block Phase 2.** Sign-in works
> end to end against a real deployment today because Node already trusts that
> chain. A deployment behind a private CA fails at TLS, which is a robustness gap
> rather than a demo blocker. It stays on the list; Phase 2 starts without it.

> **The client is hand-written — ADR-0010.** The pre-agreed "2a-i vendors the
> generated client" split is gone, and so is the `check:coverage-scope` collision
> ADR-0009 warned about, because there is no generated client to exclude. The
> split below is the same pure-core / VS-Code-shell seam 1b and 1c used.
>
> Everything in 2a-i is grounded in **`PROBE-FINDINGS.md` findings 13–20**
> (2026-08-14, live Viya 4), plus findings 6 and 9 from the identity probe. Read
> those before starting; every item below cites one, and several contradict what
> upstream's code would lead you to write.
>
> **Corrected 2026-08-14, mid-slice.** The items below originally cited findings
> 11–16, which is what the probe notes were numbered as while 2a was being
> scoped. Those numbers were never written into `PROBE-FINDINGS.md`, whose 11 and
> 12 are the OAuth findings from the day before — so the citations already
> shipped in `links.ts`, `client.ts` and `problems.ts` pointed at unrelated text.
> The Compute findings are now written up as **13–20** and every citation in the
> slice has been repointed. One of the old notes did not survive the write-up:
> see the `+json` item.

```bash

---

## Probe findings

# Live-Viya probe findings

The evidence base. One section per probe, newest last, each dated and scoped to
the deployment it ran against. **Status of everything below:** *confirmed against
a live deployment* — observed, not inferred. `PRODUCTION_PLAN.md` rests on these
facts, so if one of them turns out to be deployment-specific rather than general,
the slice that depends on it needs revisiting. What a probe did *not* settle is
recorded as explicitly as what it did; an unasked question is not a "no".

Probes are run under the `viya-api-probe` rules and are read-only `GET`s wherever
a `GET` can answer the question. Where it cannot — session lifecycle is the case,
because nothing about how a session dies is observable without creating one — the
probe is agreed with the maintainer first, acts only on a throwaway object it
created, and deletes that object in the same shell call under a `trap`. Captured
payloads are scrubbed before they land here: no tokens, no internal hostnames, no
real user names or org-identifying ids. Field names, types, and null/absent
patterns are reproduced exactly, because that fidelity is the whole point.

## 2026-08-11 — Python execution substrate (Viya 4)

### Deployment identity

| Fact | Value |
|---|---|
| `SYSVLONG` | `V.04.00M0P030926` (Viya 4) |
| Python interpreter | `/opt/sas/viya/home/sas-pyconfig/default_py/bin/python3` |
| Python version | 3.12.12 (GCC 11.5.0, RHEL) |
| Compute contexts available | 13, including `SAS Job Execution compute context`, `SAS Studio compute context`, `Reusable compute context` |

The interpreter path is the **sas-pyconfig managed `default_py` environment** — i.e.
the Viya-administered Python, which is exactly the environment users want to target.
This confirms the core product premise: the developer gets Viya's managed packages
without installing anything locally.

### Packages already present

| Package | Version |
|---|---|
| pandas | 3.0.5 |
| numpy | 2.5.1 |
| swat | 1.18.1 |

`swat` being present matters: CAS access from a Python cell works without any
additional provisioning, which makes the CAS/SWAT phase materially cheaper than
if we had to stand up the client ourselves.

### Finding 1 — Python state persists across `PROC PYTHON` steps

The single most consequential finding. Setting a variable in one `PROC PYTHON`
step and reading it in a later, separate step within the same compute session
works, and the log announces it explicitly:

```
NOTE: Resuming Python state from previous PROC PYTHON invocation.
...
PERSIST_OK carried_value= 42
```

**Consequence.** REPL and notebook semantics are achievable on `PROC PYTHON`
without a bespoke kernel. Cell-to-cell state sharing — the thing that would
normally force a native Python runtime — comes free from the compute session.
This is what makes the "PROC PYTHON now, pluggable backend later" decision safe
rather than a compromise.

### Finding 2 — The `SAS` bridge object is available

`'SAS' in dir()` returned `True` inside the submitted block. This is the
documented `PROC PYTHON` bridge exposing SAS-side interop (submitting SAS code,
moving data between SAS datasets and DataFrames). It gives us a data-exchange
story for free and should be surfaced in docs rather than wrapped.

### Finding 3 — Tracebacks are real, and line numbers map cleanly

A deliberate `ValueError` produced a genuine Python traceback:

```
ERROR: Unhandled Python exception.
>>>
TRACEBACK_TEST
Traceback (most recent call last):
  File "<stdin>", line 5, in <module>
  File "<stdin>", line 2, in <module>
  File "<string>", line 4, in <module>
  File "<string>", line 3, in boom
ValueError: deliberate failure
```

Two frame families appear. The `<stdin>` frames are the `PROC PYTHON` harness and
are **noise to be filtered**. The `<string>` frames correspond **1:1 to lines of
the submitted Python block** — in the probe, `line 4` was `boom()` and `line 3`
was the `raise`, matching the submitted source exactly.

**Consequence.** Mapping a traceback back to editor positions is a simple fixed
offset (lines injected by our wrapper), not the fuzzy heuristic the SAS
extension needs for SAS logs. Phase 4 diagnostics are therefore cheaper and more
reliable than the SAS-side equivalent — but the plan must still carry an offset
map, because we inject wrapper lines ahead of user code.

### Finding 4 — Failure is reliably detectable

After the unhandled exception:

```
NOTE: The SAS System stopped processing this step because of errors.
NOTE: SYSCC=1012 SYSERR=1012
```

So there are three independent failure signals: the `ERROR: Unhandled Python
exception.` log line, the non-zero `SYSCC`/`SYSERR`, and the compute job's own
terminal state. The plan should key success/failure off the job state and
`SYSCC`, treating log-text matching as a fallback rather than the primary signal.

### Finding 5 — Log hygiene issues to handle

The returned log is a **SAS log**, not clean stdout, and carries artifacts that
must be stripped before display:

- **Source echo with line numbers** — every submitted line is echoed back
  prefixed with its SAS line number (`25   carried_value = 42`), including the
  `proc python;` / `submit;` / `endsubmit;` / `run;` scaffolding.
- **Page-break headers** injected mid-stream:
  `2    The SAS System    Wednesday, August 12, 2026 01:26:00 AM`.
- **REPL prompt markers** — `>>>` lines bracket the actual stdout region.
- Procedure timing NOTEs after each step.

**Consequence.** A dedicated log-to-output filter is required (Phase 3), and it
is a genuine piece of work rather than a pass-through. Setting `PAGESIZE=MAX`
should suppress most page-break headers and is worth doing at session setup; the
`>>>` markers give a reliable delimiter for the stdout region.

### Open questions this probe did *not* settle

These remain **unverified** and are carried into the plan as risks, not facts:

- Whether `PROC PYTHON` exists at all on **Viya 3.5**, and whether its state
  persistence and bridge object behave identically. No 3.5 instance is available.
- Whether the persisted Python state survives a compute **session reconnect**
  (as opposed to consecutive steps in one live session).
- How binary/rich output (matplotlib figures, DataFrame HTML) can be returned —
  the probe only exercised `print` to stdout. Candidate paths: writing to the
  session filesystem and fetching via the Compute files API, or base64 through
  the log. **This is the key Phase 3c probe target.**
- Behaviour of very large stdout volumes and whether log pagination truncates.
- Whether a long-running Python step responds to compute job cancellation
  promptly, or blocks until the step completes.

## 2026-08-13 — Identity, for the Accounts menu (Viya 4)

Run before implementing slice 1c, which needs a name and a stable id to put in
VS Code's Accounts menu. Same Viya 4 deployment as the probe above. Endpoint:
`GET /identities/users/@currentUser`, the one upstream's
`connection/rest/identities.ts` calls.

### Finding 6 — The obvious media type is wrong, and wrong is a 406

Four `Accept` values against the identical URL:

| `Accept` | Status |
|---|---|
| `application/vnd.sas.identity.user+json` | **200** |
| `application/vnd.sas.identity.user.summary+json` | **200** |
| `application/vnd.sas.identity+json` | **406** |
| `application/json` | 200, echoed back as `content-type: application/json` |

`application/vnd.sas.identity+json` is the guess the service name invites, and it
is the one that fails. The rejection is a **406**, not the 415 a request-body
mismatch would give, and it carries the SAS error envelope:

```json
{
  "errorCode": 1005,
  "message": "The value (application/vnd.sas.identity+json) for the request header field \"Accept\" does not specify a supported media type.",
  "details": ["path: /identities/users/@currentUser"],
  "remediation": "For the request header field \"Accept\", specify one of the following media types: ..."
}
```

**Consequence.** Media types get pinned by fixture, never derived from the
service name. The `{errorCode, message, details[], remediation}` envelope is the
general SAS error shape and is worth parsing once, centrally — `remediation` in
particular is server-authored user-facing text that we currently throw away.

### Finding 7 — The full representation carries PII the extension does not need

The full `…identity.user+json` representation returned sixteen top-level fields:

```
creationTimeStamp  modifiedTimeStamp  links  version  id  name  providerId
type  scimId  externalLoginIds  state  title
addresses  emailAddresses  phoneNumbers
```

The last three are the problem. In the probe they held, for a real person, a
street address with locality and postal code, a work email, and **two** phone
numbers, one of them a mobile — under `[{type, value}]` and
`[{type, street, locality, region, country, postalCode}]`.

The `…identity.user.summary+json` representation on the **same URL** returns
`200` and exactly the first twelve fields: the three PII arrays are gone, `id`,
`name`, `title`, `providerId`, `state`, and `externalLoginIds` remain.

Upstream sends **no `Accept` header at all** (axios defaults to
`application/json, text/plain, */*`), so it receives the full representation,
pulls every one of those fields into the extension host, and keeps `id` and
`name` — its `User` interface declares only those two. The rest is read,
deserialised, held in memory, and discarded.

**Consequence.** Request the summary type explicitly. It is the same request and
the same status code, and it means a user's home-adjacent address and personal
mobile number never enter our process, never reach a log line, and cannot appear
in a crash dump or a bug report attachment. This is the first concrete
data-minimisation improvement over upstream and it costs one header.

### Finding 8 — only `id` is safe to key on, and `id` is not opaque

> **Corrected 2026-08-14.** This finding was originally titled "`id` is opaque",
> on the strength of the id not being a UUID and not being the login name. That
> was an inference from two negatives, and it was wrong. Finding 25 observed the
> value directly: on this deployment the `id` **is an email address**. The
> consequence below is unaffected — `id` is still the only safe key — but
> "opaque" licensed treating it as a meaningless token, and it is not one.

Observed for the probed user, values withheld:

| Field | Shape |
|---|---|
| `id` | 17 characters, **not** a UUID, **not** the login name — an email address on this deployment |
| `scimId` | identical to `id` on this deployment |
| `externalLoginIds` | one entry, the login name |
| `name` | display name, `Given Family` |
| `providerId` | `scim` |
| `type` | `user` |
| `state` | `active` |
| `version` | `1` |

The `self` link is `/identities/users/{id}`, so `id` is the service's own handle
for the user. `scimId` equalling `id` is an artefact of this deployment being
SCIM-backed; on an LDAP-backed Viya `providerId` differs and `scimId` should not
be assumed present at all.

**Consequence.** `account.id` keys on the endpoint plus `id` — never on
`scimId`, which may be absent; never on `externalLoginIds[0]` or `name`, which
are the fields an administrator can change. `account.label` is `name`, falling
back to `externalLoginIds[0]` and then `id`. `title` is a **job title**, not a
display name, and does not belong in a label.

**Second consequence, from the correction.** Because the `id` can be personal
data, it is subject to finding 7's data-minimisation rule rather than exempt from
it: it must not be interpolated into a log line, an error message, a telemetry
field we do not have, or any value written to a server-side resource other
callers can list. Its legitimate uses are the account key VS Code holds in
memory, and the right-hand side of an `eq(owner,…)` filter, where the value goes
back to the service that issued it.

### Finding 9 — A dead token is a 401 with an empty body

Two probes, one with a syntactically invalid bearer token and one with no
`Authorization` header at all. Both returned **401 with a zero-byte body**. The
diagnosis is only in the response header:

```
www-authenticate: Bearer error="invalid_token",
  error_description="Provided token isn't active",
  error_uri="https://tools.ietf.org/html/rfc6750#section-3.1"
```

With no credentials at all the header degrades to a bare `www-authenticate: Bearer`.

**Consequence.** Any error path that builds its user-facing reason by reading the
response body gets an empty string here, and the user gets "request failed" for
the single most common recoverable failure there is. The transport must surface
**response headers** to the error mapper, and 1c must parse RFC 6750's
`error`/`error_description` out of `WWW-Authenticate` and map `invalid_token` to
"your session expired, sign in again". The presence or absence of the parameters
also distinguishes *expired* from *never sent*, which are different messages.

The user resource sends `cache-control: no-cache, no-store, must-revalidate` and
**no `ETag`**, so there is nothing to revalidate against and no conditional-GET
optimisation to reach for; ask once per session and hold the answer.

### Open questions this probe did *not* settle

- **Viya 3.5 is still unverified.** The creds file holds exactly one Viya
  deployment and it is Viya 4. `/identities/users/@currentUser` is expected to
  exist on 3.5, but neither the summary media type's availability nor the 401
  header shape has been observed there. 1c must therefore treat a 406 on the
  summary type as a **fall back to the full representation**, not a failure —
  and drop the PII fields on arrival if it ever has to.
- Whether `id` is the login name on an **LDAP-backed** provider. Likely, and
  harmless given Finding 8's rule, but it means `id` must not be assumed opaque
  in anything user-facing.
- Whether `title` and `state` are always populated. Both were here; neither is
  load-bearing, and only `id` and `name` are treated as required.

## 2026-08-14 — The first real sign-in (Viya 4)

**How this one was gathered, because it is not like the others.** Every section
above is a read-only `GET` made with `curl` under the `viya-api-probe` rules.
This one could not be: the subject is the authorization-code flow, and the
`authorize` leg only answers after a human has typed a password into SASLogon's
own page. So these findings come from driving the extension's sign-in against the
live deployment in a real browser, then reading what SASLogon rendered and what
the extension logged. Same deployment as the two probes above. Nothing was
mutated: an authorization code that is never redeemed expires unused, and the two
that were redeemed produced tokens for the signed-in user and nothing else.

Scrubbed as usual — the deployment host is written `viya.example.com` throughout,
and no code, verifier, or token appears here in any form.

### Finding 10 — The built-in `vscode` client registers `oob` and nothing else

The first sign-in failed *after* the password was accepted, which is the
expensive place to fail:

```text
Invalid redirect vscode://<publisher>.<name>/auth-callback%3FwindowId=2
did not match one of the registered values
```

Three browser probes, changing one thing each:

| `redirect_uri` sent | Result |
|---|---|
| our own `vscode://<publisher>.<name>/auth-callback…` | rejected after login |
| upstream's `vscode://sas.sas-lsp` | **rejected after login** |
| *omitted entirely* | consent page renders, code shown on screen, `urn:ietf:wg:oauth:2.0:oob` |

The second row is the one that settles it. If the built-in client had *a*
custom-scheme redirect registered and we were merely spelling ours wrong, the
extension SAS themselves ship would have worked. It does not, so the built-in
`vscode` client has **no** custom-scheme redirect at all — only
`urn:ietf:wg:oauth:2.0:oob`, the out-of-band value whose entire meaning is "show
the code to the user and let them carry it".

**Consequence.** `redirect_uri` is sent only when the profile names its own
client; on the built-in client both OAuth legs omit it, which RFC 6749 §4.1.3
requires them to agree on. The dual code capture stays, because which case
applies cannot be known until after the user has authenticated — but the paste
box is the **ordinary** route on a stock Viya 4, not the fallback, and the URI
handler only ever wins against a client an administrator registered for this
extension. Any documentation that describes pasting as a degraded mode is
wrong on the deployments most people have.

The `%3F` in that message was a second, separate defect and ours:
`vscode.env.asExternalUri` appends a `windowId` query parameter, and rebuilding
the URI through `toString(true)` percent-encoded the `?` while leaving the `=`
beside it alone. `callbackUri()` now concatenates the parsed `Uri` components
instead. It was not the cause of the rejection — the middle row of the table
proves that — but it would have been the next one.

### Finding 11 — `state` cannot smuggle the callback URL

Upstream packs the callback URL into the `state` parameter, which is the trick
that would make the `oob` restriction survivable without a paste box. It does not
work here. Tested in both encodings — the URL placed in `state` raw, and again
percent-encoded — SASLogon ignored it both times and rendered the code on the
consent page exactly as it does with no `state` at all.

**Consequence.** There is no route back into the editor on the built-in client,
which is what makes finding 10's paste box load-bearing rather than a nicety. It
also settles a question the 1c-i review raised: because `state` carries no
routing information, it is free to be what RFC 6749 §10.12 wants it to be — a
random nonce that is checked and discarded. The check costs nothing on the `oob`
path, where no callback arrives at all, and is a real CSRF defence on a
registered-redirect path.

### Finding 12 — SASLogon echoes the PKCE verifier back in `error_description`

A failed `authorization_code` exchange produced this, and the extension logged it
verbatim:

```text
the deployment rejected the sign-in: invalid_grant (Invalid code verifier: <the verifier, in full>)
```

`error_description` is quoted into our log by design — RFC 6749 §5.2 specifies it
as a human-readable diagnostic, and it is the most useful string in the whole
flow. But the deployment is free to put our own request back inside it, and here
it does. RFC 7636 §4.1 makes the `code_verifier` a secret; the log is a file
people attach to bug reports.

The exposure from this instance is small — a verifier is single-use and the
attempt it belonged to had already failed — but the same behaviour on the
`refresh_token` grant would quote a **refresh token**, which is long-lived and is
the whole session.

**Consequence.** The scrub is applied inside the token endpoint's `post`, so both
grants get it without a caller remembering to ask: every value the request
carried that is not `client_id`, `grant_type`, or `redirect_uri` is replaced with
`[redacted]` in the failure before it is returned. `redirect_uri` is deliberately
exempt — it is public by construction, and its echo is what produced finding 10.
Dropping `error_description` instead would have traded one leak for permanent
blindness.

### Open questions this probe did *not* settle

- **Whether any Viya 4 registers a custom-scheme redirect on the built-in
  client.** One deployment was observed. A deployment whose administrators added
  one would take the URI-handler arm, which is why the race is kept rather than
  deleted, but nothing here proves such a deployment exists.
- **Whether SASLogon echoes the refresh token** the way it echoes the verifier.
  Not provoked: doing so means deliberately corrupting a live refresh token, and
  the scrub is written to assume it does either way.
- **Viya 3.5, again.** No deployment is reachable, so neither the `oob`
  registration nor the `state` behaviour has been observed there.

