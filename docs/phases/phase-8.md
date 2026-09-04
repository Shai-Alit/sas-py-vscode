# Phase 8 — CAS and SWAT

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 8 — CAS and SWAT

**Scoped 2026-09-03**, from the same separate clone (`sas-py-vscode-cowork`)
Phases 6 and 7 were scoped from — kept apart from the primary working copy,
which had Phase 5's release engineering in flight, for the same reason as
before. Technical grounding came from a codebase survey of both this repo
(`src/compute/sessionManager.ts`, `client.ts`, `links.ts`) and
`vscode-sas-extension` (a targeted grep for any CAS/caslib/SWAT surface in
`client/src`, plus the syntax-reference-only hits in `server/`), a web search
for the CAS Management REST API and `swat`'s own authentication documentation,
and eight read-only-except-one live probes against `verde` (Findings 87–92
below; one throwaway Compute session created and deleted to run the decisive
one, confirmed gone by a `404` read-back). No code was written this session.

**What this phase is not competing with.** `PRODUCTION_PLAN.md`'s own framing
already says it: "the SAS extension calls no CAS APIs at all." This session's
grep confirms it directly — every hit for `CAS`/`CASLIB`/`swat` in
`vscode-sas-extension` lands in `server/pubsdata/` or `server/data/`, the
language-server's syntax-reference data for autocomplete and hover on the
`CAS`/`CASLIB` *SAS statements*. There is no `RestCasAdapter`, no CAS-aware
panel, nothing under `client/src` at all. Unlike Phases 6 and 7, which port
and rework a real upstream feature, Phase 8 has no upstream implementation to
read for its shape — the CAS Management REST API documentation and this
session's own probes are the only source of truth, which is exactly why the
probes below matter more here than they did for 6 or 7.

**8a's browsing surface needs no adapter factory and, more importantly, no
session of its own for the common case.** `GET /casManagement/servers`,
`.../servers/{name}/caslibs`, `.../caslibs/{name}/tables`, and
`.../tables/{name}/columns` all returned `200` with a bare bearer token and
**no `sessionId` query parameter at all** (Finding 88) — contradicting every
example in the CAS Management API's own reference documentation, which shows
a `sessionId` on nearly every caslib/table call. The parameter turns out to be
for *session-scoped* resources (a user's personal caslib, a session-scoped
table) rather than a requirement for browsing at all: every global-scope
caslib and table on this deployment browsed cleanly without one. This means
8a's tree — servers, global caslibs, tables, columns — needs nothing beyond
the same bearer-token-per-request client this project already has, and no CAS
session lifecycle of its own for that surface. See the "genuinely undecided"
note below for the session-scoped case this finding deliberately does not
settle.

**The whole client this project already built for Compute is a generic Viya
REST client wearing a Compute-shaped name, and casManagement is the second
proof of it.** `src/compute/client.ts`'s `ComputeClient` takes a deployment
`root` and a token function, follows any `Link` it is handed (method, href,
request/response media types all read off the link, never composed), and
translates the same `+json`-suffix convention (`src/compute/links.ts`'s
`computeMediaType`) that `casManagement`'s own root `apiMeta` response uses
verbatim — bare `application/vnd.sas.collection` and
`application/vnd.sas.cas.server` in every `links[]` entry, exactly the shape
`computeMediaType` exists to correct before the request goes out (confirmed
directly in Finding 87's raw response). Nothing in `client.ts` or `links.ts`
imports anything Compute-specific, and nothing about a `casManagement` request
needs a session at all for the read paths above. **8a should not write a new
HTTP layer.** It should either import `createComputeClient`/`resolveHref`/
`findLink` directly under a new `src/cas/` module, or — better, and worth
deciding deliberately rather than by default — this is the moment to do the
promotion Phase 7 already flagged as an open question (`links.ts` moving to a
session-agnostic shared home) and resolve it by simply *using* the promoted
module from two independent features rather than debating it in the abstract
first. Either way, the actual new code in 8a is the `casManagement`-specific
link relations to follow (`caslibs`, `tables`, `columns`) and the tree/adapter
types around them, not another request/response/media-type/ETag layer.

**8b's core premise is now proven live, not merely plausible.** The whole
point of Phase 8 existing — "a documented pattern for getting an authenticated
CAS session inside a Python cell without the user handling credentials" — was
settled by Finding 91: a `PROC PYTHON` cell in a live Compute session
authenticated to CAS using **the exact same Viya access token this project's
`ComputeSessionManager` already borrows per request**, with no username, over
both the binary protocol (the CAS controller's internal cluster hostname,
port `5570`) and the REST/HTTP protocol (`https://<internal-host>:8777/cas-shared-default-http/`).
Both returned a working `CASResults` object (`serverstatus()` reporting CAS
`4.00`). `swat`'s own current documentation (`sassoftware.github.io/python-swat`,
"Authentication" → "OAuth Token") confirms this is the supported, forward path
— `password=<oauth token>` with `username` omitted — and notes userid/password
auth is being deprecated in `swat`'s favor of exactly this route. **There is
no separate CAS credential to provision, ask the user for, or store**: the
same borrowed-per-request token `clientFor` already produces for Compute calls
is sufficient for CAS too, which is the entire value proposition
`PRODUCTION_PLAN.md` promised for this phase.

