# ADR-0008 — Auth core: a `fetch`-shaped transport port, and the security deltas from upstream `auth.ts`

- **Status:** Accepted
- **Date:** 2026-08-13
- **Decides:** how this project makes HTTP requests, and which parts of upstream's
  `auth.ts` are ported as-is versus deliberately changed
- **Executed in:** slice 1b-i (`src/auth/pkce.ts`, `src/auth/tokenEndpoint.ts`,
  `src/auth/clientId.ts`), with the shell following in 1b-ii
- **Amended in slice 1b-ii, 2026-08-13:** the port survives; its *default
  implementation* does not. It is no longer `globalThis.fetch` but
  `nodeHttpTransport` in `src/auth/transport.ts`, over `node:https`. The
  question this ADR left open — dependency, hand-rolled tunnel, or narrowed
  support — is closed by a fourth answer it did not consider, and none of the
  three is taken. See the amended entries under Alternatives and Consequences;
  the type is now named `HttpTransport` rather than `FetchLike`.
- **Amended in slice 5d-i, 2026-09-02:** the `agent` seam this ADR left unset
  is now used. `src/auth/caAgent.ts`'s `buildCaAgent` reads
  `pythonOnViya.userProvidedCertificates`, builds **one dedicated
  `https.Agent`** from Node's bundled roots plus those certificates, and
  `src/extension.ts` threads a transport carrying it through the auth provider
  (`token`/`identity` deps) and the compute session manager (`transport` dep).
  Two corrections to the reasoning below come with it: upstream is not
  TLS-code-free — `client/src/components/CAHelper.ts`'s `installCAs()` sets
  `https.globalAgent.options.ca` at activation — and that process-global write
  is exactly what the dedicated agent is *not*, since `https.globalAgent` is
  shared with every other installed extension and a test of ours could never
  catch a change to it. This is the scoped version of the job slice 1c-ii
  ([phase-1.md](../phases/phase-1.md)) specified and deferred. `machine`
  config scope, so a checked-in workspace settings file cannot widen TLS trust.

## Context

Slice 1b ports authentication from `sassoftware/vscode-sas-extension`. The file is
`client/src/connection/rest/auth.ts`, 145 lines, and it does four things: mint a
PKCE pair, open a browser at SASLogon's `/oauth/authorize`, capture the returned
authorization code by two racing mechanisms, and exchange it at `/oauth/token`.

Two questions had to be answered before writing any of it, and they are related.
The first is what makes the HTTP request, because upstream uses `axios` and this
repository currently has no runtime dependencies at all. The second is which of
upstream's choices are load-bearing and which are defects that a straight port
would inherit — the plan's standing rule for security-relevant files is to audit,
not transcribe.

## Decision

### No HTTP client dependency; the core takes an injected `fetch`-shaped port

`package.json` declares no runtime dependencies at all — there is no
`dependencies` key, not an empty one — and that is not an accident of a young
project. Slice 0d spent most of its effort on the dependency tree: every package
that can run code at install time is denied through `allowScripts`, an audit gate
fails on any advisory in the production tree at any severity, and a unit test
reads `package-lock.json` to catch the deny-list drifting. All of that machinery
is cheap to run precisely because the production tree is empty. `axios` would be
the first entry in it, and the first thing that could ever trip the production-tree
audit gate.

It is also unnecessary. The engine floor is Node `>=20.19.0`, so `globalThis.fetch`
exists; msw 2 — already the project's HTTP mocking layer — intercepts `fetch`
natively.

> **Amended 2026-08-18.** The floor is `>=22.18.0` now
> ([ADR-0018](0018-the-node-baseline.md)). The argument is unaffected — it only
> ever needed a floor at or above 18, and raising one cannot take `fetch` away.

So `src/auth/tokenEndpoint.ts` declares a minimal structural type covering only the
parts of `fetch` it uses, defaults it to `globalThis.fetch`, and accepts an
override. Nothing else in the core touches the network. The point is not
primarily testability — msw would have given us that anyway — it is that the
seam is where 1b-ii attaches proxy support, and where any future retry or
telemetry wrapper attaches too, without any of them reaching into the crypto.

> **Amended in 1b-ii.** The reasoning above stands and the seam did its job — but
> the default behind it is now `nodeHttpTransport` over `node:https`, and the type
> is `HttpTransport`, named for the role rather than for the API that used to fill
> it. Nothing above about the dependency posture changes: the production tree is
> still empty. msw intercepts `ClientRequest` as well as `fetch`, so the mocking
> layer was unaffected by the swap. The full reasoning is in the module
> documentation of `src/auth/transport.ts` and in Consequences below.

