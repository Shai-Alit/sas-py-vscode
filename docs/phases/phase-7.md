# Phase 7 — Libraries and data viewer

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 7 — Libraries and data viewer

**Scoped 2026-09-03**, from the same separate clone (`sas-py-vscode-cowork`)
Phase 6 was scoped from, while Phase 5's 5c-iii (release engineering) is in
progress on the primary working copy — kept apart for the same reason as
before, so this scoping session cannot collide with that work. Technical
grounding came from a codebase survey of both this repo and
`vscode-sas-extension` (`client/src/components/LibraryNavigator/`,
`client/src/connection/rest/RestLibraryAdapter.ts`, `client/src/panels/DataViewer.ts`
and `TablePropertiesViewer.ts`, `client/src/webview/useDataViewer.ts`/`TableFilter.tsx`)
and the generated `DataAccessApi` client (`client/src/connection/rest/api/compute.ts`),
plus this project's own `src/compute/` (`sessionManager.ts`, `job.ts`, `links.ts`), plus
six read-only-to-the-target-data live probes against `verde` (Findings 83–86
below; one throwaway session created and deleted to run them, confirmed gone
by a `404` read-back). **The first probe attempt this session failed at the
network layer** (the sandbox's egress proxy could not tunnel to `verde` —
`502` on every `CONNECT`) while a public host was reachable fine; a VPN
outage on the deployment side was the actual cause, confirmed after the fact.
Once it was restored, the probe ran cleanly — see the note near the end of
this section for what that means for whoever hits the same wall later. No
code was written this session.

**What this phase is.** `PRODUCTION_PLAN.md` §3.1 commits to "Library and
table browsing" (7a) and "Data viewer (paged, sortable)" (7b–7c, "React/ag-grid
panel ports"). The codebase survey confirms the framing but adds a fact the
one-liner doesn't capture: **the whole feature is session-scoped, not a
separate service.** Every `DataAccessApi` operation upstream's adapter calls —
`getLibraries`, `getTables`, `getColumns`, `getRows`, `getTable`,
`createView`, `deleteTable` — is a path under
`/compute/sessions/{sessionId}/data/…`. There is no Folders/Files-style
standalone service the way Phase 6's Content explorer needed one; a library
browser is a second lens onto **the same compute session** this project
already creates and holds in `ComputeSessionManager` to run Python. That is a
materially smaller lift than Phase 6's four-new-VS-Code-surfaces problem: the
session lifecycle, the profile-keyed session map, the token-borrowing
discipline, and the `asSessionGone` 404 reading in `session.ts`/`job.ts` are
all already built and, in principle, already reusable as-is.

**What ports closely, almost verbatim in shape:**

- The `LibraryItem`/`LibraryAdapter`/`LibraryModel`/`LibraryDataProvider`/
  `PaginatedResultSet` layering (`LibraryNavigator/types.ts`, `LibraryModel.ts`,
  `LibraryDataProvider.ts`, `PaginatedResultSet.ts`) — none of it is
  SAS-specific. `LibraryModel.getChildren` dispatches libraries vs. tables
  purely off `LibraryItem.type`; `PaginatedResultSet` is a generic
  start/end/sort/query callback wrapper with nothing in it that assumes SAS.
- The wire shape itself: `GET /sessions/{sessionId}/data` (libraries,
  `#summary`-suffixed variants for the `readOnly` flag), `GET
  /sessions/{sessionId}/data/{libref}#tables` (tables in a libref), `GET
  /sessions/{sessionId}/data/{libref}/{tableName}` (table info, `rowCount`
  etc.), `GET …/{tableName}/columns` (paged column metadata), and `GET
  …/{tableName}/rows` (paged row data, `start`/`limit`/`where`/
  `formatMissingValues`/`includeIndex` query params) — all standard
  `application/vnd.sas.collection+json` collections with the same
  `start`/`limit`/`count` paging shape `src/compute/contexts.ts` and
  `job.ts` already handle for other Compute collections.
- The read-only/actionable distinction (`LibraryItem.readOnly`, inherited from
  the owning library unless a table overrides it) is the same shape as Phase
  6's folder/file `readOnly` handling — a second application of a convention
  this project will already own once 6a lands, not a new one to invent.
  `WORK` is always writable and always present; `SASHELP` and most
  site-registered libraries are `readOnly: true`.
