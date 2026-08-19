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

## 2026-08-14 — The Compute service (Viya 4)

The wire shapes slice 2a is written against. Findings 13 to 17 were re-run
read-only while writing `src/compute/`, and every payload below is copied from
that run with the context ids replaced; findings 18 to 20 come from the session
probe earlier the same day and are marked where a detail was not re-captured.

Two deployment-level observations, neither of which needed a finding of its own.
**TLS verified** — every request in this section ran without `curl -k`, against
the deployment's own certificate. And a **CSRF token is issued but not required**:
responses carry `x-csrf-header: X-CSRF-Token` and `x-csrf-token: …`, and no
request here sent one back. Bearer callers are exempt, which is what lets the
client stay stateless.

### Finding 13 — Hrefs are root-relative, already carry `/compute`, and repeat in `uri`

Every link in every representation observed:

```json
{
  "method": "POST",
  "rel": "createSession",
  "href": "/compute/contexts/CONTEXT-ID/sessions",
  "uri": "/compute/contexts/CONTEXT-ID/sessions",
  "type": "application/vnd.sas.compute.session.request",
  "responseType": "application/vnd.sas.compute.session"
}
```

No absolute URL appeared anywhere, and `href` and `uri` were identical in every
link seen. The service prefix is **already in the href**, which is the fact
behind upstream's `link.href.replace("/compute", "")`: upstream stores a base
that ends in `/compute`, so it has to cut the prefix back off every href it
follows. Storing the deployment root and concatenating deletes the cause instead
of patching the effect.

**Consequence.** `resolveHref` joins the normalised endpoint to the href by
concatenation and refuses anything that is not root-relative — a protocol-relative
`//host/…` would send the bearer token to a host the deployment named.

### Finding 14 — `links[].type` omits the `+json` suffix, and is absent rather than `null`

The media type in a link is the **essence without the structured suffix**:
`application/vnd.sas.compute.session.request`, where the header the service
accepts is `application/vnd.sas.compute.session.request+json`. Sending the link's
value verbatim as `Content-Type` is a 415.

A link that has no media type **omits the key**. Across all 13 contexts and every
link on each, the key sets were exactly three:

```text
href+method+rel+uri                            (delete)
href+method+rel+type+uri                       (self, alternate)
href+method+rel+responseType+type+uri          (createSession)
```

**Correction to an earlier reading.** An earlier note recorded `type` as
arriving "as a string, `null`, or absent on the same logical link". That was a
`jq` artifact: projecting `{rel, type}` prints `"type": null` for a key that is
not there. Re-checked with `has("type")`, **no explicitly-null `type` was
observed on this deployment**. `readLinks` still accepts `null` — JSON permits
it, the cost is one union member, and a media type of `null` and one that is
absent mean the same thing to us — but it is defensive breadth, not an
observation.

### Finding 15 — One filtered call resolves a context, and the escape for an apostrophe is doubling it

