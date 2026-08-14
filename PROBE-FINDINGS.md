# Live-Viya probe findings

The evidence base. One section per probe, newest last, each dated and scoped to
the deployment it ran against. **Status of everything below:** *confirmed against
a live deployment* — observed, not inferred. `PRODUCTION_PLAN.md` rests on these
facts, so if one of them turns out to be deployment-specific rather than general,
the slice that depends on it needs revisiting. What a probe did *not* settle is
recorded as explicitly as what it did; an unasked question is not a "no".

Probes are read-only `GET`s run under the `viya-api-probe` rules. Captured
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

### Finding 8 — `id` is opaque, and only `id` is safe to key on

Observed for the probed user, values withheld:

| Field | Shape |
|---|---|
| `id` | 17 characters, **not** a UUID, **not** the login name |
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
plus a root-relative `Location` and `etag: "kp81i3skc0"`.

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
`pending` — **7 bytes, no trailing newline** — and `etag: "kp81i3skc0"`, byte for
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
  context.~~ **Answered by finding 21 for sessions:** the `cancel` and `delete`
  links **omit the key**, exactly as context links do. No explicitly-null `type`
  has been seen anywhere on this deployment. Job representations are still
  unchecked.
- **Whether `count` behaves the same way on the session and log collections.**
  Only `/compute/contexts` was varied. The rule "trust `next`, not `count`" is
  written to be safe either way.
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
