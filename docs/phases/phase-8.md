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
and eight read-only-except-one live probes against `verde` (Findings 8.1–8.6
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
**no `sessionId` query parameter at all** (Finding 8.2) — contradicting every
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
directly in Finding 8.1's raw response). Nothing in `client.ts` or `links.ts`
imports anything Compute-specific, and nothing about a `casManagement` request
needs a session at all for the read paths above. **8a should not write a new
HTTP layer, and the promotion question this bullet used to flag as open is
already settled.** The `links.ts`/`client.ts` promotion this Plan section
originally raised as a question for whichever of 7a/8a landed first
([ADR-0025](../adr/0025-shared-wire-layer.md)) happened in 6a-i, before either
7a or 8a existed: the HATEOAS link helpers and the
`application/vnd.sas.error+json` reader now live in a service-agnostic
`src/wire/` (`src/wire/links.ts`, `src/wire/viyaError.ts`), promoted out of
`src/compute/` specifically so a second Viya service's client could share
them without depending on `src/compute/` — and Phase 7's `src/data/` already
is that second caller. **8a's own job is simply to become the third**: build
`src/cas/` on top of `src/wire/` the same way `src/content/` (ADR-0026) and
`src/data/` (ADR-0027) already do, following whatever `casManagement`-specific
link relations it needs (`caslibs`, `tables`, `columns`) and the tree/adapter
types around them — no new request/response/media-type/ETag layer, and no
promotion decision left to make.

**8b's core premise is now proven live, not merely plausible.** The whole
point of Phase 8 existing — "a documented pattern for getting an authenticated
CAS session inside a Python cell without the user handling credentials" — was
settled by Finding 8.5: a `PROC PYTHON` cell in a live Compute session
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
mode by causing it.** Settling Finding 8.5 required getting the token into the
Python cell somehow, and the obvious way — an inline `PROC PYTHON`
`submit`/`endsubmit` block setting `os.environ["CASTOKEN"] = "<token>"` —
**echoed the full token in plaintext into the job log** (Finding 8.6), because
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
seam. This is not probed or resolved here (the test token behind Finding 8.5
carried an unusually long expiry, not representative of an ordinary user
token) and is 8b's own design question: whether to document "reconnect if a
CAS action fails with an auth error" as the honest answer, or to build
something more automatic.

**8a's scope should stop at global-scope resources, deliberately, not by
oversight.** Every caslib and table Finding 8.2 browsed was global-scope; a
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
- ~~Whether the `links.ts`/`client.ts` promotion Phase 7 flagged happens here,
  in 7a, or not at all~~ — **settled 2026-09-11, at 8a's own start
  ([ADR-0033](../adr/0033-cas-adapter-shape.md)): already done, in 6a-i.** The
  promotion this bullet asked about happened before either 7a or 8a existed
  (ADR-0025); `src/cas/` simply becomes the third caller of `src/wire/`,
  the same way `src/data/` was already the second. No further promotion is
  needed — `CasAdapter` is built directly on `src/wire/` and its own small
  `CasClient`, mirroring `ContentAdapter`'s shape rather than
  `LibraryAdapter`'s (Finding 8.2/8.7: no session for global-scope browsing).
- **8c's shape depends entirely on 7b's outcome.** Phase 7's own "genuinely
  undecided" note (React + ag-grid vs. hand-rolled grid) has not been settled
  as of this scoping session — 8c ("CAS tables in the data viewer") is a
  second consumer of whatever 7b builds, following the same table/column/rows
  shape against `casManagement`'s tables instead of `DataAccessApi`'s. Nothing
  in 8c should be designed before 7b exists to extend.

**Testing.** Same shape this project committed to for Phases 6 and 7: a new
`test/helpers/recorded-cas-management.ts` (or similar) plus fixtures under
`test/fixtures/cas/`, mocking at the HTTP boundary. Findings 8.1–8.4 below are
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
  — smaller than either Phase 6 or 7's own adapter work, because Finding 8.2
  removed the session-lifecycle question for the common case and Finding 8.1
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
  username) is settled by Finding 8.5 and needs no further design.