### The five deltas from upstream

Ported unchanged: the endpoint paths, the form-encoded request bodies, the
`client_secret`-in-body style (SASLogon's UAA accepts it, and HTTP Basic would
carry the same secret over the same channel), and the dual code capture, which is
a genuine and well-judged accommodation for deployments with no registered
redirect URI.

Changed, with reasons:

**The code verifier uses a CSPRNG.** Upstream builds a 128-character verifier by
calling `Math.random()` once per character against a 66-character alphabet.
`Math.random()` is not cryptographically secure — V8 seeds an xorshift128+ from a
predictable source and its output has been publicly reversible from a handful of
samples for years — and RFC 7636 §4.1 requires the verifier to be generated with a
"cryptographically secure random number generator". A predictable verifier defeats
the entire point of PKCE: an attacker who intercepts the authorization code can
also produce the verifier and redeem it. We use
`randomBytes(32).toString("base64url")`, which yields 43 characters inside the
43–128 range the RFC allows, is uniform, and lands in the unreserved character set
by construction rather than via an alphabet table that has to be inspected.

**`state` is random, and it is validated.** Upstream sets `state` to the
URL-encoded callback URI and never looks at it again; `handleUri` pulls `code`
from whatever URI arrives and accepts it. A `vscode://` URI handler is not a
private channel — anything on the machine that can ask the OS to open a URI can
reach it — so an attacker who can induce a callback can inject their own
authorization code and have the victim's extension exchange it, binding the
victim's editor to the attacker's account. This is the injection RFC 6749 §10.12
describes. The core mints `state` from the same CSPRNG as the verifier; 1b-ii
compares it and drops any callback that does not match.

Worth stating plainly, because it limits the fix: **the paste-box arm cannot be
protected this way.** A code a user pastes in by hand carries no `state`, so the
guarantee is only as strong as the arm the code arrived on. That is an argument
for narrowing the paste box later, not for skipping the check on the arm where it
does work.

**base64url comes from Node.** Upstream chains three `.replace()` calls over a
base64 digest. `.digest("base64url")` has been available since Node 15 and is not
a place to keep hand-written string surgery on a security path.

**`expires_in` is kept.** Upstream discards it, which leaves it no way to know a
token has expired except to spend a request discovering it — `refreshToken()`
calls `headersForRoot()` on every invocation purely to see whether it returns 401.
We convert `expires_in` to an absolute `expiresAt` when the response is read and
refresh ahead of it. A 401 from a real request stays as a fallback for clock skew
and server-side revocation; it stops being the primary mechanism.

**The OAuth error envelope is parsed.** `error` and `error_description` are
specified fields, and upstream drops both inside an axios rejection. They are the
difference between "the deployment says `invalid_client`" and a stack trace.

### The Viya 3.5 client-id path ships unverified, and says so

Decision 9 has the extension fall back to the built-in `vscode` client on Viya 4
2022.11+, and require an explicit id and secret on 3.5 and Viya 4 2022.10 and
earlier. The 3.5 half is built from SAS's documented behaviour for their own
extension. No Viya 3.5 deployment is available to this project, so it has not been
observed, and this is recorded rather than left implicit — in `PRODUCTION_PLAN.md`
decision 9, here, and in a comment on the code path itself.

Calling it a release blocker was considered and rejected: a blocker nobody can
clear is a line everyone learns to step over, and it would decay into a false
signal. The exposure is bounded and it is worth naming — if the documentation is
wrong and 3.5 does have a built-in client, the consequence is that a 3.5 user is
told to obtain a client id they did not need. That is a poor message, not a broken
flow and not a weakened one.

## Alternatives considered

**Use `axios`, as upstream does.** Rejected. It buys request/response interceptors
and automatic proxy handling from environment variables, neither of which is worth
becoming the sole occupant of a production dependency tree that the supply-chain
gates currently keep empty. The proxy convenience is real and is the honest cost
of this decision — see Consequences.

**Use `undici` directly as a dependency.** ~~Not rejected — deferred to 1b-ii,
where the proxy work lives and where it can be decided with the code in front of
us.~~ **Rejected in 1b-ii.** `undici` would buy a `ProxyAgent` and nothing else,
and `node:https` reaches the same outcome for free — better, in fact, because it
also reaches the certificate store, which a dispatcher does not. Paying a runtime
dependency for a subset of what the standard library already offers is not a
trade worth making, and it would have been the first entry in a production tree
the 0d gates are cheap to run precisely because it is empty.