`GET /compute/contexts?filter=eq(name,'SAS Job Execution compute context')`
returns the summary item **already carrying a fully-formed `createSession`
link** (finding 13's payload is that link). Upstream follows this with
`GET /compute/contexts/{id}` before creating a session; that second call is
unnecessary.

The filter is a query parameter, so the whole expression is percent-encoded on
the way out. The service echoes it back in its `self` link, encoded its own way:

```json
"href": "/compute/contexts?start=0&limit=10&filter=eq%28name%2C%27SAS+Job+Execution+compute+context%27%29"
```

Three spellings of a name containing an apostrophe were tried, since upstream
interpolates the name into the filter with no escaping at all:

| Filter | Result |
|---|---|
| `eq(name,'O''Brien')` | **`200`**, `count: 0` — a well-formed query for a context that does not exist |
| `eq(name,'O\'Brien')` | `400`, `errorCode` 1104, *"The filter … is not valid."* |
| `eq(name,'O'Brien')` | `400`, `errorCode` 1104, same message |

**Consequence.** Doubling the quote is the escape. A backslash is not, and the
unescaped form is a `400` — so a context whose name contains an apostrophe breaks
upstream's query outright. `src/compute/contexts.ts` doubles it before encoding,
and there is a test that says so.

### Finding 16 — `count` is `null` exactly when the collection is truncated

The deployment has 13 compute contexts. Varying only `limit`:

| Request | `count` | `items` | `next` link |
|---|---|---|---|
| `?limit=2` | `null` | 2 | present |
| `?limit=12` | `null` | 12 | present |
| `?limit=13` | `13` | 13 | absent |
| `?limit=14` | `13` | 13 | absent |
| `?start=10&limit=10` | `null` | 3 | absent (`collection`, `first`, `prev`, `self`) |

So `count` is a real number **only when the page already holds everything**, and
`null` in every case where a pager would actually need it — including the last
page of a traversal, which has no `next` and still reports `null`. A filtered
collection that fits on one page does report a count (`count: 1` for the query in
finding 15).

**Consequence.** Page on the presence of the `next` link and treat `items` as
authoritative. Nothing may branch on `count`: read as a number it is `0`, and
"there are no compute contexts" is the one answer that is never true.

### Finding 17 — The error envelope is `application/vnd.sas.error+json`

A malformed filter, verbatim but for the correlator:

```json
{
  "message": "Bad Request",
  "errorCode": 1104,
  "httpStatusCode": 400,
  "version": 2,
  "details": [
    "The filter 'eq(name,'O'Brien')' is not valid.",
    "path: /compute/contexts",
    "correlator: 00000000-0000-4000-8000-000000000000"
  ]
}
```

Sent as `content-type: application/vnd.sas.error+json;charset=utf-8;version=2` —
note the **`version` parameter on the media type**, which any content-type
comparison has to tolerate.

`details` mixes one human sentence with two machine entries under `path:` and
`correlator:` prefixes. The correlator is what SAS support asks for. The `path:`
entry is our own request reflected back, and `readViyaError` drops it rather than
quoting it.

### Finding 18 — A session is created with `201` + `Location` + `ETag`, and dies after 900 idle seconds

From the session probe. `POST` to a context's `createSession` link answered
**`201`** with a `Location` header — root-relative, like every other href — and an
`ETag`. The session arrives in state `pending`, carrying the links everything
else navigates by, and `attributes.sessionInactiveTimeout` is **`900`**.

`DELETE` on the session's `delete` link answered **`204`, with no `If-Match`
sent**. Upstream attaches that header unconditionally; it is not required, and an
ETag we are not sure of turns a working teardown into a `412` that leaves a SAS
process running until the fifteen minutes elapse.

Fifteen idle minutes is short enough that session death is **routine rather than
exceptional** — it is what happens over lunch, and 2a-ii treats it as a
recoverable event rather than an error.

### Finding 19 — The session state resource is a real server-side long poll

`GET …/state?wait=5` with a matching `If-None-Match` held the connection and
answered **`304` after exactly five seconds**. The wait is honoured server-side.

Upstream declares this option and never passes it, polling the *log* endpoint
instead — which conflates "has it finished" with "is there more log", and is why
`ComputeJob.getState()` recurses under its author's own comment *"This is bad. We
need to cache the last state value."*

**Consequence.** One round trip per window, no `setTimeout`, and the poll takes
an abort signal so 2a-ii has somewhere to attach a `CancellationToken`.

### Finding 20 — The log is a paged collection of typed lines

The job log is not a blob. It is a collection whose items carry a line's text and
its **type**, which is what makes it possible to tell a `NOTE:` from an `ERROR:`
without parsing prefixes out of a string. Finding 16's paging rule applies to it
like any other collection.

*Superseded in detail by findings 47–52 (2c-pre), which enumerate the item's
three fields, the four `type` values, and the paging and long-poll behaviour.
The sentence above is right but stops well short of what a client needs — in
particular `note` turns out to be a catch-all, so "tell a `NOTE:` from an
`ERROR:`" is true of `error` and misleading about `note`.*

### Finding 21 — The session representation carries 22 links, and they are the whole API

Probed 2026-08-14 while writing `src/compute/session.ts`, which needed to know
whether a session is navigated by link relation or by composed path. One throwaway
session was created in the SAS Studio compute context, dumped, and deleted in the
same call. The scrubbed payload is
`test/fixtures/viya4/compute-session-created.json`.

`POST` returned `201` with
`content-type: application/vnd.sas.compute.session+json; charset=utf-8; version=2`
— note the **spaces after the semicolons**, where the error type in finding 17 has
none, so a comparison that is not parameter-tolerant fails on one or the other —
plus a root-relative `Location` and an `etag` — written `"<etag-1>"` here and
below, where both occurrences stood for the same ten-character opaque validator
the server returned for that one throwaway session.

Top-level keys: `applicationName`, `attributes`, `creationTimeStamp`,
`description`, `environment`, `id`, `links`, `name`, `owner`, `serverId`,
`serviceAPIVersion`, `sessionConditionCode`, `state`, `stateElapsedTime`,
`version`. `attributes` is `{homeDirectory, sessionInactiveTimeout: 900}`. The id
is a UUID with a `-ses0000` suffix. `applicationName` is **the OAuth client id**
and `owner` is the user's email address — both scrubbed in the fixture.

The 22 relations, which is the entire session API and the reason nothing below
2a-i needs a URL builder:

| rel | method | href tail | type |
|---|---|---|---|
| `self` / `alternate` | GET | `` | `…compute.session` / `.summary` |
| `state` | GET | `/state` | `text/plain` |
| `cancel` | PUT | `/state?value=canceled` | *(no `type` key)* |
| `delete` | DELETE | `` | *(no `type` key)* |
| `execute` | POST | `/jobs` | `…job.request` → `…job` |
| `jobs`, `log`, `listing`, `results`, `variables`, `engines`, `formats`, `informats`, `librefs` (`/data`), `files` (`/filerefs`) | GET | various | `…collection`, plus an `itemType` key |
| `assign` | POST | `/filerefs` | `…fileref.request` → `…fileref` |
| `getFiles` | GET | `/files` | `…file.properties` |
| `getOption` / `updateOption` | GET / PUT | `/options/{optionName}` | `text/plain` |
| `logAsText` / `listingAsText` | GET | `/log`, `/listing` | `text/plain` |

Three consequences beyond "the links are there".

**`cancel` is a link, and it already carries its query.** Upstream builds this
call by hand — `setState(ComputeState.Canceled)` with an `If-Match`, retrying on
`412` by recursing into itself without a bound. The deployment hands us
`PUT …/state?value=canceled` ready to follow. It is also the one observed href
with a query string, which is why appending `?wait=N` to a *different* href has to
test for one rather than assume none.

**`getOption`'s href is an un-expanded URI template**: `/options/{optionName}`,
braces and all. It is the first href seen that cannot be followed verbatim, so
ADR-0010's "follow what the service sends" needs the qualifier that a templated
href is expanded first — and the brace-free ones are still never rewritten.

**Collection links carry an `itemType` key** that `readLinks` ignores. Harmless,
recorded so the next person does not think the fixture is truncated.

The state resource answered `200`, `content-type: text/plain;charset=UTF-8`, body
`pending` — **7 bytes, no trailing newline** — and `etag: "<etag-1>"`, byte for
byte the ETag the create call returned. So the session ETag and the state
validator are the same value at creation, which is what makes finding 19's
`If-None-Match` poll work from a freshly created session. `DELETE` on the `delete`
link answered `204` with no `If-Match`, confirming finding 18 a second time.

### Open questions this probe did *not* settle

- **What a reaped session answers.** Finding 18 gives the timeout but the probe
  did not wait one out, so whether a dead session replies `404`, `401`, or
  answers normally having lost its state is unobserved. 2a-ii treats all three
  alike for that reason.
- ~~**Whether `type` is ever explicitly `null`** on a representation other than a
  context.~~ **Answered by finding 21 for sessions and by finding 46 for jobs,
  and the two do not agree.** A session's `cancel` and `delete` links **omit the
  key**, exactly as context links do; a *job's* `cancel` and `delete` links set
  it to **`null` explicitly**. Both forms mean "no representation involved", and
  a client must treat absent and null alike — a contract that types the media
  type as a required string is rejected by a real Viya response.
- ~~**Whether `count` behaves the same way on the session and log collections.**~~
  **Answered for the log by finding 47:** it is a live running total that moved
  10 → 11 → 12 across three polls of a running job, and it was never `null`.
  Session collections remain unvaried. The rule "trust `next`, not `count`" is
  written to be safe either way and stays — on a running job `count` is stale the
  moment it is read, which is a second reason not to lean on it.
- **Viya 3.5.** Still unreachable, so none of the above is confirmed there. The
  link-driven navigation is what makes that survivable: a 3.5 deployment that
  spells an href differently is followed, not fought.

## 2026-08-14 — Filter literals, in answer to a review question (Viya 4)

Review of the 2a-i pull request asked whether the apostrophe is really the *only*
character `quoteFilterValue` has to escape, since a filter value also travels
through the `(` `)` `,` that give `eq(name,…)` its structure. Finding 15 had only
ever tried the apostrophe, so the question was fair and the answer was assumed.
It is now measured. Read-only `GET /compute/contexts` throughout, TLS verified.

### Finding 22 — Inside a quoted literal, the apostrophe is the only special character

Every value below sits inside `eq(name,'…')` and is percent-encoded on the way
out by `curl --data-urlencode`, exactly as `contextsLink` encodes it:

| Value inside the quotes | Result |
|---|---|
| `zzz-no-such-context` (control) | `200`, 0 items |
| `zzz)no-such` | `200`, 0 items |
| `zzz(no-such` | `200`, 0 items |
| `zzz,no-such` | `200`, 0 items |
| `zzz"no-such` | `200`, 0 items |
| `zzz no-such` | `200`, 0 items |
| `zzz\no-such` | `200`, 0 items |
| `a),b(` | `200`, 0 items |
| `zzz'no-such` (bare apostrophe) | **`400`**, `errorCode` 1104 |

A `200` on its own is weak evidence: a parser that mis-read the literal and
matched nothing looks identical to one that read it correctly and matched
nothing. So each punctuation literal was also composed with a term that *does*
match, in both orders, so that a parser which ended the literal early or split on
the comma could not still return the right answer:

| Filter | Result |
|---|---|
| `eq(name,'SAS Studio compute context')` | `200`, **1 item**, that name |
| `or(eq(name,'a),b('),eq(name,'SAS Studio compute context'))` | `200`, **1 item**, that name |
| `or(eq(name,'x,y'),eq(name,'SAS Studio compute context'))` | `200`, **1 item**, that name |
| `or(eq(name,'x''y'),eq(name,'SAS Studio compute context'))` | `200`, **1 item**, that name |
| `or(eq(name,'SAS Studio compute context'),eq(name,'a),b('))` | `200`, **1 item**, that name |
| `contains(name,'o), (c')` | `200`, 0 items |
| `contains(name,'Studio')` | `200`, **1 item** |

The structural characters are therefore consumed as ordinary text once the
literal is open, and the closing apostrophe is what ends it — which is why a bare
apostrophe is the one failure in the table. One further check, so that "doubling
works" is not confused with "`''` is ignored":
`eq(name,'SAS Studio'' compute context')` returns `200` with **0 items**. A
doubled apostrophe decodes to exactly one character, and one that the real name
does not contain.

**Consequence.** `quoteFilterValue` escaping only `'` is correct rather than
merely untested, and it is now recorded as measured. Note what this finding does
**not** license: the value must still be percent-encoded afterwards, because `&`
and `#` end a query parameter in the URL long before the filter parser sees them.
The two escapes are separate, they compose in one order only, and finding 15
already fixes that order.

## 2026-08-14 — Session lifecycle, before wiring the reconnect path (Viya 4)

Slice 2a-ii has to decide where a session id is persisted, and that decision
turns entirely on what a *stale* id costs: whether a dead session can be told
from a live one, whether an abandoned session can be found again without one, and
whether anything about a session is worth keeping across a window reload. None of
that is observable from a `GET`, so this is the first **mutating** probe in this
file. Three throwaway sessions were created in the SAS Studio compute context,
each named `python-on-viya/probe`, each deleted in the same shell call under a
`trap`, and the deletes were confirmed `204`. TLS verification was disabled for
the probe only.

Values below are scrubbed: the deployment's identity ids are email addresses, so
one is written `user@example.com`, and the OAuth client id is written
`<oauth-client-id>`.

### Finding 23 — A session settles to `idle`, not to `running`

`POST` to the context's `createSession` link answered **`201` in 6.4 s** in state
`pending`, and reached its settled state at roughly **7 s**. That settled state is
**`idle`**. A session is `running` only while a job is executing in it (finding
27), so "the session came up" and "the session is busy" are different words, and
the plausible guess — wait for `running` — would wait forever.

This is the finding `src/compute/session.ts` was written blind against, and it
survives it. `waitWhilePending` names only `PENDING_STATE` and waits for that to
*end*, handing the caller whatever came next rather than testing for a state name
we had never seen. The comment in that module — *"A list of state names we have
never seen would look like knowledge"* — is now the reason the code is right
instead of the reason it is cautious. **Do not** add `idle` as an awaited value;
add it, if anywhere, as a documented observation.

### Finding 24 — `name` and `description` are accepted at create, and `name` is filterable

The session request body took `name` and `description`, and both came back on the
created resource. The response also carried an `applicationName`, which this probe
did not send: it is the **OAuth client id of the token**, not anything the caller
chose. Filtering the collection then behaved:

| Filter over `/compute/sessions` | Result |
|---|---|
| `eq(name,'python-on-viya/probe')` | matched, count 1, our id |
| `eq(name,'python-on-viya/no')` | `200`, 0 items |
| `contains(name,'python-on-viya')` | matched, our id |
| `and(eq(name,…),eq(state,'running'))` | `200`, 0 items (the session was `idle`) |

Per finding 22's standard, each positive row was checked against a session known
to exist, not merely for a `200`. Summary items in that collection carry
`["id","links","name","owner","version"]` — no `state`, so the state a filter can
match on is not a field the summary hands back.

**Consequence.** A session this extension created is *self-identifying* on the
server. That is what makes reclaim-by-listing possible at all, and it costs one
string at create time.

### Finding 25 — `owner` is the identity `id`, and here that id is an email address

The created session's `owner` compared **equal** to the `id` from
`GET /identities/users/@currentUser`, and
`and(eq(owner,'user@example.com'),eq(applicationName,'<oauth-client-id>'))`
returned exactly our session. So the reclaim filter needs no extra lookup beyond
the identity call slice 1c already makes, and it can be narrowed to sessions this
extension started rather than every session the user owns — including the ones
SAS Studio left behind.

Two cautions, both load-bearing:

**The listing is not caller-scoped.** `GET /compute/sessions` under this token
returned other people's sessions. The token is an administrator's, so this may be
a privilege artefact rather than the general case, but the client must not treat
the collection as "mine" — the `owner` term is doing real work, not decoration.

**The `id` is personal data on this deployment.** It is an email address. That
contradicts the framing of finding 8, corrected there. It also means a session
`name` built from the identity id would publish a user's email into a
server-side resource that other callers can list — so the marker in `name` must
be a constant, and the *user* narrowing must come from `owner`, which the server
already knows and did not learn from us.

### Finding 26 — Session names are not unique, and nothing pretends otherwise

Creating a second session with the identical `name` returned **`200`** with a
distinct id, and `eq(name,…)` then matched **2**. There is no uniqueness
constraint and no conflict status to catch.

**Consequence.** Reclaim-by-listing must be written for *n* matches, not one: a
crashed window, a second window, and a reload all leave candidates behind. Taking
"the first item" would be a coin flip between a live session someone is using and
an abandoned one. Whatever 2a-ii does here has to be a stated rule.

### Finding 27 — The session state moves while a job runs, and lags the job at the end

Sampled through an 8-second `PROC PYTHON` step:

| t | session state | job state |
|---|---|---|
| +1 s | `running` | `running` |
| +4 s | `running` | `running` |
| +8 s | `running` | `running` |
| +12 s | `running` | **`completed`** |
| +15 s | `idle` | `completed` |

The job reached `completed` while the session was still `running`, and the
session returned to `idle` a few seconds later. Submitting the job answered
**`201`** with the job in state `pending`, carrying link relations
`self, state, cancel, delete, log, logAsText, listing, listingAsText, results, up`.
The log came back as 23 typed lines (`normal`, `note`, `source`), with the
`print` output present as `normal` lines separate from the `source` echo — finding
20, re-confirmed on a Python step.

**Consequence.** Completion is a property of the **job**, and the run path must
poll the job's state resource. Watching the session for `idle` would report a run
finished two to three seconds late and would be actively wrong the moment a
second job is submitted. The session state is still the right signal for a
different question — *is this session alive and free* — which is exactly the
question reconnect asks.

### Finding 28 — The long poll needs `If-None-Match`; `wait` alone does nothing

Finding 19 measured the session state holding for `wait=5` and answering `304`.
Two extensions, both measured on a job that slept 12 seconds:

| Request | Result |
|---|---|
| job state, plain `GET` | `200` in 0.3 s, `running` |
| job state, `?wait=6`, **no** `If-None-Match` | `200` in **0.3 s**, `running` |
| job state, `?wait=20` **with** `If-None-Match` | `200` in **12.96 s**, `completed` |
| session state, `?wait=8` with `If-None-Match`, session idle | `304` after 8.3 s |

So `wait` is not a sleep. Without a validator the server has nothing to compare
against and answers immediately; with one it holds until the value changes and
**releases at the moment of change**, not at the end of the window — 12.96 s for
a 12-second step. The `wait` is a ceiling, and a `304` on expiry is the signal to
poll again with the same ETag.

**Consequence.** A run costs about one request per `wait` window plus one at
completion, and the completion latency is a network round trip rather than a
polling interval. Sending `wait` without `If-None-Match` would silently degrade
into a hot spin — the request looks correct and returns `200` every time — so the
two belong together in one call site, not as independent options a caller can
mix. The session-state variant answers `304` where the job-state variant answered
`200` with a changed body, so both arms have to be handled.

### Finding 29 — A dead session answers `404` to everything, and a stale id cannot be diagnosed

After `DELETE` returned `204`, three requests against the same session:

| Request | Result |
|---|---|
| `GET` the session's `self` href | **`404`**, `errorCode` **5837** |
| `GET` its `state` | **`404`**, `errorCode` **5837** |
| `POST` a job to its `jobs` href | **`404`**, `errorCode` **5837** |

The body is the standard error envelope, with `details[]` naming the session id
and the path. A well-formed but **invented** session id — never created, never
deleted — returns the same `404` and the same `5837`.

**Consequence, and it is the one 2a-ii turns on.** *Gone* is a single, uniform,
cheap answer on every verb, so a stale id costs exactly one failed round trip and
needs no probing before use: attempt, catch the `404`, create a new session. That
is the whole recovery path. But the server cannot tell us *why* it is gone —
expired at 900 s, deleted by an administrator, lost with the compute node, or
never ours to begin with are one status code. So no message we write may claim a
reason, and the code must key on the **status**, not on `errorCode` 5837, which is
an undocumented internal number that costs nothing to stop matching on now and
would cost a debugging session to discover had changed.

### What this probe did not settle

- **A reaped session.** Every `404` here followed an explicit `DELETE`. A session
  that died on its own at 900 idle seconds is *assumed* to answer identically and
  was not waited out. The assumption is cheap to hold — the recovery path is the
  same either way — but it is an assumption.
- **Whether the non-caller-scoped listing survives a non-admin token.** See
  finding 25. This is the one result most likely to be a privilege artefact, and
  a reclaim feature that only works for administrators would be worse than none.
- **Whether `attributes.sessionInactiveTimeout` can be *set* at create.** The
  request accepted an `attributes` object; nothing was put in it. Finding 18 read
  the 900 back, it did not write it.
- **Concurrency.** Two jobs submitted to one session at once were not tried, so
  what the session state reports mid-overlap, and whether the second queues or
  fails, is unknown. 2a-ii should serialise per session regardless.
- **Viya 3.5**, as everywhere else in this file.

## 2026-08-16 — Cross-check after the 2a-iii manual run (Viya 4)

Every finding above was produced by a probe talking to the server directly. This
one is different in kind: it looks at what the **shipped extension** left on the
server after a human ran the 2a-iii procedure in `RUNBOOK.md` through step 9, and
it is here because the compute session id is deliberately never logged, so from
inside the editor there is no way to see whether a `DELETE` landed. Read-only
throughout — one collection `GET`, one session `GET`, one state `GET`. TLS
verification was disabled for the probe only. The endpoint is scrubbed as
elsewhere.

### Finding 30 — Sessions are cleaned up, and `applicationName` cannot tell our client from SAS's

Step 9 alone creates and destroys a session five or six times: disconnect,
connect, disconnect, connect-and-cancel, connect-and-cancel-at-the-picker,
connect properly. Immediately afterwards, `GET /compute/sessions?limit=50`
returned `count: 1` and one item:

| Field (from the single-resource `GET`) | Value |
| --- | --- |
| `name` | `python-on-viya` |
| `state` | `idle` |
| `creationTimeStamp` | the last connect, to the second |
| `applicationName` | `vscode` |
| `attributes.sessionInactiveTimeout` | `900` |
| `attributes.homeDirectory` | `…/compsrv/default/<session-id>` |

**What that says about our code, which is the point.** Six creates, one survivor:
every `DELETE` the session manager issued reached the server and took its session
down. Had `disconnect` merely dropped our local reference — the failure mode step
9's *`Reconnected` must not appear here* check exists to catch — this listing
would show the pile.

**What it says about the API, and it is a correction of emphasis.** Finding 24
established that `applicationName` is the OAuth client id of the *token*, not
anything the caller sends. This is the first sighting of that field for the client
the extension actually uses, and the value is `vscode` — the built-in client id
(see the OAuth findings above). That id is not ours. SAS's own VS Code extension
authenticates with the same built-in client, as would any other tool that reused
it, so **`applicationName` cannot narrow a listing to sessions this extension
started**. Finding 25 offered `and(eq(owner,…),eq(applicationName,…))` as the
reclaim filter; that pairing is right about `owner` and wrong to lean on
`applicationName`, which here would sweep in every session the SAS extension left
behind for the same user. The only marker that is ours is the constant in `name`,
which is exactly why finding 25 insisted the name be a constant. This does not
revive reclaim-by-listing — ADR-0012 rejected it on the strength of finding 26,
that names are not unique — but if it is ever reconsidered, the filter in finding
25 must not be copied as written.

**Corroborations, offered as corroborations rather than news.** The 900-second
timeout read back again (finding 18). A settled session was `idle`, not `running`
(finding 23). The collection item carried exactly `id`, `links`, `name`, `owner`,
`version` — no `state`, no timestamps — so a list still cannot tell a live session
from a dead one without a `GET` per item (finding 24). And `count` was populated
on a collection that was not truncated (finding 16), which is the other half of
that finding stated positively for the first time.

**One reading to avoid.** A single item is *not* evidence that the listing has
become caller-scoped. Finding 25 saw this same token return other people's
sessions; the honest reading of `count: 1` is that at that moment the deployment
held one compute session in total, which is what a quiet personal test system
looks like at half past nine at night. `homeDirectory` is likewise not new
information — it is the session id under a fixed prefix — and nothing should be
built on its shape.

### What this cross-check did not settle

- **Whether a reaped session disappears from the listing or lingers as a `404`
  href.** The session was still inside its 900 seconds when it was read, and the
  reaper was not waited out. Finding 29's gap, unchanged.
- **The second deployment.** Only the working profile's endpoint was queried, so
  nothing here says what the cancelled step-6 sign-in left behind on the other
  one. It should be nothing — the connect never reached a session — but that is
  reasoning, not an observation.
- **Viya 3.5**, as everywhere else in this file.

## 2026-08-16 — Submission mechanism (2-pre), before 2b freezes the interface (Viya 4)

The probe `PRODUCTION_PLAN.md` requires **before** 2b, because all three answers
shape the interface 2b freezes: how user code containing SAS-significant text
behaves when it is inlined into a `SUBMIT` block, whether `SYSCC` is readable as
a session variable rather than only from log text, and how the Python namespace
is cleared without destroying the compute session.

**This probe wrote.** Two sessions in the `SAS Studio compute context`, fourteen
jobs between them, and one fileref whose content was uploaded twice. Both
sessions were deleted at the end and the first was confirmed gone (`404`); the
fileref was deassigned first (`204`). TLS verification was disabled for the probe
only. The endpoint and the user identity are scrubbed here as elsewhere.

### Finding 31 — A bare `endsubmit;` line ends the block; the same text inside a line does not

Two forms, and only one of them is dangerous.

**Embedded, harmless.** `x = "endsubmit;"` — the terminator inside a Python
string on a line with other tokens — reached Python intact: `len(x)` printed
`10`, and the block ran through to its last statement.

**Alone on a line, fatal.** A line whose only content is `endsubmit;` ends the
`SUBMIT` block even when Python considers it to be inside a triple-quoted string:

```
proc python;
submit;
print("MARK-A")
s = """
endsubmit;      <- SAS ends the block here
"""
print("MARK-B", len(s))
```

SAS then parsed the remainder as SAS. The `"""` on the next line produced
`ERROR 180-322: Statement is not valid or it is used out of proper order`, the
step was abandoned, and **not one line of the Python ran** — `MARK-A` never
printed, although it came before the terminator. The job reported `state: error`.

The risk is therefore not "the file mentions `endsubmit`". It is a line that
stands alone as that statement after SAS has looked at it, which is ordinary
Python inside any triple-quoted string, and entirely unremarkable in test data,
documentation strings, or a file that talks about this extension.

### Finding 32 — Inside an intact block, SAS neither resolves macros nor tokenises quotes

Everything else thrown at the inline path came through byte for byte. With
`%let probevar = SECRET42;` executed in the same job, immediately before the
procedure:

| Submitted inside `SUBMIT` | Python saw |
| --- | --- |
| `print("amp-dq:&probevar")` | `amp-dq:&probevar` |
| `print('amp-sq:&probevar')` | `amp-sq:&probevar` |
| `print("pct: %let notreally = 1;")` | `pct: %let notreally = 1;` |
| `t = "don't stop"` | `len(t)` → `10` |
| `u = 'it''s'` | `len(u)` → `3` |
| `# don't stop -- a lone apostrophe in a comment` | ignored as a comment; the job stayed healthy and a following `data _null_` step still ran |
| `v = "quote: \" and apos: '"` | `len(v)` → `20` |

Three of those matter more than the rest. **No macro resolution happens**, in
either quote style, for an automatic (`&sysuserid`, tested separately) or a
user-defined variable — so the `&`-in-a-string hazard `PRODUCTION_PLAN.md` §1.5
anticipated does not fire inside a `SUBMIT` block. **`''` is not collapsed**:
Python received both apostrophes and read them as its own implicit concatenation
of `'it'` and `'s'`, giving 3 characters. And **an unbalanced apostrophe in a
comment is harmless** while the block is intact.

That last one is worth stating carefully, because it is easy to read finding 33
as contradicting it. It does not: the quote damage there happened *after* the
block had already been ended early by finding 31's mechanism, at a point where
SAS was no longer reading Python.

### Finding 33 — A block ended early can leave the tokeniser inside an open quote, and every later job then does nothing while reporting `completed`

This is the worst thing in this probe, and it was found by accident.

The job in finding 31 left SAS parsing `"""` as SAS source: an empty literal
followed by an unterminated one. The session stayed in that state **across job
boundaries**. The next job's statements were swallowed as string content — no
output, no error, no NOTE that anything was wrong — and the one after that
finally produced `NOTE: The quoted string currently being processed has become
more than 262 bytes long. You might have unbalanced quotation marks.` Both jobs
returned **`state: completed`** with the source echoed into the log and nothing
executed. A `PROC PYTHON` step swallowed this way was later measured at
`real time 1:36.57`, so it also hangs.

Recovery is the incantation `PRODUCTION_PLAN.md` §1.5 already names, and it
works:

```
*';*";*/;quit;run;
options nosyntaxcheck nodmssynchk;
%let syscc=0;
```

After it, a `data _null_` step printed again and `PROC PYTHON` resumed its
previous state. **Consequences for the client, and they are not small.** A job's
`state` is *not* a success signal — `completed` covered two jobs that ran nothing
at all. Whatever submission mechanism 3a chooses must either be incapable of
ending the block early (finding 35) or must send the recovery incantation before
every submission, and the extension cannot rely on the user noticing, because the
symptom is silence.

### Finding 34 — `PROC PYTHON`'s option set is enumerated by its own error message

`proc python file=probef;` is not valid syntax, and the error is more useful than
the documentation:

```
ERROR 22-322: Syntax error, expecting one of the following:
              ;, COMMAND, ECHO, INFILE, RESTART, SRC, TERMINATE, TIMEOUT.
```

So the surface is `COMMAND`, `ECHO`, `INFILE`, `RESTART`, `SRC`, `TERMINATE`,
`TIMEOUT`. `INFILE` and `RESTART` are used below. `ECHO` and `TIMEOUT` are
unprobed and both look relevant later — `ECHO` to the log noise 3b filters, and
`TIMEOUT` to 3d-i's Cancel. `TERMINATE` and `RESTART` are *options on the `PROC`
statement*, not statements inside the block: `terminate;` written as a statement
is `ERROR 180-322`.

### Finding 35 — `infile=` runs an uploaded file byte for byte, and echoes no source

`proc python infile=<fileref>;` and `proc python infile="/path/to/file.py";` both
execute an uploaded file, and the file is never seen by the SAS tokeniser. The
same content that destroyed the inline path in finding 31 ran correctly:

| In the file | Result |
| --- | --- |
| `endsubmit;` alone on a line inside `"""…"""` | survived — `len(s)` → `12`, i.e. `\nendsubmit;\n` |
| `"has %let and &sysuserid and ; semicolons"` | survived — `len(t)` → `40` |
| `# don't …` (apostrophe in a comment) | harmless |
| `café ✓` (UTF-8) | printed correctly |
| no trailing newline | ran |

**The file's source is not echoed into the log**, which the inline path does line
by line. That removes the largest single category of noise 3b would otherwise
have to strip, and it means the log holds Python's own output plus SAS's NOTEs
and nothing else.

`restart` composes with it in one statement — `proc python restart infile=probef;`
destroyed the interpreter, started a new one, and ran the file, all in one step.

**This is the answer to 2-pre (i): upload and `infile=`, not inline.** Inline is
byte-faithful in every case tested except one, but that one is silent, is trivial
to hit by accident, and poisons the session rather than the submission.

### Finding 36 — Uploading needs an `If-Match`, and the round trip is byte-identical

A fileref is created with `POST /compute/sessions/{id}/filerefs`, media type
`application/vnd.sas.compute.fileref.request+json`, body `{"name":…,"path":…}`.
The response carries `accessMethod: "DISK"`, `fileName`, `filePath`, `fileSize`,
an `id` equal to the requested name, and seven links: `self`, `alternate`,
`deassign` (`DELETE` the fileref), `content` (`GET`), **`upload` (`PUT`
…/content)**, `append` (`POST`), and `delete` (`DELETE` …/content).

`PUT …/content` with `Content-Type: application/octet-stream` and no `If-Match`
returns **`428 Precondition Required`**. With the `ETag` from a `GET` of the
fileref it returns **`201`**. A 191-byte payload — UTF-8, no trailing newline —
came back from `GET …/content` **byte-identical**, md5 for md5.

Two smaller things. The fileref collection starts at `count: 0` in a new session,
so nothing has to be cleaned up before use. And the `files` endpoint (as opposed
to `filerefs`) rejects `application/vnd.sas.collection+json` with a `406` and
names the acceptable types in `remediation`; its hrefs encode path separators as
`~fs~`.

### Finding 37 — `SYSCC` is a readable session variable, and Compute resets it per job

`GET /compute/sessions/{id}/variables/SYSCC` returns `200` and
`{"name":"SYSCC","scope":"GLOBAL","value":"0","version":1}` with a `self` link.
The variables collection reports `count: 83` on a fresh session, and a `%let`
issued in a job shows up in it (`PROBEVAR` / `SECRET42`), so the endpoint reads
live session state rather than a snapshot.

**`SYSCC` is therefore not log-only, and 3a does not depend on 3b.** The plan's
contingency — reorder or merge the two slices — is not needed. `SYSERR` and
`SYSERRORTEXT` are readable the same way; after the finding 31 failure
`SYSERRORTEXT` held `180-322: Statement is not valid or it is used out of prop…`,
truncated by the service, not by us.

**Compute resets `SYSCC` between jobs.** A job that ended with `SYSCC=1012` was
followed by one that read `&syscc` as `0` in its first statement, with no reset
sent by us. So the value read after a job is that job's, and the client does not
have to zero it first — but nothing here proves the reset is a documented
guarantee rather than an implementation detail, so 3a should still read the value
it cares about immediately after the job it cares about.

### Finding 38 — The interpreter persists across jobs, and `restart` clears it without touching the session

`NOTE: Resuming Python state from previous PROC PYTHON invocation.` appears on
every `PROC PYTHON` after the first, in the same session, **including across
separate jobs**. A variable set in one job was still defined in the next, with
the same interpreter pid.

`proc python restart;` prints `NOTE: Previous Python state destroyed.` followed
by `NOTE: Python initialized.`, and afterwards the marker variable was gone and
the pid had changed (382 → 480). `proc python terminate;` prints
`NOTE: Python terminated.` and the next invocation initialises a fresh one. The
compute session is untouched by either — macro variables, librefs and filerefs
survive, because only the interpreter is recycled.

**This is the answer to 2-pre (iii): `restart`.** It costs about 3.4 seconds to
destroy and initialise, measured twice; a first initialisation in a new session
is about 1.8–4.5 seconds. So `freshNamespace` is a real option on every run
rather than a session-lifecycle event, and neither `reset()` nor the cancellation
fallback needs to destroy the session.

### Finding 39 — A Python exception is `SYSCC=1012`, and the traceback carries two wrapper frames

An unhandled exception produced, in this order: the output written before it, an
`ERROR: Unhandled Python exception.` log line of type `error`, the Python
traceback as `normal` lines, and `NOTE: The SAS System stopped processing this
step because of errors.` The job reported `state: error`, and afterwards
`SYSCC` = `SYSERR` = **`1012`**, with `SYSERRORTEXT` = `Unhandled Python
exception.` A SAS-side syntax error gives `SYSCC=3000` instead, so the two are
distinguishable.

The traceback is not clean:

```
Traceback (most recent call last):
  File "<stdin>", line 5, in <module>
  File "<stdin>", line 2, in <module>
  File "<string>", line 2, in <module>
ValueError: boom-at-line-2
```

The user's own frame is the **last** one, `<string>`, and its line number is
correct against the uploaded file — line 2 raised. The two `<stdin>` frames above
it belong to the harness `PROC PYTHON` wraps around the code. With `infile=` the
offset map for the user's frame is therefore the identity, which is one fewer
thing for 3a to get wrong, but 3b must drop the wrapper frames or every traceback
the user sees will point at lines they did not write.

### What 2-pre settles

1. **Submission is by upload, not by inlining.** Create a fileref, `PUT` the
   editor's bytes with an `If-Match`, run `proc python infile=<fileref>;`. This
   is the only mechanism tested that cannot end the block early, and it also
   removes the source echo from the log.
2. **Failure detection reads `SYSCC` from the variables endpoint.** 3a is
   independent of 3b; the slices keep their planned order.
3. **`freshNamespace` is `proc python restart`,** at roughly 3.4 seconds, with
   the compute session left alone.

### What this probe did not settle

- **`ECHO`, `TIMEOUT`, `COMMAND` and `SRC`.** Named by finding 34's error message
  and never tried. `TIMEOUT` may be the honest answer to 3d-i's Cancel, and `SRC`
  may be a second way to hand over code; both should be probed before 3a fixes a
  design.
- **Whether `SYSCC`'s per-job reset is contractual.** Observed twice, not
  documented here.
- **Large files and concurrency.** The uploaded payload was 191 bytes and one
  job ran at a time. Nothing here says how a megabyte of Python behaves, nor what
  a second job submitted during a `PROC PYTHON` step does.
- **Where the uploaded file should live, and who can read it.** `/tmp` on the
  compute node was used because it was convenient. The session home directory
  under `…/compsrv/default/<session-id>` is the obvious alternative and was not
  compared, and no permissions were checked.
- **Cleanup on failure.** The fileref was deassigned by hand at the end. What
  happens to an uploaded file when a session dies mid-run was not observed.
- **Viya 3.5**, as everywhere else in this file.

## 2026-08-17 — The cadence endpoint (2b-ii), before stage-1 probing is written (Viya 4)

Stage-1 capability probing (§2.3) rests on a single endpoint:
`GET /deploymentData/cadenceVersion`, added in Viya 4 and absent from Viya 3.5.
`src/dialects/resolve.ts` already names its three outcomes — `cadence`, `absent`,
`unreadable` — and this probe ran to find out what those three look like on the
wire before code is written to tell them apart. The third one turned out to be
the interesting one.

**Read-only.** Seven `GET`s and one `HEAD`; nothing was created. TLS
verification was disabled for the probe only. The endpoint host, the token and
the per-request correlator ids are scrubbed here as elsewhere.

### Finding 40 — The cadence resource carries four fields, and the one to show a user is not the one to branch on

`GET /deploymentData/cadenceVersion` answers **200** with
`content-type: application/vnd.sas.deployment.data.cadence.version+json; charset=utf-8; version=1`,
in 0.25–0.29 s over three runs. The body:

```json
{
  "cadenceDisplayName": "Long-Term Support 2026.03",
  "cadenceName": "lts",
  "cadenceRelease": "20260721.1784653667906",
  "cadenceVersion": "2026.03",
  "links": [
    {
      "rel": "self",
      "href": "/deploymentData/cadenceVersion",
      "uri": "/deploymentData/cadenceVersion",
      "type": "application/vnd.sas.deployment.data.cadence.version"
    }
  ],
  "version": 1
}
```

`cadenceVersion` is `2026.03` — exactly the `^\d{4}\.\d{2}$` shape the `CADENCE`
pattern in `resolve.ts` already anchors on, so `resolveDialectId` accepts it
unchanged and no new parsing is needed. `cadenceRelease` is a build stamp rather
than a version and nothing should try to order it. `cadenceName` is the support
track (`lts`), and `cadenceDisplayName` is the string to put in the output
channel: "Long-Term Support 2026.03" tells a user which release *and* which track
in one line, where a bare `2026.03` tells them half of it.

`links[].type` omits the `+json` suffix again (finding 14), and `version: 1` is
the representation version, not the deployment's. `HEAD` answers 200 too, so
presence is testable without a body — but the body is what we want, so the probe
should `GET`.

### Finding 41 — The endpoint is unauthenticated, and the union's stated reason is wrong

No `Authorization` header at all: **200**. A deliberately malformed bearer
token: **200**. For contrast, `/compute/contexts` with no token is **401** with a
`vnd.sas.error+json;version=2` body reading "Full authentication is required to
access this resource".

Two consequences, one comfortable and one not. The comfortable one: an expired
token cannot make the cadence probe fail, so an `unreadable` result never has to
be explained to a user as "you may need to sign in again". The uncomfortable one:
the doc comment on `CadenceSignal` justifies the three-way union by saying the
signed-in user "may simply not have permission to read it", and on this
deployment there is no permission to lack. The union still earns its keep — see
finding 42 — but the reason given for it is not the reason it is needed, and that
sentence is corrected in this slice.

One deployment does not establish that every Viya 4 leaves this endpoint open.
The probe should keep sending the token anyway: it costs nothing, and a
deployment that *did* gate the endpoint would otherwise answer 401 and be read as
Viya 3.5.

### Finding 42 — Three different 404s, and only one of them means "no cadence endpoint"

This is the finding that changes the design. Two 404s were provoked, and they do
not look alike:

| What was asked | Status | `content-type` | Body |
|---|---|---|---|
| `/deploymentData/noSuchThing` — service routed, path unknown | 404 | `application/vnd.sas.error+json;charset=utf-8;version=2` | `{"version":2,"httpStatusCode":404,"message":"There is no handler defined for the path \"/deploymentData/noSuchThing\"."}` |
| `/noSuchServiceAtAll/thing` — nothing routed | 404 | *absent* | empty, `server: envoy` |

The second is the ingress answering on behalf of a service that is not there. It
carries no body, no Viya media type, and no message. A corporate proxy, a VPN
portal or a mistyped host would produce something in the same family.

So **status 404 alone is not evidence of Viya 3.5.** Keying the `absent` arm on
the status would let anything sitting between the editor and the deployment
manufacture a confident, wrong claim about the generation — and the wrong dialect
chosen silently is the failure mode the `reason` field exists to prevent.

There is a control available for free. Sean's wiring decision for this slice is
that the probe runs *after* a Compute session connects, and a live session is
itself proof that the host is a reachable Viya that our token works against. Given
that, a 404 from `/deploymentData/cadenceVersion` is a statement about the
endpoint rather than about reachability, and `absent` is honest. Without a
connected session — a probe run from a colder position in some later slice — the
same 404 should classify as `unreadable`.

### Finding 43 — `Accept: application/json` is honoured, and a wrong one is a 406 that lists the right ones

Asking with `Accept: application/json` returns 200 with
`content-type: application/json; charset=utf-8` and the same body. Asking with
`application/vnd.sas.collection+json` — a type this resource does not serve —
returns **406** with a `vnd.sas.error+json` document whose `details` enumerate
what would have worked:

```
application/vnd.sas.deployment.data.cadence.version+json;version=1
application/vnd.sas.app.registry.cadence.version+json;version=1
application/vnd.sas.deployment.data.cadence.version+json
application/vnd.sas.app.registry.cadence.version+json
application/json
```

Two useful things. `application/json` is on the list, so the contract can ask for
it and get a stable content type back rather than a versioned vendor one — which
matters because the client only reads `cadenceVersion` and has no use for the
representation version. And 406 is a distinct, diagnosable outcome: a deployment
that answers 406 is a Viya that has this resource, so a 406 is `unreadable` with a
detail worth logging, never `absent`.

### Finding 44 — `/deploymentData` is a link document, so the path never has to be composed

`GET /deploymentData` answers 200 with `application/vnd.sas.api+json;version=1`
and five links:

| `rel` | `href` | `type` |
|---|---|---|
| `cadenceVersion` | `/deploymentData/cadenceVersion` | `application/vnd.sas.deployment.data.cadence.version` |
| `cadenceVersion` | `/deploymentData/cadenceVersion` | `application/vnd.sas.app.registry.cadence.version` |
| `licenseFile` | `/deploymentData/licenseFile` | `application/vnd.sas.deployment.data.license.file` |
| `permissionToggles` | `/deploymentData/permissionToggles` | `application/vnd.sas.collection` |
| `setinit` | `/deploymentData/setinit` | `text/plain` |

`method` is `null` on every one of them, so ADR-0010's "navigate by relation"
is available here but incomplete: the relation gives the path, and the verb has
to come from the contract file rather than from the document.

Note the relation appears **twice**, distinguished only by `type`. Any code that
selects a link by `rel` alone gets whichever came first. The two hrefs happen to
be identical today, which means a `rel`-only lookup works by luck rather than by
construction — the contract file should record the media type alongside the
relation, and the checker should not let one be added without the other.

### Finding 45 — Upstream reads the path directly and collapses every failure into `"unknown"`

For comparison, `client/src/connection/rest/RestContentAdapter.ts` in the SAS
extension:

```ts
private async getViyaCadence(): Promise<string> {
  try {
    const { data } = await this.connection.get("/deploymentData/cadenceVersion");
    return data.cadenceVersion;
  } catch (e) {
    console.error("fail to retrieve the viya cadence");
  }
  return "unknown";
}
```

The composed path (ADR-0010), the swallowed exception with no detail carried
forward, and `console.error` rather than an output channel the user can read. The
substantive difference is the return type: a `string` cannot distinguish "no
cadence endpoint" from "could not ask", so 404, 401 and a DNS failure all arrive
as the same word. Upstream can afford that, because the value feeds exactly one
comparison — `this.viyaCadence === "2023.03"`, guarding a `sortBy` parameter one
cadence rejected — and being wrong costs a suboptimal query. It feeds our choice
of dialect, where being wrong costs a dozen unrelated bugs.

Not a criticism of upstream so much as a measurement of how much more weight we
are putting on the same endpoint.

### What this settles

1. **The contract asks for `application/json`** and reads `cadenceVersion`, with
   `cadenceDisplayName` carried alongside for the output channel.
2. **`absent` requires more than a 404.** The 404 must come with a Viya error
   document, and the probe must already have a connected session behind it.
   Anything else — a bodyless ingress 404, a 401, a 406, a transport failure — is
   `unreadable` with the detail attached.
3. **The three-way union stays, with its justification rewritten.** Permission is
   not the reason on this deployment; things in the network path are.
4. **The link document is navigable but not sufficient**, and the `cadenceVersion`
   relation is ambiguous by media type, so the contract file records both.

### What this probe did not settle

- **What Viya 3.5 actually answers.** The whole `absent` arm is still inference:
  no 3.5 deployment was available, so "the endpoint is missing" was simulated
  with a missing sibling path and an unrouted service on a Viya 4. If a 3.5
  becomes reachable, this is the first thing to check.
- **Whether any Viya 4 gates the endpoint.** Unauthenticated here; one
  deployment.
- **`licenseFile`, `permissionToggles` and `setinit`.** Named by the link
  document, never fetched. `permissionToggles` may be relevant to a later slice
  that has to explain why an action is unavailable.
- **Caching.** The response sends `cache-control: no-cache, no-store` and no
  `ETag`, so there is nothing to revalidate against; whether the cadence can
  change under a live session was not tested, and the per-profile cache this
  slice adds assumes it cannot within a session.

## 2026-08-17 — The job log (2c-pre), before log streaming is written (Viya 4)

Slice 2c has to turn a submitted program into a stream of typed lines. Findings
19, 20 and 21 got as far as "the log is a paged collection of typed lines" and
stopped; no job representation had ever been dumped, the vocabulary of `type` had
never been enumerated, and whether the log endpoint's `timeout=` parameter really
long-polls was assumed from upstream's code rather than measured. That last one
is load-bearing: if `timeout=` were inert, upstream's `while` loop would be a hot
spin throttled only by network latency, and 2c would have to drive from the
**job-state** long poll instead — the one finding 28 measured releasing at the
moment of change. Not the *session*-state poll: finding 27 already ruled that
out, because completion is a property of the job and watching the session for
`idle` reports a run finished two to three seconds late.

**Mutating, and agreed first.** Nothing about a log is observable without a job
to produce one. Three throwaway compute sessions were created and each was
deleted in the same shell call under a `trap`; the jobs died with them. No
existing object was read, written or deleted. Session ids, job ids and the host
are scrubbed below, and the job-create `ETag` is omitted rather than replaced
because nothing here reads it; line text, field names, types and ordering are
reproduced exactly.

### Finding 46 — The job is six fields and ten relations, and two of them are the same URL

`POST /compute/sessions/{sid}/jobs` with
`Content-Type: application/vnd.sas.compute.job.request+json` and a body of
`{"name": ..., "code": [ ...statements... ]}` answers **201** with a `Location`
header, an `ETag`, and
`content-type: application/vnd.sas.compute.job+json; charset=utf-8; version=1`.
The representation is small:

```json
{
  "creationTimeStamp": "2026-08-17T17:21:21.463Z",
  "id": "A1B2C3D4-E5F6-4A5B-8C9D-0E1F2A3B4C5D",
  "sessionId": "11111111-2222-3333-4444-555555555555-ses0000",
  "state": "pending",
  "stateElapsedTime": 0,
  "version": 1,
  "links": [ ... ]
}
```

No `code` echoed back, no `name` echoed back — the name sent at create does not
survive into the representation, unlike a session's (finding 24). `state` is
`pending` at create, so a client that reads the create response and expects to
find a terminal state has to poll regardless. `stateElapsedTime` is a
server-side stopwatch on the *current* state, which makes it useful for a
progress message and useless as a total.

The ten relations:

| `rel` | method | `type` | href (relative to the job) |
|---|---|---|---|
| `self` | GET | `application/vnd.sas.compute.job` | *(the job)* |
| `state` | GET | `text/plain` | `/state` |
| `cancel` | PUT | **`null`** | `/state?value=canceled` |
| `delete` | DELETE | **`null`** | *(the job)* |
| `log` | GET | `application/vnd.sas.collection` | `/log` |
| `logAsText` | GET | `text/plain` | `/log` |
| `listing` | GET | `application/vnd.sas.collection` | `/listing` |
| `listingAsText` | GET | `text/plain` | `/listing` |
| `results` | GET | `application/vnd.sas.collection` | `/results` |
| `up` | GET | `application/vnd.sas.compute.session` | *(the session)* |

Three things fall out of that table. **`type` is explicitly `null` on `cancel`
and `delete`** — the open question finding 21 left is answered, and a contract
that types the relation's media type as a required string would reject a real
Viya response. Null means "no representation involved", which is exactly right
for a `DELETE` and for a `PUT` that carries its whole payload in the query
string.

**`log` and `logAsText` are the same href.** They differ only in `rel` and in
the media type, so a client that resolves a relation to a URL and then picks an
`Accept` header independently would silently get whichever one it asked for
regardless of which relation it looked up. The relation is the intent; the
`Accept` header is what actually decides. `listing`/`listingAsText` are the same
pair over the listing.

**`cancel` carries its own query string**, as the session's does (finding 21).
Appending a parameter to it requires `&`, not `?`, which is the kind of thing a
naive URL builder gets wrong exactly once.

### Finding 47 — A log line is three fields, and `count` is the running total

`GET {job}/log?start=0&limit=200` with
`Accept: application/vnd.sas.collection+json` answers **200** with
`content-type: application/vnd.sas.collection+json;version=2`. Each item has
exactly three keys — `line`, `type`, `version` — and nothing else: no timestamp,
no sequence number, no job id. Position in the collection is the only ordering
information there is, which is why `start` is the whole of the client's state.

`count` is the number of lines the job has produced *so far*, and it moved
10 → 11 → 12 across three consecutive polls of a running job. It is a live total,
not a page size and not a null. This is worth stating plainly because
`/compute/contexts` answers `count: null` whenever the collection is truncated
(finding 16), and code written defensively against that trap does not need the
same defence here. It does need the opposite caution: `count` on a running job is
stale the moment it is read.

### Finding 48 — `timeout=` is a real long poll, and on the log it is the only mechanism there is

Measured against a job printing one line per second, polling at the tail:

| Request | Elapsed | Status | Items |
|---|---|---|---|
| `?start=0&limit=200` (baseline, mid-run) | 0.33 s | 200 | 9 |
| `?start=9&limit=200&timeout=10` | 0.78 s | 200 | 1 |
| `?start=10&limit=200&timeout=10` | 1.02 s | 200 | 1 |
| `?start=11&limit=200&timeout=10` | 1.02 s | 200 | 1 |
| `?start=12&limit=200` *(no `timeout`)* | 0.27 s | 200 | 0 |

The three `timeout=10` polls each blocked for about as long as it took the next
line to appear and then returned it — one line, immediately, not ten seconds
later. The same request without `timeout` came back in 0.27 s empty. So the
parameter works, upstream's loop is not a hot spin, and **a client that omits
`timeout` and loops has written a busy-wait against a corporate network**.

The wait is honoured to its stated length. Against a job deliberately silent for
25 seconds:

| Request | Elapsed | Status | Items |
|---|---|---|---|
| `?timeout=10` | 10.27 s | 200 | 0 |
| `?timeout=5` | 5.37 s | 200 | 0 |
| *(no `timeout`)* | 0.56 s | 200 | 0 |
| `?timeout=60` | 6.34 s | 200 | 6 |

`timeout=60` was accepted without complaint and returned after 6.34 s, when the
silence ended — the value is a ceiling, not a delay. Note that this says nothing
about whether 60 is *honoured*: the request was released by a log line long
before the ceiling could elapse, so a server that silently clamps large values to
some smaller maximum would have produced exactly the same measurement. Two
timeouts have been observed actually elapsing — `timeout=5` at 5.37 s and
`timeout=10` at 10.27 s — and 10 is therefore the largest verified ceiling.
Treat anything above 10 as unverified, and do not rely on a long ceiling for correctness — the
loop must be correct at any clamp, because an early empty return is
indistinguishable from a short poll.

**There is no ETag on the log collection.** The response headers carry
`content-type` and no `etag` at all, so `If-None-Match` has nothing to send and
the conditional-request machinery that drives the *session state* long poll
(findings 19 and 28) simply does not apply here. That is a simplification worth
having: the log's cursor is `start`, and `start` is a number the client already
has to track.

### Finding 49 — Expiry is a 200 with an empty page, not a 304

Both expiry rows above are **200 with `items: []`**, never 304. The session state
resource answers `304` when its `wait` elapses (finding 28), so the two expiry
conventions that have actually been *measured* in this API disagree, and the
log's is the easier to consume: one status, one body shape, and "nothing
happened" is an empty array rather than a second code path.

The job-state resource's expiry is **still unobserved**. Finding 28 measured it
holding for `wait=20` and returning `200` after 12.96 s — but that was a release
*at the moment of change*, not a window running out, and nothing has yet let a
job-state `wait` elapse against an unchanged value. An earlier draft of this
finding claimed three expiry conventions; there are two measured and one
assumed, and the assumption is only that the job state behaves like the session
state it sits beside.

A consumer must therefore not treat an empty page as end-of-log. During a run it
means "nothing yet"; only the job's state says whether more is coming.

### Finding 50 — A terminal job short-circuits the wait

After the job reached a terminal state, a tail poll *with* `timeout=10` returned
in **0.26 s** with zero items. The server does not make a finished job's reader
sit out the full timeout.

This is the finding that makes the drain cheap. A stream that polls until the
state is terminal and then keeps reading until the pages come back empty pays
nothing for the final read, so there is no trailing ten-second stall at the end
of every execution and no need for the client to special-case its last poll.

### Finding 51 — Reading past the end is a 200, and `next` is the drain's terminator

`?start=71&limit=10` against a 21-line log: **200**, zero items, `count: 21`,
and `start` echoed back as `71`. No 400, no 416, no error document. A cursor that
overshoots is not a failure mode to defend against.

Paging a finished 21-line log at `limit=3` produced seven pages and stopped:

| Page `start` | items | relations present |
|---|---|---|
| 0 | 3 | `collection`, `first`, `last`, `next`, `self`, `up` |
| 3, 6, 9, 12, 15 | 3 each | *(above, plus `prev`)* |
| 18 | 3 | `collection`, `first`, `prev`, `self`, `up` |

`next` is absent on the last page and on every tail read of a running job, so
"follow `next` until it is gone" terminates and is the correct drain. Note that
the final page was *full* — three items, `18 + 3 = 21 = count` — and still
carried no `next`, so the drain must key on the link's absence and not on a short
page.

### Finding 52 — Four line types, and `note` is a catch-all that includes blanks

The full 21-line log of a job that printed one line and then failed, verbatim
except for scrubbing:

```
 0 source  '1    data _null_;'
 1 source  '2      put "PROBE NORMAL LINE";'
 2 source  '3    run;'
 3 note    ''
 4 normal  'PROBE NORMAL LINE'
 5 note    'NOTE: DATA statement used (Total process time):'
 6 note    '      real time           0.00 seconds'
 7 note    '      cpu time            0.00 seconds'
 8 note    '      '
 9 note    ''
10 source  '4    data _null_;'
11 source  '5      set nosuchlib.nosuchtable;'
12 error   "ERROR: Libref 'nosuchlib' exceeds 8 characters."
13 source  '6    run;'
14 note    ''
15 note    'NOTE: The SAS System stopped processing this step because of errors.'
16 note    'NOTE: DATA statement used (Total process time):'
17 note    '      real time           0.00 seconds'
18 note    '      cpu time            0.00 seconds'
19 note    '      '
20 note    ''
```

Four types appeared: `source` (6), `note` (13), `normal` (1), `error` (1). Four
observations, each of which constrains 3b's filter:

1. **`note` is not "a line beginning with `NOTE:`".** It covers genuine notes,
   their indented continuation lines, whitespace-only lines, and completely
   blank ones. Ten of the thirteen carry no `NOTE:` prefix — only indices 5, 15
   and 16 do — and six are empty or whitespace: four are the empty string
   (3, 9, 14, 20) and two are spaces only (8, 19). A filter offering "hide
   notes" would delete the log's
   vertical spacing along with them, which is a legitimate choice but must be a
   deliberate one.
2. **`normal` is the user's own output** — the `put` — and it is the rarest type
   in a log dominated by machinery. `normal` plus `error` is the pair a
   "program output only" view wants.
3. **The diagnostic is interleaved with the source echo, not appended after
   it.** Line 12 (`ERROR:`) sits between the echo of `set nosuchlib.nosuchtable;`
   and the echo of `run;`, because SAS emits it as it parses that statement
   rather than when the step runs. Here the error does follow the line it
   belongs to — but it arrives *before the step it is part of has finished being
   echoed*, so a renderer that assumes each step's source is contiguous will
   split it. Whether the line immediately above an `error` is reliably its
   source was not tested; one interleaving is not a rule.
4. **`warning` was not observed** and neither was any type beyond these four.
   Nothing in this probe produced a `WARNING:`, so the vocabulary is a floor,
   not a closed set — the client must pass an unrecognised `type` through rather
   than discard it.

Note also that the source lines are echoed with SAS's own line numbering, which
only happens because this probe submitted statements inline in `code[]`.
ADR-0014 chose upload plus `infile=` for 3a, and finding 35 established that
`infile=` echoes no source at all — so a real 3a log is **predicted** to carry no
`source` lines. That is a prediction, not a measurement: this probe submitted
inline `code[]` and never read a log produced through `infile=`. 3b's filter must
not be designed around `source` lines being present, and 2c should confirm the
prediction the first time it streams a real 3a submission.

### Finding 53 — A SAS `ERROR:` is a job state of `error`, and the session still settles to `idle`

The failing job's terminal state, read from `{job}/state` as `text/plain`, was
**`error`** — not `failed`, not `completed`. The session's own state one moment
later was **`idle`**: a job that errored does not poison its session, which is
consistent with finding 27's observation that the session lags the job at the
end. The session being reusable after a failed job is the useful part — the next
job may be submitted into it without a reset.

Upstream's terminal set is
`["done", "canceled", "error", "warning", "completed"]`. Only `error` and
`completed` have now been observed on a live deployment; `done`, `canceled` and
`warning` are inherited on trust, and `warning` in particular implies a
`WARNING:`-producing job reaches a distinct terminal state that finding 52 did
not provoke. Keep all five — the cost of an unobserved extra member is nil and
the cost of a missing one is a loop that never exits.

Once the session is deleted, the job's log answers **404** with
`application/vnd.sas.error+json;charset=utf-8;version=2` and a message that names
the *session*, not the job:

```json
{
  "version": 2,
  "httpStatusCode": 404,
  "errorCode": 5837,
  "message": "Not Found",
  "details": ["A session with the ID \"...-ses0000\" could not be found.", "path: /compute/sessions/..."]
}
```

So a log read that fails after a session dies is indistinguishable from finding
29's uniform 404 and carries the same diagnosis problem: the client cannot tell
"your session expired" from "that job never existed" by status alone, and must
read `details` or rely on its own record of what it created.

### What this settles

1. **The stream polls the log, not the state.** `timeout=` long-polls for real
   (finding 48), so the loop is `GET {job}/log?start=N&limit=L&timeout=T`,
   advancing `N` by the number of items returned. The session-state long poll is
   not needed to drive it.
2. **`timeout` is mandatory in that loop.** Omitting it turns the loop into a
   busy-wait; the parameter is the only thing standing between the design and a
   request storm.
3. **The expiry arm is a 200 with an empty array**, so there is one response
   shape to parse and "nothing new" is not an error (finding 49).
4. **Termination is: poll until the job state is terminal, then drain until
   `next` is absent** (findings 50 and 51), and the drain is free because a
   terminal job does not honour the wait.
5. **`start` is the entire cursor.** No ETag exists on the log, so nothing
   conditional needs to be tracked.
6. **`type` is passed through, not switched on.** Four values observed, the set
   is open, and `note` is a catch-all rather than a prefix test (finding 52).
7. **The contract checker has to change before 2c can describe a job.**
   `scripts/check-contracts.mjs` requires `via.from`, `via.relation` *and*
   `via.type` to each be a string, and a job's `cancel` and `delete` relations
   carry `type: null` (finding 46). The constraint is broader than the null: a
   *session's* `cancel` and `delete` **omit** `type` entirely, and `typeof
   undefined !== "string"` fails the same check — so the checker could already
   not describe those either, and nothing had noticed because no contract had
   yet needed to name them. Either `type` becomes optional-or-null on a `via`,
   or none of those endpoints can be declared at all — and an endpoint the code
   calls but the contract omits is precisely what the checker's other direction
   is there to catch. 2c has to resolve that, in code, in its own slice.

### What this probe did not settle

- **Whether `timeout` has a server-side maximum, or is silently clamped.** 60 was
  accepted and nothing larger was tried — but 60 never elapsed, because a log
  line released the request at 6.34 s, so a server clamping 60 down to something
  smaller would have produced an identical measurement. The only value observed
  running its full course is 10. A loop must therefore be correct whatever the
  real ceiling is: an early empty return is indistinguishable from a short poll.
- **The `warning` terminal state**, and whether a `WARNING:` line carries a
  `warning` line type. Neither was provoked.
- **What `listing` and `results` contain.** Both relations exist on every job and
  neither was fetched. `results` is likely where 3c's ODS output lives.
- **Whether the log survives the job but not the session.** `DELETE` on the job
  itself was never exercised — only the session was deleted — so whether a
  deleted job's log is readable is unknown.
- **Behaviour under a `limit` larger than the log.** `limit=200` and `limit=500`
  were used freely against small logs; no page-size ceiling was probed, and
  whether a very large `limit` is silently clamped is unknown.
- **Interleaving.** Only one job ran per session. Whether two concurrent jobs in
  one session produce independent logs, or whether Compute even permits the
  second, was not tested.

## 2026-08-19 — What an absent link means (#135), during the phase-2 review (Viya 4)

Punch-list item #135 has been open since the 2a-iii manual run on 2026-08-15: a
context picked from the picker was reported as offering no `createSession` link,
and the *same* context started a session two minutes later. The interesting
question is not why that one connect failed. It is what `resolveContext` is
entitled to *conclude* from an absent relation — because it concluded something
about the deployment, and `messages.ts` told the user so.

**Read-only.** Twenty-one `GET`s against the contexts collection and three
against one context resource. Nothing was created, updated or deleted and no
session was started. Context ids are omitted below; the names are SAS's own
defaults and say nothing about this deployment.

### Finding 54 — The collection item is a summary, and the resource carries three relations the summary never does

The same context, the same token, minutes apart. Below, `…` stands for the
`application/vnd.sas.` prefix and `→` separates a relation's request type from
its response type; a `—` means the relation carried neither. The collection
item:

```
GET /compute/contexts?limit=50
Accept: application/vnd.sas.collection+json

fields: createdBy, id, name, version

  rel              method  type / responseType
  self             GET     …compute.context
  alternate        GET     …compute.context.summary
  delete           DELETE  —
  createSession    POST    …compute.session.request → …compute.session
```

and the resource the item's `self` points at:

```
GET /compute/contexts/{id}
Accept: application/vnd.sas.compute.context+json

fields: createdBy, creationTimeStamp, description, environment, id,
        launchContext, launchType, modifiedBy, modifiedTimeStamp, name,
        resources, version

  rel              method  type / responseType
  self             GET     …compute.context
  alternate        GET     …compute.context.summary
  update           PUT     …compute.context → …compute.context
  updateWithRules  PUT     …compute.context.request → …compute.context
  delete           DELETE  —
  createSession    POST    …compute.session.request → …compute.session
  rules            GET     application/vnd.sas.collection
```

Four fields against twelve, and four relations against seven. The item is the
**summary** representation — its own `alternate` says so — and the three
relations it omits are inserted in the middle of the resource's list rather than
appended, so the summary is not a truncated prefix of the resource but a
different document.

Asking the resource for `application/json` instead answers `200` with the same
seven relations, so the difference is between *representations of different
resources*, not between media types on one.

What this does **not** distinguish, with one identity available: whether the
three missing relations are omitted because a summary omits administrative
relations by design, or because the set is computed against the caller. Both
readings survive the measurement. Either way the consequence for the code is the
same and is the point of the finding: **the link set on a collection item is not
the link set on the resource**, so "this relation was not in the response I
happened to read" cannot be turned into "this deployment does not offer this
operation".

### Finding 55 — `createSession` did not move

Eight reads of the unfiltered collection over roughly forty seconds, plus one
filtered read per context — `?filter=eq(name,'…')`, the exact request
`resolveContext` sends — is twenty-one responses covering thirteen contexts.
Every context carried `createSession` in every one of them, and every item
carried the identical four relations. `count` was `1` on each filtered read.

So the flicker recorded in 2a-iii **did not reproduce**, and nothing about the
request shape explains it: filtered and unfiltered agree, and repetition does
not perturb it. For a caller who may launch a context, the relation is stable.

### What this settles

1. **An absent relation is a statement about one response, not about the
   deployment.** Finding 54 gives the mechanism that is certain — the summary
   carries fewer relations than the resource — and SAS's own REST usage notes
   give the reading that covers the rest: links "indicate actions, operations, or
   state transitions that the client can make", and authorization is evaluated
   per method per caller, so "an authenticated user can have authorization to
   read a resource via a GET method, but not have authorization to update or
   delete a resource via a PUT or a DELETE". A relation can therefore be absent
   because of who asked, and the deployment is the last thing to blame.
2. **The comment in `contexts.ts` was wrong and is corrected in this change.** It
   read the absence as meaning "the one-call design does not apply to this
   deployment". It means no such thing.
3. **The user-facing wording was wrong too.** `messages.ts` said "This SAS Viya
   deployment does not offer that operation here", which sends the reader to
   their administrator to ask about a deployment capability. It now says the
   operation was not offered *to this account on that resource*, which is what
   was observed and is also the actionable reading — pick another context, or ask
   for permission on this one.
4. **Finding 15 is unaffected.** The summary still carries a fully formed
   `createSession` link, so the one-call design stands; this finding narrows what
   its *absence* proves, not what its presence buys.

### What this probe did not settle

- **Why the 2a-iii connect failed.** Twenty-one reads did not reproduce it. The
  remaining candidates — an authorization decision cached and re-evaluated, a
  token refreshed mid-connect, or a transient in the Compute service — are not
  separable from outside, and the extension logs the response it acted on rather
  than the response body, so the next occurrence will not distinguish them
  either unless it is logged first.
- **The decisive experiment.** Reading the same context as a user who may *not*
  launch it would separate "summary omits administrative relations" from
  "the set is computed per caller". It needs a second Viya account with
  different entitlements, which this deployment did not offer to hand.
- **Whether `resolveContext` should stop treating absence as fatal.** Filed
  rather than fixed: see the 3a punch list. A retry, or handing the `POST` to the
  server and reporting its answer, is a behaviour change with tests attached and
  does not belong in a corrections change.
- **Viya 3.5.** Not probed, as ever. Whether its contexts collection is a summary
  in the same way is unknown.