- **8c — CAS tables in the data viewer.** *Medium*, blocked on 7b's own
  React/ag-grid-vs-hand-rolled decision existing to extend. A second consumer
  of whatever grid/paging/column-metadata shape 7b builds, pointed at
  `casManagement`'s `tables`/`columns` rather than `DataAccessApi`'s.

*Exit:* a user can browse CAS servers, global caslibs, tables, and — once a
table is loaded — its columns, from a tree view without opening any CAS
session themselves; get a working, authenticated `swat.CAS()` connection
inside a Python cell by following one documented step, with no credential of
their own to acquire or paste in; and open a CAS table in the same paged,
sortable, filterable grid Phase 7 built for Compute session tables — a
capability upstream's SAS extension does not offer at all, which is this
phase's whole reason for existing.

> **Scope note, settled 2026-09-11 at 8a's own start.** This section's own
> wording disagreed with itself on how deep 8a's tree goes: the 8a slice
> bullet above already said "servers, global caslibs, tables, columns," but
> this Exit paragraph — until this note — stopped at tables, mirroring 7a's
> own scope (7a's tree stops at a table leaf; columns were 7b/7c's problem,
> reached only once a table is opened in the data viewer). Asked directly:
> **8a includes columns**, and therefore the JIT-load path Finding 8.3
> flagged (`PUT .../tables/{name}/state?value=loaded`) is 8a's own problem,
> not deferred to 8c. See Finding 8.8 for the confirmed load-toggle shape and
> [ADR-0033](../adr/0033-cas-adapter-shape.md) for how `CasAdapter.getColumns`
> uses it.

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
(Findings 8.1–8.6 below, one of them a decisive, throwaway-session live test of
8b's core premise). **Recommended execution order: 8a → 8b → 8c**, matching
the dependency chain the Plan section implies (a browsable tree before a
session helper; 8c blocked on 7b regardless of 8a/8b's own timing). Nothing
here is a hard technical barrier — this is a recommendation, not a dependency
lock._

☑ **8a — CAS browsing (servers, global caslibs, tables, columns).** Done.

- ☑ Decide the `links.ts`/`client.ts` promotion question (Plan, above) —
  **already done, in 6a-i** (ADR-0025); `src/cas/` is the third caller, no
  further promotion needed. [ADR-0033](../adr/0033-cas-adapter-shape.md).
- ☐ A second-cadence/second-deployment probe of `GET /casManagement/servers`,
  `.../caslibs`, `.../caslibs/{name}/tables`, `.../tables/{name}/columns` —
  Findings 8.1–8.4 confirm the shape on one Viya 4 deployment (`verde`);
  Finding 8.7 re-confirmed the identical shape on the same deployment
  2026-09-11. **Still not a genuine second cadence** — `innov`'s stored
  credential is stale, left open the same way every prior phase's
  single-cadence caveat has been.
- ☐ Confirm the no-`sessionId`-needed reading (Finding 8.2) holds for a
  *personal* caslib too, or confirm it does not and scope that out
  explicitly rather than by silent omission. **Still open** — Finding 8.7
  found every one of the 68 caslibs on `verde` is `scope: "global"`, so there
  is no personal caslib on this deployment to test against.
- ☑ Design the tree/view-container coordination — a third view,
  `pythonOnViya.casExplorer`, added to the existing `pythonOnViya`
  `viewsContainers` entry alongside SAS Content and SAS Libraries.
- ☑ Build the caslib/table/column types and tree provider under `src/cas/`
  — `types.ts`/`problems.ts`/`client.ts`/`casSession.ts`/`adapter.ts`/
  `presentation.ts` (`vscode`-free); `casTree.ts`/`casExplorer.ts` (thin
  `vscode` shells), mirroring `src/content/`'s file layout and naming.
- ☑ `test/helpers/recorded-cas.ts` + `test/fixtures/cas/`, built from
  Findings 8.1–8.3/8.7/8.8's scrubbed shapes (synthetic table/caslib names
  beyond the four generic caslibs, per this project's own convention).

`npm run verify` green (1668 unit; coverage 95.82/95.46/95.66/95.82
statements/branches/functions/lines — `.c8rc.json`'s ratchet raised from
94/95/94/94 in this same slice), 382 integration passing,
`npm run check:docs` green (the generated reference picked up the new
`pythonOnViya.refreshCasExplorer` command and `CAS` view).

☐ **8b — Authenticated CAS session helper.**

- ☐ Design the token-delivery mechanism — extend
  `src/compute/fileref.ts`'s upload path or build a narrower variant — and
  confirm by hand that it does **not** appear in the job log the way
  Finding 8.6's inline attempt did. This is the one check this slice cannot
  skip before it is considered done.
- ☐ Decide and document the token-lifetime story (Plan, above): manual
  reconnect-on-auth-failure, or something more automatic.
- ☐ Ship the documented snippet/helper a user's Python cell calls to get a
  connected `swat.CAS()` object, covering both the binary and REST/HTTP forms
  Finding 8.5 confirmed working (`swat`'s own "Binary vs. REST" documentation
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
`viya-api-probe` skill. This phase predates the 2026-09-09 switch to
phase-scoped `N.x` finding numbers (`STATUS.md`, repo-root `CLAUDE.md`) and
originally kept its own findings under the project's old global sequence
(continuing from Finding 86, `phase-7.md`, since renumbered `7.4` under the
new scheme). **Renumbered `8.1`–`8.6` at the Phase 7→8 housekeeping
checkpoint (2026-09-11), per `CLAUDE.md`'s rule that a phase's
still-globally-numbered findings move to `N.x` once that phase is actually
picked up** — this is that point, since Phase 8 is next. Any new finding
recorded from here on continues as `8.7` onward. All but one (Finding 8.5's
decisive live test)
were plain, read-only `GET`s with a bare bearer token; Finding 8.5 required a
throwaway Compute session, created via `POST /compute/contexts/{id}/sessions`
against the "SAS Studio compute context" and deleted immediately after,
confirmed gone by a `404` read-back on `.../state`.

**Finding 8.1 — `casManagement`'s root `apiMeta` is hypermedia-driven in
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

**Finding 8.2 — caslib and table collections do not require a `sessionId`
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

**Finding 8.3 — a table's real metadata (columns, row/column counts) is not
available until the table is loaded, and asking anyway is a `404`, not an
empty result.** Every table item in Finding 8.2's `Public` listing carried
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

**Finding 8.4 — the separate "CAS REST" service (`developer.sas.com/rest-apis/cas`)
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
every read in Findings 8.1–8.3 went through `casManagement`'s own REST
endpoints rather than this connection info.

**Finding 8.5 — decisive: a `PROC PYTHON` cell can authenticate to CAS using
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

**Finding 8.6 — critical, security-relevant: the naive way to get that token
into the cell leaks it into the job log in plaintext.** Settling Finding 8.5
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

**Finding 8.7 — re-confirmed live at 8a's own start (2026-09-11, `verde`),
read-only: Findings 8.1–8.3 hold exactly, on the same deployment and
cadence.** `GET /casManagement/` still returns the identical apiMeta shape
(bare vendor media types; the root's own `getServers` relation carries a
real, root-relative `href` — `/casManagement/servers` — not merely a
documentation-only operation-catalog entry, confirmed by inspecting the link
directly rather than assuming it). `GET .../servers` still reports exactly
one server, `cas-shared-default`, `restPort 8777`/`https`, with the same link
set Finding 8.1 recorded. `GET .../caslibs?limit=100` still needs no
`sessionId` — `count: 68`, and this pass additionally checked every item's
`scope`/`hidden` fields directly: **all 68 report `scope: "global"`,
`hidden: false`** — no session-scoped or hidden caslib exists on this
deployment to observe, which is consistent with (not new evidence against)
the Plan section's decision to defer session-scoped caslib support to a
later slice. `GET .../caslibs/Public/tables?limit=10` still needs no
`sessionId` and still reports `count: 56`, every item `state: "unloaded"`,
`rowCount`/`columnCount` `0`. **Not a second cadence**: this is the same
`verde` deployment Findings 8.1–8.6 probed, re-checked because it is what was
reachable this session — `innov`'s stored credential is stale (per the
developer), not a network failure this time, so the genuine second-cadence
check the Runbook asks for is still open.

**Finding 8.8 — decisive, approved mutating probe: the JIT-load toggle is a
bodyless `PUT` with a query parameter, and its response is plain text, not
JSON.** `docs/phases/phase-8.md`'s own Plan section originally scoped 8a to
stop at tables, deferring the JIT-load question Finding 8.3 raised; 8a was
then scoped to include columns instead (see the Exit-criteria scope note
above), which makes this probe 8a's own problem. Approved by the developer,
scoped to `Formats.USERFORMATS3` (a generic-caslib system table, chosen
specifically so nothing customer-identifying was touched) and run
read-then-write-then-restore, mirroring Finding 8.5/8.6's own
throwaway-and-clean-up discipline:

1. **Before:** `GET .../caslibs/Formats/tables/USERFORMATS3` — `state:
   "unloaded"`, `rowCount: 0`, `columnCount: 0`.
2. **`PUT .../tables/USERFORMATS3/state?value=loaded`** — `200`, body
   `"loaded"`, `Content-Type: text/plain; charset=utf-8`. **No request body
   at all** — the documented `?value=loaded` query parameter is the whole
   mechanism, confirming the CAS Management API's own documented shape
   directly rather than assuming it. The response is plain text even though
   the `updateState` link's own `responseType` advertises
   `application/json,text/plain` (a real documentation/link-metadata-vs-observed
   gap, not a defect: a client that tried to parse this as JSON would fail on
   every call).
3. **After load:** the same table's `columns` collection, previously a `404`
   (Finding 8.3), now returns `200` — `count: 2`, real column metadata
   (`{name, type, formattedLength, ...}`, a narrower shape than
   `DataAccessApi`'s own `Column` — no `label`/`format`/`informat`). The
   table's own representation now reports `state: "loaded"`, `rowCount: 1`,
   `columnCount: 2`. **The `columns` link itself is unchanged by loading** —
   the same href that `404`'d before the load succeeds after it, so a client
   does not need to re-fetch the table's own representation after loading,
   only retry the identical `columns` request.
4. **Restore:** `PUT .../tables/USERFORMATS3/state?value=unloaded` — `200`,
   body `"unloaded"`. A read-back confirmed the table returned to `state:
   "unloaded"`, `rowCount: 0`, `columnCount: 0` — the deployment left exactly
   as found, the same discipline Finding 8.5/8.6's throwaway session
   followed.

Separately, this probe also confirmed a real CAS column's field shape
against an already-loaded system table (`SystemData.SASVIYATYPES`, read-only,
no mutation needed since it was already loaded): `{version, name, type,
formattedLength, numberFormatLength, numberFormatDecimals, indexed, index}`
— and, on the table loaded by this probe, one column additionally carried
`rawLength`. `src/cas/types.ts`'s `CasColumnItem` reads only `name`/`type`/
`formattedLength`, per `docs/adr/0033-cas-adapter-shape.md`'s no-speculative-
fields reasoning.

**Not probed this session, left open:** a genuine second Viya 4
cadence/deployment (the dialect-risk item above — `innov`'s stored
credential is stale, not attempted this session); whether Finding 8.2's
no-`sessionId`-required reading holds for a session-scoped (personal)
caslib, or whether that case genuinely requires the CAS-session lifecycle
the Plan section flagged as undecided (no session-scoped caslib exists on
`verde` to test against — Finding 8.7); and whether a *second* concurrent
`swat.CAS()` connection against the same session's token behaves any
differently from the single connections Finding 8.5 tested. All remain
8b implementation-time probes (or a later slice's, for the session-scoped
caslib question), not settled here.