**8b's real design problem is not authentication — it is how the token
reaches the cell without being logged, and this session found the failure
mode by causing it.** Settling Finding 91 required getting the token into the
Python cell somehow, and the obvious way — an inline `PROC PYTHON`
`submit`/`endsubmit` block setting `os.environ["CASTOKEN"] = "<token>"` —
**echoed the full token in plaintext into the job log** (Finding 92), because
`submit`/`endsubmit` echoes submitted source verbatim, the same log-echo
behaviour this project's own [ADR-0014](../adr/0014-python-is-submitted-as-an-uploaded-file.md)
already reasoned about for Python source fidelity — this session simply
confirmed it also applies, with much higher stakes, to a credential written
as a literal. The token that leaked this way had to be treated as
compromised and the developer notified to rotate it. **8b must not deliver a
token to the session via any inline submitted code, SAS or Python, ever** —
the log-echo path is not a corner case to special-case around, it is the
default behaviour of the exact mechanism a naive implementation would reach
for first. The safe pattern is to reuse the upload/fileref mechanism ADR-0014
already built for exactly this reason: write the token to a file the session
can read (the same byte-for-byte, never-logged path Python source itself
travels today), and give the user's Python a small helper or documented
snippet that reads that file — never a string literal, never an environment
variable set via a logged statement. Exactly *how* that file is delivered
(reuse `src/compute/fileref.ts`'s upload path directly, or a purpose-built
variant) is 8b's own design work, not settled here.

**8b's token-lifetime question is open, and is a real gap `swat` does not
paper over.** `ComputeSessionManager`'s own doc comments are explicit that an
access token is "measured in minutes" while a Compute session (900 seconds
idle) and, presumably, a user's open `swat.CAS()` connection can both outlive
it — and unlike `ComputeClient`, which takes a token as a **function**
re-invoked per request specifically so a long-lived session survives a token
refresh, `swat.CAS()` takes a credential once, at connect time, as a plain
value. A CAS connection opened at the start of a long-running notebook-style
session could start failing authentication partway through with nothing in
this project's control to refresh it silently — `swat` has no equivalent
seam. This is not probed or resolved here (the test token behind Finding 91
carried an unusually long expiry, not representative of an ordinary user
token) and is 8b's own design question: whether to document "reconnect if a
CAS action fails with an auth error" as the honest answer, or to build
something more automatic.