**Have the core call `globalThis.fetch` with no injection point.** Rejected. It
would work for tests, since msw intercepts globally, but it leaves 1b-ii nowhere to
attach the proxy dispatcher except by mutating global state — which is exactly the
kind of action-at-a-distance that makes a proxy bug impossible to reason about.

**Port `auth.ts` as-is and fix the verifier only, as the plan originally said.**
Rejected once the file was actually read. The missing `state` validation is at
least as serious as the weak verifier, and it would have shipped silently because
the plan had already named the one defect it knew about — which is a good
illustration of why "audit, don't transcribe" has to mean reading the whole file
rather than confirming the finding you arrived with.

## Consequences

The production dependency tree stays empty, so the audit gate keeps its
any-severity posture and the install-script deny-list has nothing new to cover.

**~~Proxy support gets harder, and this is the real cost — possibly a dependency
after all.~~ Closed in 1b-ii without a dependency.** What this ADR recorded as an
open cost was accurate about `fetch` and wrong about the size of the choice.
`axios` honours `HTTP_PROXY` and `HTTPS_PROXY` out of the box; Node's `fetch`
ignores them entirely, and routing it through a proxy needs an undici
`ProxyAgent` — not public API on this project's engine floor of `>=20.19.0`, so
it means the `undici` package, installed. Node 24 grew built-in environment-proxy
support, which does not help here either — and note that raising the floor to
22.18.0 in 2026-08 ([ADR-0018](0018-the-node-baseline.md)) does not change that
either, since 22 is below 24 and the `node:https` path 1b-ii took makes the
question moot in any case. All of that still holds. The error was
framing the alternatives as dependency, hand-rolled `CONNECT`, or narrowed
support, when a fourth option sat in the standard library.

1b-ii takes it: `nodeHttpTransport` issues the request through `node:https`, and
the port's default changes from `globalThis.fetch` to that. No dependency, no
tunnel, no narrowing.

**The evidence is a consequence, not a mechanism, and that distinction is
load-bearing here.** Upstream `vscode-sas-extension`'s REST client is
`axios.create({ baseURL })` and nothing else — no proxy code, no TLS code — and
it works inside enterprises behind proxies and behind internal certificate
authorities. `axios` issues its requests through `http`/`https`. Extensions that
call `fetch` are a recurring proxy complaint; extensions that go through the
`http` modules are not. That asymmetry is observable and reproducible. The
*mechanism* by which the host arranges it — which settings patch what, and when —
was not verified against documentation and is deliberately not asserted here.
(Upstream does carry one piece of TLS code outside the client:
`CAHelper.ts`'s `installCAs()`, run at activation, sets
`https.globalAgent.options.ca` — the process-global write the 2026-09-02
amendment above replaces with a dedicated agent.)

**The certificate half matters more than the proxy half, and it is why this is
not merely a cheaper way to reach the same place.** A corporate proxy is the case
that started the question; an internal CA is the case that would have hurt more.
Enterprise Viya routinely presents a certificate from one, and a transport that
does not consult the operating system trust store fails such a deployment at
sign-in with a TLS error, before any code in `src/auth/` runs — reported, in
practice, as "the extension cannot connect to my Viya". No `ProxyAgent` would
have fixed that.

Two smaller consequences follow. Redirects are no longer followed, which is the
safer default rather than a gap: the request body carries a client secret and
either an authorization code or a refresh token, and a 3xx now reaches the caller
as a diagnosable non-`ok` response instead of being replayed at a location the
server named. And an `agent` option now exists on the request and was left unset
— the seam for an explicitly configured proxy or CA bundle, which the `fetch`
path could not have offered without the dependency this rejects. Slice 5d-i
(2026-09-02 amendment above) fills it for the CA-bundle case.

The port is a structural type, not an interface anyone implements, so this
change — the one it was built for — touched one seam plus its test doubles.

1b-i is fully unit-testable with no editor and no network: PKCE against RFC 7636's
own Appendix B test vector, the token endpoint against msw, and the client-id
resolution as pure logic. The corresponding gap is that nothing about the browser
handoff, the URI handler, or the race is covered until 1b-ii — the shell is where
the untested surface now concentrates, and it should be kept as thin as the
profile store was in 1a.