- `TableInfo`/`Column` field shapes (`TablePropertiesViewer.ts`'s consumption
  of them — `name`/`libref`/`type`/`label`/`engine`/`extendedType`/
  `rowCount`/`columnCount`/`logicalRecordCount`/`physicalRecordCount`/
  `recordLength`/`creationTimeStamp`/`modifiedTimeStamp`/
  `compressionRoutine`/`encoding`/`bookmarkLength` for a table; `name`/`type`/
  `length`/`format`/`informat`/`label` for a column) are generic SAS dataset
  metadata, not Python-vs-SAS-shaped.

**What needs rework, not a straight port:**

- **No adapter factory, same reasoning as 6a.** Upstream's
  `LibraryAdapterFactory` dispatches `ConnectionType.Rest` to
  `RestLibraryAdapter` and `{IOM, COM}` to `ItcLibraryAdapter`. This project
  has no `ConnectionType` concept at all (grep confirms — the only other hit
  is an unrelated legacy `profile/import.ts` name) and is Viya-REST-only by
  design (ADR-0007, ADR-0022). **7a should skip the factory and
  `ItcLibraryAdapter` entirely**: one concrete class implementing whatever
  this project's `LibraryAdapter`-equivalent interface turns out to be.
- **Session ownership is the real design question, and it's bigger than a
  straight port suggests.** Upstream's `RestLibraryAdapter.connect()` calls
  its own module-level `getSession()` — a process-global singleton, the same
  pattern the `LibraryDataProvider` doc comment on `ComputeSessionManager`
  already calls out as a limitation this project deliberately avoids
  (profile-keyed session map, not a singleton). A `LibraryAdapter` here needs
  to ask `ComputeSessionManager` for the *active profile's* session rather
  than owning a connection of its own — mechanically straightforward, but it
  means 7a's adapter is a consumer of `ComputeSessionManager`'s existing
  public surface, not a self-contained class the way upstream's is, and
  whoever writes it should read `ComputeSessionManager`'s own doc comments in
  full before assuming the shape.