**8a's scope should stop at global-scope resources, deliberately, not by
oversight.** Every caslib and table Finding 88 browsed was global-scope; a
*session-scoped* caslib (a user's personal library, `CASUSER(user)` in CAS's
own terms) requires an actual CAS session — created via `POST
.../servers/{name}/sessions`, itself a resource this project would then have
to track, refresh, and tear down, a second, independent session lifecycle
alongside `ComputeSessionManager`'s existing one and unrelated to it. Nothing
above proves that is hard, only that it is a **second lifecycle**, and Phase
7's own library browser deliberately never needed one because it rides
entirely on the Compute session Phase 3 already holds. Recommendation, not a
settled decision: scope 8a to global caslibs/tables/columns only — the
`WORK`-equivalent personal-library case is a later slice's problem if users
ask for it, the same way Phase 7 scoped `WORK`/`SASHELP`/site-registered
libraries first and left CAS libraries to this phase rather than inventing
scope it did not need.

**What does not port — there is nothing to not-port, which is itself worth
recording.** Unlike Phases 6 and 7, this phase has no upstream feature whose
non-goals need naming. The one adjacent non-goal already settled elsewhere:
Phase 7's own Plan section already confirmed CAS caslib browsing is
correctly this phase's problem, not a gap in Phase 7's own Library Navigator
port (upstream's Library Navigator is itself Compute-session-scoped only, no
CAS caslib browsing lives in it either).

**What is genuinely undecided — not one of 8a/8b/8c, not a settled non-goal
either:**

- **Whether 8a needs its own CAS-session lifecycle for session-scoped
  caslibs**, covered above — a real design question, not a detail, if a later
  slice takes it on.
- **8b's token-lifetime story**, covered above — document a manual
  reconnect-on-auth-failure story, or build something automatic.
- **Exactly how the token file reaches the session for 8b** — reuse
  `src/compute/fileref.ts`'s existing upload path as-is, or a narrower
  purpose-built variant (a token has different lifetime and sensitivity
  characteristics than a Python source file; whether that difference
  justifies its own code path is 8b's call).
- **Whether the `links.ts`/`client.ts` promotion Phase 7 flagged happens here,
  in 7a, or not at all** — this phase adds a second, independent caller with
  no session concept in it at all, which is a stronger argument for promoting
  now than Phase 7's own single-caller framing had. Not decided this session;
  flagged the same way Phase 7 flagged it for whichever of 7a/8a lands first.
- **8c's shape depends entirely on 7b's outcome.** Phase 7's own "genuinely
  undecided" note (React + ag-grid vs. hand-rolled grid) has not been settled
  as of this scoping session — 8c ("CAS tables in the data viewer") is a
  second consumer of whatever 7b builds, following the same table/column/rows
  shape against `casManagement`'s tables instead of `DataAccessApi`'s. Nothing
  in 8c should be designed before 7b exists to extend.

**Testing.** Same shape this project committed to for Phases 6 and 7: a new
`test/helpers/recorded-cas-management.ts` (or similar) plus fixtures under
`test/fixtures/cas/`, mocking at the HTTP boundary. Findings 87–90 below are
real, confirmed shapes to build those fixtures from — this phase file
deliberately does not name any of the 68 caslibs beyond the generic,
non-identifying ones (`Public`, `Formats`, `Samples`, `SystemData`) already
named in SAS's own public sample documentation, per this project's "nothing
deployment-identifying" rule; several of the others read as customer- or
business-identifying.

**Dialect risk, flagged not resolved.** One cadence, one deployment, same as
every phase's own probe pass before a second-deployment check exists. Nothing
in the CAS Management API's public documentation carries a visible version
branch, and this session's probe didn't contradict that, but 8a's own probe
pass should check a second cadence before depending on that absence
everywhere, the same recommendation every phase before this one has made.

*Slices, refined from `PRODUCTION_PLAN.md`'s original one-line sketch:*

- **8a — CAS browsing (servers, global caslibs, tables, columns).** *Small/Medium*
  — smaller than either Phase 6 or 7's own adapter work, because Finding 88
  removed the session-lifecycle question for the common case and Finding 87
  showed the existing `ComputeClient`/`links.ts` machinery already fits
  `casManagement`'s hypermedia shape without modification. What 8a still owns:
  the promotion decision above (or a `src/cas/` module that imports the
  Compute layer directly, if the promotion is deferred), the tree/view
  container coordination with whichever of 6a/7a has landed by then, and a
  second-cadence probe.
- **8b — Authenticated CAS session helper.** *Medium* — the credential-delivery
  design is the entire slice: never inline, reuse or extend the
  ADR-0014 upload path, decide the token-lifetime story, and ship a documented
  snippet or small helper a user's Python cell calls to get a working
  `swat.CAS()` connection without ever seeing or handling a credential
  themselves. The authentication mechanism itself (`password=<token>`, no
  username) is settled by Finding 91 and needs no further design.
- **8c — CAS tables in the data viewer.** *Medium*, blocked on 7b's own
  React/ag-grid-vs-hand-rolled decision existing to extend. A second consumer
  of whatever grid/paging/column-metadata shape 7b builds, pointed at
  `casManagement`'s `tables`/`columns` rather than `DataAccessApi`'s.

*Exit:* a user can browse CAS servers, global caslibs, and tables from a tree
view without opening any CAS session themselves; get a working, authenticated
`swat.CAS()` connection inside a Python cell by following one documented
step, with no credential of their own to acquire or paste in; and open a CAS
table in the same paged, sortable, filterable grid Phase 7 built for Compute
session tables — a capability upstream's SAS extension does not offer at
all, which is this phase's whole reason for existing.

---

Everything above is the product. Everything below is breadth, and each phase
is independently valuable and independently shippable. Order is a
recommendation, not a dependency chain — reprioritise based on what users
actually ask for once v0.1.0 is in their hands.

---

## Runbook

_Scoped 2026-09-03, before any code was written — technical grounding (what
this phase does and does not need to build) came from the codebase survey
described in the Plan section above and eight live probes against `verde`
(Findings 87–92 below, one of them a decisive, throwaway-session live test of
8b's core premise). **Recommended execution order: 8a → 8b → 8c**, matching
the dependency chain the Plan section implies (a browsable tree before a
session helper; 8c blocked on 7b regardless of 8a/8b's own timing). Nothing
here is a hard technical barrier — this is a recommendation, not a dependency
lock._

☐ **8a — CAS browsing (servers, global caslibs, tables, columns).**

- ☐ Decide the `links.ts`/`client.ts` promotion question (Plan, above) —
  promote to a session-agnostic shared module now that two independent
  features want it, or import the Compute-named modules directly under
  `src/cas/` and defer the promotion again.
- ☐ A second-cadence/second-deployment probe of `GET /casManagement/servers`,
  `.../caslibs`, `.../caslibs/{name}/tables`, `.../tables/{name}/columns` —
  Findings 87–90 confirm the shape on one Viya 4 deployment (`verde`).
- ☐ Confirm the no-`sessionId`-needed reading (Finding 88) holds for a
  *personal* caslib too, or confirm it does not and scope that out
  explicitly rather than by silent omission.
- ☐ Design the tree/view-container coordination with whichever of 6a/7a has
  landed by the time 8a starts — add to the existing `viewsContainers` entry,
  per the same convention Phase 7 already committed to for its own tree.
- ☐ Build the caslib/table/column types and tree provider under `src/cas/`
  (name TBD to this project's own conventions).
- ☐ `test/helpers/recorded-cas-management.ts` + `test/fixtures/cas/`, built
  from Findings 87–90's scrubbed shapes.

☐ **8b — Authenticated CAS session helper.**

- ☐ Design the token-delivery mechanism — extend
  `src/compute/fileref.ts`'s upload path or build a narrower variant — and
  confirm by hand that it does **not** appear in the job log the way
  Finding 92's inline attempt did. This is the one check this slice cannot
  skip before it is considered done.
- ☐ Decide and document the token-lifetime story (Plan, above): manual
  reconnect-on-auth-failure, or something more automatic.
- ☐ Ship the documented snippet/helper a user's Python cell calls to get a
  connected `swat.CAS()` object, covering both the binary and REST/HTTP forms
  Finding 91 confirmed working (`swat`'s own "Binary vs. REST" documentation
  page covers the tradeoff; this project doesn't need to re-explain it, only
  point at it).
- ☐ Unit-test the token-delivery path at the HTTP-mock boundary, the same as
  every other upload-based mechanism this project ships.

☐ **8c — CAS tables in the data viewer.**

- ☐ Blocked on 7b's React/ag-grid-vs-hand-rolled decision existing to extend
  — do not start designing this slice before that decision is made.
- ☐ Paginated datasource backed by `casManagement`'s table/column/row
  endpoints, following whatever shape 7b established for
  `DataAccessApi`'s equivalent.

---

## Probe findings

All probes below ran 2026-09-03 against `verde` (Viya 4), via the
`viya-api-probe` skill. Continuing this project's global finding numbering
from Finding 86 (`phase-7.md`). All but one (Finding 91's decisive live test)
were plain, read-only `GET`s with a bare bearer token; Finding 91 required a
throwaway Compute session, created via `POST /compute/contexts/{id}/sessions`
against the "SAS Studio compute context" and deleted immediately after,
confirmed gone by a `404` read-back on `.../state`.

**Finding 87 — `casManagement`'s root `apiMeta` is hypermedia-driven in
exactly the shape `src/compute/client.ts`/`links.ts` already handle.**
`GET /casManagement/` (`Accept: application/vnd.sas.api+json`) returned a
`links[]` array carrying `method`/`rel`/`href`/`type`/`itemType`, with every
vendor media type bare (`application/vnd.sas.collection`,
`application/vnd.sas.cas.server`) rather than `+json`-suffixed — the exact
correction `computeMediaType` exists to make before a request goes out. This
deployment reports exactly one CAS server, `cas-shared-default` (controller,
2 workers, `restPort: 8777`, `restProtocol: https`) — its own `links[]`
carries `caslibs`, `sessions`, `createSession`, `nodes`, `metrics`,
`connection`, `stopLists`, a `casProxy` relation, and a `dataSource` relation
into `/dataSources/providers/cas/...`.

**Finding 88 — caslib and table collections do not require a `sessionId`
query parameter, contradicting every example in the CAS Management API's own
reference documentation.** `GET /casManagement/servers/cas-shared-default/caslibs?limit=100`
returned `200` with a bare bearer token and no `sessionId` at all — `count:
68`, every item carrying its own `links[]` (`tables`, `sources`, `patch`,
`delete`, `dataSource`). Four of the 68 are the generic, non-identifying
names SAS's own sample documentation already uses (`Formats`, `Public`,
`Samples`, `SystemData`); the rest are not named here per this project's own
"nothing deployment-identifying" rule. `GET .../caslibs/Public/tables?limit=10`
likewise returned `200` with no `sessionId` — `count: 56`, confirming the
same reading holds for the tables collection under a caslib, not just the
caslib collection itself. **Documented:** every one of the 40-odd examples in
`sassoftware/devsascom-rest-api-samples`'s `casManagement.md` shows a
`sessionId` query parameter on caslib/table calls. **Observed (Viya 4,
2026-09-03):** entirely optional for global-scope browsing; not probed
against a session-scoped (personal) caslib, which may be the actual case the
documented examples are written for.

**Finding 89 — a table's real metadata (columns, row/column counts) is not
available until the table is loaded, and asking anyway is a `404`, not an
empty result.** Every table item in Finding 88's `Public` listing carried
`"state": "unloaded"`, `"rowCount": 0`, `"columnCount": 0` in its own
collection entry. `GET .../tables/NREL_10X/columns` against one such
unloaded table returned **`404`** — `"errorCode": 12204, "message": "The
table NREL_10X could not be located in caslib Public of Cloud Analytic
Services."` — not an empty `items: []` collection. This confirms the CAS
Management API's own documented "just-in-time load" pattern
(`PUT .../tables/{name}/state?value=loaded`) is load-bearing for 8a's UX, not
an optional performance path: a tree that shows a table's real column list or
row count on demand needs to trigger (or prompt for) a load first, and must
read a `404` on an unloaded table's columns as "not loaded yet", not as "this
table doesn't exist" — the same two-readings-of-one-status-code shape
`job.ts`'s `asSessionGone` already reasons about for a different resource.

**Finding 90 — the separate "CAS REST" service (`developer.sas.com/rest-apis/cas`)
is not deployed on this deployment; only `casManagement` is.** The server's
own `casProxy` link relation (`GET .../servers/cas-shared-default/cas`)
returned `404` — `"There is no handler defined for the path..."` — and a bare
`GET /cas/` on the deployment root also `404`s. This matches
`casManagement.md`'s own caveat that some resource links "are operational
only if the corresponding service has been deployed at the referenced
location," now directly confirmed rather than assumed. **8a must not assume
the separate CAS REST API is available and must not build against it** —
`casManagement` is the whole of what this deployment offers for CAS
browsing. The server's own `connection` relation
(`GET .../servers/cas-shared-default/connection`) reports the CAS
controller's **internal cluster hostname** and binary port
(`sas-cas-server-default-client:5570`) — not something reachable from outside
the cluster, and not needed for `casManagement` browsing regardless, since
every read in Findings 87–89 went through `casManagement`'s own REST
endpoints rather than this connection info.

**Finding 91 — decisive: a `PROC PYTHON` cell can authenticate to CAS using
the exact same Viya access token this project already borrows per request,
over both CAS transports, with no separate credential.** A throwaway Compute
session (`SAS Studio compute context`) ran `swat.CAS('sas-cas-server-default-client',
5570, password=<the session's own bearer token>)` (binary) and
`swat.CAS('https://sas-cas-server-default-client:8777/cas-shared-default-http/',
password=<same token>)` (REST/HTTP) — **both connected successfully**,
`serverstatus()` reporting CAS version `4.00` on each, using the CAS
controller's internal cluster hostname directly (reachable from inside the
Compute session's own network, unlike from this sandbox). No username was
given, matching `swat`'s own current documentation
(`sassoftware.github.io/python-swat`, "Authentication" → "OAuth Token"):
`password=<oauth token>` with `username` omitted, and a documented recommendation
to prefer this over userid/password (which the same page says is being
deprecated). **This settles Phase 8's central premise**: no separate CAS
credential needs to be provisioned, requested from the user, or stored —
the same per-request token `ComputeSessionManager.clientFor` already produces
for Compute calls authenticates CAS too.

**Finding 92 — critical, security-relevant: the naive way to get that token
into the cell leaks it into the job log in plaintext.** Settling Finding 91
required delivering the token to the Python cell somehow; the first attempt
used an inline `PROC PYTHON` `submit`/`endsubmit` block setting
`os.environ["CASTOKEN"] = "<token>"`. **The job log echoed the full token
back verbatim**, because `submit`/`endsubmit` echoes submitted source as
input, unconditionally — not a bug in this deployment, the documented and
expected behaviour of inline submission, and the same log-echo property
[ADR-0014](../adr/0014-python-is-submitted-as-an-uploaded-file.md) already reasoned
about for Python source fidelity, now confirmed to apply just as much to a
credential written as a literal. The exposed token was reported to the
developer for rotation; the throwaway Compute session itself was deleted and
confirmed gone (`404` on `.../state`) immediately after. **Consequence for
8b, non-negotiable: never deliver a token to a session via inline submitted
code, SAS or Python.** The safe path is the same upload/fileref mechanism
ADR-0014 already built to carry Python source without going through the
echoed `submit` path — write the token to a file, have the user's Python read
the file, never a literal and never an environment variable set via a logged
statement.

**Not probed this session, left open:** a second Viya 4 cadence/deployment
(the dialect-risk item above); whether Finding 88's no-`sessionId`-required
reading holds for a session-scoped (personal) caslib, or whether that case
genuinely requires the CAS-session lifecycle the Plan section flagged as
undecided; the `PUT .../tables/{name}/state?value=loaded` JIT-load call
itself (a mutating probe, deliberately out of scope for this pass, though
Finding 89 already establishes why 8a needs it); and whether a *second*
concurrent `swat.CAS()` connection against the same session's token behaves
any differently from the single connections Finding 91 tested. All are
8a/8b implementation-time probes, not settled here.