- **The busy-submission guard raises a question upstream never had to
  answer — now settled, not merely theorized.** `ComputeSessionManager.
  startSubmission`/`endSubmission` refuse a second concurrent submission into
  the same session (finding 27's "refuse rather than queue", `busySubmissions`)
  because finding 29 left what a second submission does to a running session
  unobserved. `DataAccessApi` calls are a *different* resource path (`/data/…`,
  not `/jobs`), so the question was whether they're safe to issue while a job
  is executing in the same session. **Finding 85** measured it directly: a
  `getRows` call issued immediately after submitting a 15-second job returned
  `200` only after **14.911s** — not an error, not an immediate race, a wait
  matching the job's own duration almost exactly — against a **0.349s**
  baseline for the identical call once the session was idle. **The REST layer
  accepts the request and blocks it at the SAS kernel until the session frees
  up; it does not refuse it and does not run it concurrently.** That answers
  the UI question this bullet raised: browsing during an active run would not
  fail fast, it would hang silently for the run's whole duration — precisely
  the "busy clears before the session is actually free" failure shape Finding
  76 (Phase 4b) already found on the cancel path, now confirmed on this path
  too. 7a should treat a `DataAccessApi` call the same way `startSubmission`
  already treats a second run: check `ComputeSessionManager`'s busy state
  before issuing one, and refuse or queue with a visible "session busy"
  message, rather than let a browse action hang with no explanation.
- **Sorting is not client-side, and every re-sort is a mutation.**
  `RestLibraryAdapter.getSortedRows` doesn't sort locally — it calls
  `createView` (`POST`, `application/vnd.sas.compute.data.table.view.request+json`)
  to have the server build a sorted view, reads rows from *that* view, then
  `deleteTable`s it. Every column-sort click in the upstream grid is a
  create-view-read-delete round trip against the live session. That's worth
  naming explicitly for 7c: it's slower than a client-side sort, it's a
  second mutating call layered on top of the busy-guard question above, and a
  cancelled or failed delete leaves an orphan view object in the session that
  nothing currently reaps.
- **The 404-retry-reconnect pattern should read through this project's
  existing convention, not invent a parallel one.** `RestLibraryAdapter`'s
  `retryOnFail` treats a bare `404` as "session expired, reconnect and retry
  once" — exactly the shape `job.ts`'s `asSessionGone` and its accompanying
  doc-comment caveat ("cannot tell 'your session expired' from 'that job
  never existed' by status alone") already reason about for a different
  Compute resource. 7a should reuse that reading (and its documented caveat)
  rather than re-deriving the same ambiguity from scratch under a different
  name.
- **Command naming and the view container.** Upstream's commands
  (`SAS.viewTable`, `SAS.refreshLibraries`, `SAS.deleteTable`,
  `SAS.downloadTable`, `SAS.showTableProperties`, `SAS.collapseAllLibraries`)
  follow its own `SAS.<verb>` convention; this project's flat
  `pythonOnViya.<verb>` convention applies here exactly as it does in Phase
  6. More structurally: upstream's library tree (`librarydataprovider`) is a
  **second, sibling view inside the one `sas-view-container` activity-bar
  entry** that also hosts its content tree (`contentdataprovider`) and its
  (non-goal, see below) server tree — confirmed directly in upstream's
  `package.json`. **7a should add its view to the `viewsContainers` entry 6a
  creates, not contribute a second activity-bar icon** — a coordination note
  for whichever phase actually lands first, since neither has shipped code
  yet as of this scoping session.
- **CSV export writes to local disk**, via `fs.createWriteStream` and
  `window.showSaveDialog` — a filesystem-writing surface this project has not
  needed before (Phase 6's downloads, if taken on, would be the other
  candidate; see Phase 6's own "genuinely undecided" upload/download note).
  Worth deciding in 7c whether it shares code with whatever Phase 6 ends up
  building for its own download command, rather than each phase inventing
  its own local-file-write helper independently.

**What does not port — deliberate non-goals, already settled elsewhere:**

- **`ItcLibraryAdapter`** (IOM/COM) — covered above; this project is
  Viya-REST-only.
- **CAS libraries/caslibs.** Upstream's own Library Navigator is itself
  SAS-Compute-session-scoped only (no CAS caslib browsing lives in
  `LibraryNavigator/` at all) — so this is not even a port decision, just a
  confirmation that Phase 7's scope and upstream's actual shipped feature
  already agree, and that CAS is correctly Phase 8's problem
  (`PRODUCTION_PLAN.md`'s own phase split), not a gap opened by this phase.
- **The `serverdataprovider` tree** (upstream's separate "SAS Server" file
  browser, IOM/COM-only) — a different, already-excluded capability, per
  Phase 6's own non-goal note on `ContentSourceType.SASServer`.

**What is genuinely undecided — not one of 7a–7c, not a settled non-goal
either:**

- **The drag-and-drop "insert a reference" behavior.** Upstream's
  `LibraryDataProvider.handleDrag` puts a table's `uid` (a `libref.tablename`
  string) on the data transfer as plain text, so dropping a table onto a
  `.sas` editor inserts a bare `libref.tablename` reference — meaningful
  because `set libref.tablename;` and similar SAS syntax read a libref
  directly. Python has no equivalent implicit binding to a SAS libref; a
  meaningful analogue would have to synthesize something like a
  `pd.read_csv`-via-Compute call or a snippet naming the table, which is a
  real design question rather than a mechanical port. Left open for 7a,
  mirroring how Phase 6 left its own drag-and-drop snippet question open for
  6b.
- **React + ag-grid as this project's first React dependency.** Upstream's
  data viewer is a `ag-grid-react`/`ag-grid-community` grid (`^36.0.2`)
  rendered from a `.tsx` webview entry point built by its own esbuild
  context. This project's one existing webview (`src/webview/entry.ts`,
  ADR-0021) is hand-rolled DOM manipulation with no framework, no `.tsx`
  loader, and `tsconfig.webview.json`'s own `"types": []` carve-out — adding
  ag-grid means adding React, `ag-grid-community`, `ag-grid-react`, a `.tsx`
  type space, and a JSX loader to `esbuild.mjs`'s existing webview context
  (checked directly: today's context has no `jsx` option set at all). That
  is a real, first-of-its-kind dependency and toolchain decision, not a
  detail — weighed against hand-rolling a lighter paginated/virtualized table
  in the existing DOM style, which would need to reimplement column
  resize/pin, sort-indicator UI, a filter popover, and row virtualization for
  large tables from nothing. **Not decided this session** — flagged the same
  way Phase 6 flagged its `links.ts` promotion question, as the one decision
  7b's own author should make deliberately rather than defaulting into.

**Testing.** Same shape this project already committed to for Phase 6: a
new `test/helpers/recorded-data-access.ts` (or similar) plus fixtures under
`test/fixtures/data/`, mocking at the HTTP boundary per this project's
standing rule. Findings 83–86 below are real, confirmed shapes (`SASHELP.CLASS`
against `verde`) to build those fixtures from — scrubbed per this project's
own rule before anything becomes a committed fixture (this phase file already
avoids naming the site-registered libraries the probe's `getLibraries` call
returned beyond `WORK`/`SASHELP`/`SASUSER`, since several of the others read as
customer- or business-identifying and have no bearing on the confirmed shape).

**Dialect risk, flagged not resolved.** Unlike Phase 6 (which found one
inline cadence check in upstream's content adapter), nothing in
`RestLibraryAdapter.ts` or the generated `DataAccessApi` client carries a
visible version branch, and this session's probe — one cadence, one
deployment — didn't contradict that. Still open: whether a different Viya 4
cadence or generation shows any difference in these endpoints. 7a's own probe
pass should check that the same way 6a's punch list already commits to for
its own endpoints, rather than assuming none exists because none was visible
in the client source or turned up on the one cadence probed here.

**The earlier network failure was a VPN outage on the deployment side, not a
sandbox limitation.** This session's first probe attempt failed identically
on every `CONNECT` to `verde` (`502 Bad Gateway` from the egress proxy) while
a public host was reachable fine. Sean's VPN to the deployment's network had
dropped; once it was re-enabled, the identical commands reached `verde`
immediately (`302` on the root, real data on every subsequent call). Worth
recording precisely because it looked exactly like the sandbox-side
reachability gaps this project has hit before (e.g. the `docs/.vitepress/
.temp/` EPERM wall) — the distinguishing test is whether a public host is
reachable through the same proxy at the same time, which it was here, meaning
the fault was specific to the deployment's network path rather than the
sandbox's egress in general.

*Slices, refined from `PRODUCTION_PLAN.md`'s original one-line sketch:*

- **7a — `LibraryAdapter` + read-only tree.** *Medium* — smaller than 6a's
  structural lift (no new `FileSystemProvider`, no drag-and-drop controller
  required for read-only browsing, no new activity-bar container if 6a lands
  first). The busy-submission *wire behaviour* is now settled (Finding 85);
  what 7a still owns is the UI decision it implies (block/queue/warn) and
  whatever cadence/version differences a second-deployment probe turns up.
  `SASHELP`/`WORK` are enough to exercise every read-only path without
  creating anything.
- **7b — Data viewer webview.** *Medium/Large* — the React+ag-grid decision
  lands here, one way or the other; whichever is chosen, this is the
  paginated grid backed by `getRows`/`getColumns`, following
  `useDataViewer.ts`'s virtualized-datasource shape if ag-grid is adopted, or
  a hand-rolled equivalent if not.
- **7c — Sort, filter, CSV export, table properties.** *Medium* — the
  `createView`-based sort (with its orphan-view cleanup question),
  `TableFilter`'s `where=`-clause text filter, `downloadTable`'s CSV
  streaming (local-disk-write question above), and `showTableProperties`'s
  static properties/columns viewer (`TablePropertiesViewer.ts` — a much
  smaller webview than the grid, no ag-grid dependency either way since it's
  two static HTML tables).

*Exit:* a user can browse SAS libraries and tables from the same session
their Python already runs in (My Libraries-equivalent, `WORK`, `SASHELP`,
and any site-registered libraries), open a table in a paged, sortable,
filterable grid, view its properties and column metadata, and export it to
CSV — the same library-browsing workflow the SAS extension offers today, for
a Python-on-Viya session.

---

Everything above is the product. Everything below is breadth, and each phase
is independently valuable and independently shippable. Order is a
recommendation, not a dependency chain — reprioritise based on what users
actually ask for once v0.1.0 is in their hands.

---

## Runbook

_Scoped 2026-09-03, before any code was written — technical grounding (what
ports closely vs. what needs rework vs. what is a deliberate non-goal) came
from the codebase survey described in the Plan section above and six live
probes against `verde` (Findings 83–86 below). **Recommended execution order:
7a → 7b → 7c**, matching the dependency chain `PRODUCTION_PLAN.md`'s original
sketch already implies (an adapter and tree before a viewer that opens from
it; sort/filter/export as refinements on a working viewer). Nothing here is a
hard technical barrier — this is a recommendation, not a dependency lock._

☐ **7a — `LibraryAdapter` + read-only tree.**

- ☐ A second-cadence/second-deployment probe of `GET /sessions/{sessionId}/data`,
  `…/{libref}#tables`, `…/{libref}/{tableName}`, `…/columns`, `…/rows` —
  Findings 83–86 confirm the shape on one Viya 4 deployment (`verde`); the
  dialect-risk note in the Plan section above still wants a second one before
  depending on it everywhere.
- ☐ Design the "session busy" UI 7a needs as a result of Finding 85 — block
  the tree, queue the request, or surface a visible wait state — rather than
  let a browse action hang silently behind an active run the way the raw
  measurement did.
- ☐ Read `RestLibraryAdapter.ts`/`LibraryModel.ts`/`LibraryDataProvider.ts`
  in full for what they do, not what they are, per this project's own
  ported-code rule.
- ☐ Design how a `LibraryAdapter`-equivalent asks `ComputeSessionManager`
  for the active profile's session, rather than owning a connection —
  read `ComputeSessionManager`'s own doc comments first.
- ☐ Build `LibraryItem`/`LibraryAdapter`/`LibraryModel`/
  `LibraryDataProvider`/`PaginatedResultSet` (names TBD to this project's own
  conventions) under a new `src/data/` (or similar) module.
- ☐ Add the tree view to the `viewsContainers` entry 6a creates (or, if 7a
  lands first, create it) — coordinate with whichever of 6a/7a is in flight,
  per the Plan section's note. Command ids follow the flat
  `pythonOnViya.<verb>` convention.
- ☐ `test/helpers/recorded-data-access.ts` + `test/fixtures/data/`, built
  from Findings 83–86's scrubbed shapes.

☐ **7b — Data viewer webview.**

- ☐ Decide React + ag-grid vs. a hand-rolled paginated/virtualized table
  (Plan, above) — a real architecture decision, not a default.
- ☐ If ag-grid: add `ag-grid-community`/`ag-grid-react`/`react`/`react-dom`,
  a `.tsx` type space alongside `tsconfig.webview.json`'s existing carve-out,
  and a JSX loader on `esbuild.mjs`'s webview context.
- ☐ Paginated datasource backed by `getRows`, following
  `useDataViewer.ts`'s shape if ag-grid is adopted.
- ☐ Column metadata from `getColumns`, mapped to grid column defs.

☐ **7c — Sort, filter, CSV export, table properties.**

- ☐ Server-side sort via `createView` — decide the orphan-view cleanup
  question (a cancelled/failed delete today leaves a view behind) before
  porting the create-read-delete sequence unexamined.
- ☐ `where=`-clause text filter (`TableFilter.tsx`'s shape).
- ☐ CSV export to local disk — decide whether it shares a helper with
  Phase 6's own (undecided) download command.
- ☐ Table properties/columns static viewer (`TablePropertiesViewer.ts`'s
  shape — two static tables, no grid dependency).

---

## Probe findings

All probes below ran 2026-09-03 against `verde` (Viya 4), via the
`viya-api-probe` skill, after an initial attempt this same session failed at
the network layer (every `CONNECT` through the sandbox's egress proxy to
`verde` came back `502 Bad Gateway`, while a public host tunnelled fine
through the same proxy) — a VPN outage on the deployment side, confirmed
resolved once retried. One throwaway compute session was created (`SAS
Studio compute context`) to run the mutating parts of this list and deleted
at the end, confirmed gone by a `404` read-back. Continuing this project's
global finding numbering from Finding 82 (`phase-6.md`).

**Finding 83 — the core `DataAccessApi` read shapes are exactly what the
generated client and `RestLibraryAdapter.ts` claim, on this deployment.**
`GET /compute/sessions/{id}/data` (libraries), `…/data/{libref}#summary`
(per-library `readOnly`/engine detail), `…/data/{libref}#tables` (tables in a
libref), `…/data/{libref}/{tableName}` (table info), `…/{tableName}/columns`,
and `…/{tableName}/rows` all returned `200` with exactly the fields
`RestLibraryAdapter.ts`/`TablePropertiesViewer.ts` read. `GET …/data` listed
14 libraries including `WORK`, `SASHELP`, and `SASUSER` alongside several
site-registered ones (not named here — a few read as customer/business
identifying, and naming them adds nothing the generic shape doesn't already
cover, per this project's own "nothing deployment-identifying" rule).
`GET …/data/SASHELP/CLASS` returned the full `TableInfo` shape
(`rowCount: 19`, `columnCount: 5`, `label: "Student Data"`, timestamps, engine
`V9`, etc.) and its own `links` array carries `rows`, `rowsAsCSV`, `rowSet`,
`columns`, `promptContent`, and `createView` relations — a superset of what
`RestLibraryAdapter.ts` follows by composed URL rather than by link, worth a
note for whoever writes 7a on whether to follow links here the way
`src/compute/links.ts` already does for Compute, rather than composing paths
by hand the way upstream's adapter does.

**Finding 84 — the plain `getLibraries`/`getTables` collections carry no
per-item detail; the `readOnly`/size fields only appear on the singular
`#summary`/item `GET`.** The default `GET …/data` and `GET …/data/{libref}#tables`
responses return `type: null`, `rowCount: null`, `columnCount: null` on every
item, exactly matching upstream's own two-tier fetch (list, then a per-item
`getLibrarySummary`/`getTable` for the fields the UI actually needs) — not a
gap in the probe, a confirmed reason `RestLibraryAdapter.getLibraries` makes
one follow-up request per library. Measured directly:
`GET …/data/WORK#summary` → `readOnly: false`; `GET …/data/SASHELP#summary` →
`readOnly: true`, `concatenationCount: 4` (four physical paths concatenated
into one libref) — confirms the read-only/writable distinction the tree's
icon and context-menu gating depend on is real and populated, not merely
documented.

**Finding 85 — a `DataAccessApi` call blocks behind a running job in the same
session; it does not error and does not run concurrently.** With no job
running, `GET …/data/SASHELP/CLASS/rows?start=0&limit=2` returned `200` in
**0.349s**. Immediately after submitting a job that runs
`data _null_; x=sleep(15,1); run;` (async, no wait), the identical `getRows`
call returned `200` only after **14.911s** — a wait matching the job's own
15-second sleep almost exactly, not an error and not a fast race. The session
serializes `DataAccessApi` reads behind whatever the SAS kernel is doing,
regardless of which REST resource path asks. Settles the busy-submission
question the Plan section raises: browsing during an active run would hang
silently for the run's duration rather than fail fast — the same
"busy-clears-before-the-session-is-actually-free" shape Finding 76 (Phase 4b)
already found on the cancel path, now confirmed on this path too. Not
probed: whether a *second* concurrent `DataAccessApi` call (no job involved)
queues the same way, or whether only a running job causes this.

**Finding 86 — the session `state` endpoint needs its own media type, not a
bare `Accept: application/json`.** `GET /compute/sessions/{id}/state` with a
generic `Accept` returned a bare unquoted word (`idle`) that broke `jq`
parsing; requesting `Accept: application/vnd.sas.compute.session.state+json`
returned the same content cleanly. Incidental — not part of this phase's own
wire surface — but worth a one-line note for whoever next writes a session
probe from scratch, the same way Finding 14 already exists for a different
Compute media-type trap.

**Not probed this session, left open:** a second Viya 4 cadence/deployment
(the dialect-risk item above); whether a *second* `DataAccessApi` call queues
the same way a job does (Finding 85's own open question); the `createView`
sort round trip and its cleanup-on-failure behaviour (a mutating probe,
deliberately out of scope for this pass); and the CSV (`rowsAsCSV`) and
`promptContent` relations `getTable`'s link set surfaced but
`RestLibraryAdapter.ts` reaches by composed URL rather than by link. All are
7a/7c implementation-time probes, not settled here.
