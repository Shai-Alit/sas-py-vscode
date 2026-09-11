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
six read-only-to-the-target-data live probes against `verde` (Findings 7.1–7.4
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
- The wire shape itself: `GET /sessions/{sessionId}/data` (libraries), `GET
  /sessions/{sessionId}/data/{libref}` (per-library detail by default, or the
  tables-in-a-libref listing under a different `Accept` on the same URI — see
  the note below), `GET
  /sessions/{sessionId}/data/{libref}/{tableName}` (table info, `rowCount`
  etc.), `GET …/{tableName}/columns` (paged column metadata), and `GET
  …/{tableName}/rows` (paged row data, `start`/`limit`/`where`/
  `formatMissingValues`/`includeIndex` query params) — all standard
  `application/vnd.sas.collection+json` collections with the same
  `start`/`limit`/`count` paging shape `src/compute/contexts.ts` and
  `job.ts` already handle for other Compute collections. **Superseded in part
  by Finding 7.5:** an earlier draft of this bullet wrote the `readOnly`/tables
  detail as `#summary`- and `#tables`-suffixed URL segments
  (`.../data/{libref}#summary`, `.../data/{libref}#tables`), mirroring
  upstream's `compute.ts` template strings. Those are not requestable paths —
  the `#` is a URL fragment stripped before the wire, and a properly
  percent-encoded `WORK%23summary` returns HTTP 400. The rich-detail and
  tables views are selected by `Accept`-header content negotiation on the
  bare `.../data/{libref}` URI, which this project's `src/wire/links.ts` +
  `src/compute/client.ts` link-following already produces from the item's own
  links (see Finding 7.5).
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
  Ratified as [ADR-0027](../adr/0027-library-adapter-shape.md).
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
  full before assuming the shape. Settled as
  [ADR-0027](../adr/0027-library-adapter-shape.md).
- **The busy-submission guard raises a question upstream never had to
  answer — now settled, not merely theorized.** `ComputeSessionManager.
  startSubmission`/`endSubmission` refuse a second concurrent submission into
  the same session (finding 27's "refuse rather than queue", `busySubmissions`)
  because finding 29 left what a second submission does to a running session
  unobserved. `DataAccessApi` calls are a *different* resource path (`/data/…`,
  not `/jobs`), so the question was whether they're safe to issue while a job
  is executing in the same session. **Finding 7.3** measured it directly: a
  `getRows` call issued immediately after submitting a 15-second job returned
  `200` only after **14.911s** — not an error, not an immediate race, a wait
  matching the job's own duration almost exactly — against a **0.349s**
  baseline for the identical call once the session was idle. **The REST layer
  accepts the request and blocks it at the SAS kernel until the session frees
  up; it does not refuse it and does not run it concurrently.** That answers
  the UI question this bullet raised: browsing during an active run would not
  fail fast, it would hang silently for the run's whole duration — precisely
  the "busy clears before the session is actually free" failure shape Finding 76 (Phase 4b) already found on the cancel path, now confirmed on this path
  too. 7a should treat a `DataAccessApi` call the same way `startSubmission`
  already treats a second run: check `ComputeSessionManager`'s busy state
  before issuing one, and refuse or queue with a visible "session busy"
  message, rather than let a browse action hang with no explanation. Settled
  as [ADR-0027](../adr/0027-library-adapter-shape.md): refuse, not queue.
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

- **The drag-and-drop "insert a reference" behavior — resolved by 7d,
  below.** Upstream's `LibraryDataProvider.handleDrag` puts a table's `uid`
  (a `libref.tablename` string) on the data transfer as plain text, so
  dropping a table onto a `.sas` editor inserts a bare `libref.tablename`
  reference — meaningful because `set libref.tablename;` and similar SAS
  syntax read a libref directly. Python has no equivalent *implicit* binding
  to a SAS libref, but it has an equivalent *explicit* one: the new **7d**
  slice below (scoped 2026-09-04, resurrected and live-probed 2026-09-10)
  confirms `PROC PYTHON`'s own `SAS.sd2df` bridge method is the documented,
  already-available mechanism (Finding 2, `phase-1.md`; confirmed working
  end-to-end by Finding 7.11) for exactly this — a drop should insert
  `SAS.sd2df("libref.tablename")` assigned to a name derived from the table,
  not a `pd.read_csv`-shaped synthesis that this project would have to
  invent and maintain itself. Still left to whoever writes the actual drag
  handler (7d's own punch list, gated on 7a's tree, which now exists): the
  exact assigned-variable-name heuristic, and whether the drop offers a
  choice between `sd2df` (read into memory) and a `SAS.submit`-based
  `PROC SQL` snippet (push a filter down to the engine first) — both
  documented options per 7d's own findings below.
- **React + ag-grid as this project's first React dependency — decided
  2026-09-10, with Sean, before any 7b code was written.** Upstream's data
  viewer is a `ag-grid-react`/`ag-grid-community` grid (`^36.0.2`) rendered
  from a `.tsx` webview entry point built by its own esbuild context. This
  project's one existing webview (`src/webview/entry.ts`, ADR-0021) is
  hand-rolled DOM manipulation with no framework, no `.tsx` loader, and
  `tsconfig.webview.json`'s own `"types": []` carve-out — adding ag-grid
  means adding React, `ag-grid-community`, `ag-grid-react`, a `.tsx` type
  space, and a JSX loader to `esbuild.mjs`'s existing webview context
  (checked directly: today's context has no `jsx` option set at all).
  Weighed directly against hand-rolling a lighter paginated/virtualized
  table in the existing DOM style. **Decision: React + ag-grid-community.**
  The reasoning ADR-0021 gave for hand-rolling the result panel does not
  transfer cleanly to this panel: that decision's hard problem was a
  security one (never let a user's own arbitrary `to_html()` output execute
  as script), which a five-line DOM port solved cheaply; a data viewer's
  hard problem is an interactive, stateful one (windowed virtualization over
  a paginated REST source, scroll-triggered fetching, resizable columns,
  keyboard navigation, screen-reader row/column semantics) with no
  untrusted-HTML dimension at all — table cells are typed SAS values, not
  arbitrary markup. That category of UI problem is exactly where a small
  team reinventing a mature library tends to lose over time on the long
  tail of polish (scroll jank, focus loss on re-render, resize-drag
  physics), and ag-grid-community's Infinite Row Model — the free,
  MIT-licensed tier, not an Enterprise feature — covers what 7b/7c need with
  no license cost. Bundle cost is real but bounded and one-time: roughly
  250–450 KB gzip added to the *webview* bundle specifically (not the main
  extension bundle loaded at activation), paid only the first time a user
  opens a data viewer panel. What this decision does reopen, and what 7b's
  own ADR must settle explicitly rather than silently: the CSP threat model
  for an *interactive* panel (ag-grid's own runtime inline-styles its row
  positioning, needing a `style-src 'unsafe-inline'` exception rederived
  from scratch, not copied from ADR-0021's read-only-panel reasoning), and
  the testing-boundary question ADR-0021 settled against `jsdom` for a
  different reason (extending the existing port-and-fake pattern one layer
  further) — likely resolved the same way `src/webview/entry.ts` already is,
  treating the React/ag-grid wiring itself as a browser-only layer excluded
  from the unit coverage tier and verified by the integration tier instead,
  while the `getRows`/`getColumns` adapter and pagination logic stay
  ordinary, `vscode`-free, unit-tested code as usual. Recorded as its own
  ADR once 7b's code is written, per this project's own architecture-decision
  convention — not decided informally and left unwritten.

**7d — Python data exchange with SAS libraries (`SAS.sd2df`/`df2sd`/`submit`),
scoped 2026-09-04, resurrected and live-probed 2026-09-10.** A separate ask
from a third `sas-py-vscode-cowork` scoping session, run while Phase 5's
release work continued on the primary copy: can a user's own Python code —
not just this extension's tree/viewer UI — transparently read (and write) a
SAS library's data, including a table behind a SAS/ACCESS engine LIBNAME
(e.g. a site-registered MySQL library), the same way SAS code already can,
without installing a local DB driver or handling a second credential? That
2026-09-04 session found the mechanism already exists but could not reach
`verde` to confirm it end to end (the same VPN-outage signature this phase's
own Findings 83–86 probe had already hit) or settle the log-echo risk it
flagged by analogy; its doc edits were stashed rather than committed and sat
unmerged until this session found and resurrected them, live-probing what
had been left open.

- **The mechanism: `PROC PYTHON`'s own `SAS` bridge object, not a new REST
  call.** `phase-1.md`'s Finding 2 already confirmed `'SAS' in dir()` is
  `True` inside every submitted block, without pinning down which methods
  work. SAS's own documentation of the Python procedure names four callback
  methods — `SAS.sd2df("libref.table")` (SAS dataset/view → pandas
  `DataFrame`), `SAS.df2sd(df, "libref.table")` (the write direction),
  `SAS.submit("<SAS code>")` (run arbitrary SAS, including `PROC SQL`, from
  inside the Python cell), and `SAS.symget`/`SAS.symput` (macro-variable
  exchange). None of these are this project's own code; they ship with
  `PROC PYTHON` on any Viya 4 deployment recent enough to have the procedure
  at all (introduced 2021.1.3). This project has been running every user's
  Python through exactly this procedure since Phase 3 — **the capability has
  existed, unannounced, since 3a.**
- **Finding 7.11 confirms all three methods work end to end, not merely that
  the bridge object is present.** A live job against `verde` (2026-09-10)
  read `sashelp.class` via `SAS.sd2df` (`shape (19, 5)`), wrote a fresh
  `DataFrame` back via `SAS.df2sd` into `work`, and ran `SAS.submit` — all
  three completing successfully inside one `PROC PYTHON` invocation on this
  project's own execution path. Finding 2 established presence; Finding 7.11
  is the first confirmation any of the three actually work here.
- **Why this answers the SAS/ACCESS/MySQL case specifically, with no new
  design.** A SAS/ACCESS engine LIBNAME (to MySQL or any other supported
  DBMS) is, from the SAS session's point of view, just another assigned
  libref — the engine is a detail of how the libref resolves a table read,
  invisible above that layer. `SAS.sd2df("mysqllib.sometable")` needs to
  know nothing about MySQL: the already-configured LIBNAME (assigned however
  it got assigned — site autoexec, or a prior `SAS.submit("libname ...;")`
  call) does the rest. A SQL-style query against a connected database
  becomes `SAS.submit("proc sql; create view work.v as select * from
  mysqllib.sometable where …; quit;")` then `SAS.sd2df("work.v")` — ordinary
  `PROC SQL` pass-through, filter pushed to the engine rather than pulled
  client-side. This project ships none of that SQL generation itself; it
  only needs to make the pattern discoverable and safe to use.
- **Finding 7.12 corrects the stash's speculative risk, rather than
  confirming it.** The 2026-09-04 session, by direct analogy to Finding 92
  (Phase 8's `CASTOKEN` leak), guessed that a credential-bearing `LIBNAME`
  statement passed to `SAS.submit()` would land in the job log the same way.
  A live, isolated probe (2026-09-10, `verde`) found the opposite for the
  mechanism it actually tested: a `LIBNAME` statement assembled from a
  runtime-built string (so the credential never appeared as a literal in the
  submitted Python source) and executed via `SAS.submit()` was logged as
  `password=XXXXXXXXXXXXXXXXXXXXXXXXX` — SAS's own standard `PASSWORD=`
  masking applied to the statement `SAS.submit()` itself echoes, exactly as
  it would for a top-level `LIBNAME`. **This does not reopen or replace
  Finding 92.** That finding's own mechanism — the *outer* job-source echo
  reproducing a user's submitted Python verbatim (Finding 2/93's documented,
  unconditional source-echo behaviour) — is untouched by this result and
  still applies regardless of `SAS.submit()`: a credential written as a
  literal string anywhere in the submitted Python cell leaks via that outer
  echo before `SAS.submit()`'s own masking ever gets a chance to run. The
  practical guidance this settles for documentation: never write a
  credential as a literal in the Python source at all, whether or not
  `SAS.submit()` is involved; source it from a runtime value (an environment
  variable, a prior `SAS.symget`), and prefer a site-assigned libref over an
  ad hoc `SAS.submit("libname ...")` carrying any credential in the first
  place.
- **A second, still-unprobed risk: `sd2df`'s memory shape.** `sd2df` reads a
  whole SAS table into an in-process pandas `DataFrame` inside the same
  container ADR-0019 already found can be OOM-killed by rich-output
  generation (Finding 73, Phase 3f). A large external table pulled whole via
  `sd2df` with no `WHERE` pushed down first is the same failure shape with a
  different trigger. Worth a doc-level warning (push filters into the
  `PROC SQL` step, per the bullet above, rather than filtering in pandas
  after `sd2df`) rather than a code change — this project has no lever to
  cap what a user's own `sd2df` call pulls back, the same way it has no
  lever over the size of a user's own `print()`.
- **Relationship to Phase 7a–7c and Phase 8: complementary, not
  overlapping.** 7a–7c give a read-only tree and paged viewer *without*
  running any Python — a second lens onto the session's `DataAccessApi`.
  Phase 8 gives CAS access, via `swat`, to a *different* resource (CAS
  tables, not Compute-session librefs). 7d is the missing third piece:
  letting a user's own Python *code* read and write the same
  Compute-session libref data 7a's tree displays, which had no scoped phase
  at all despite being possible since Phase 3. It ships as part of Phase 7
  rather than standing alone because it reuses 7a's exact substrate (the
  same session, the same libref/table identity a `LibraryItem`'s own naming
  already assumes) and because it is what actually answers 7a's own
  drag-and-drop question, above.
- **What this is not.** Not a new `ExecutionBackend` capability, not a new
  REST integration, not a new authentication path — `SAS.sd2df`/`df2sd`/
  `submit` run inside the same `PROC PYTHON` invocation this project already
  submits, using the same session. The work is documentation, a tested
  example, the probe above, and (once a drag handler is written) a
  drag-and-drop snippet — not new backend plumbing.

*7d slice, in addition to 7a–7c above:*

- **7d — Document, probe, and snippet-ize `SAS.sd2df`/`df2sd`/`submit`.**
  *Small* — no new backend code. The live probe (`SASHELP.CLASS` against
  `verde`) and the log-echo question are now settled (Findings 7.11/7.12).
  What remains: ship a documented example (a new `docs/data-access.md`, or
  an addition to whatever 7a/7b's own docs become) covering the
  `SAS.sd2df`/`PROC SQL`-pass-through pattern and an explicit warning
  against writing a credential literal anywhere in submitted Python, and —
  now that 7a's tree exists — the drag-and-drop snippet insertion
  (`SAS.sd2df("libref.table")`) the Plan section above resolves in
  principle but does not itself build.

**Testing.** Same shape this project already committed to for Phase 6: a
new `test/helpers/recorded-data-access.ts` (or similar) plus fixtures under
`test/fixtures/data/`, mocking at the HTTP boundary per this project's
standing rule. Findings 7.1–7.4 below are real, confirmed shapes (`SASHELP.CLASS`
against `verde`) to build those fixtures from — scrubbed per this project's
own rule before anything becomes a committed fixture (this phase file already
avoids naming the site-registered libraries the probe's `getLibraries` call
returned beyond `WORK`/`SASHELP`/`SASUSER`, since several of the others read as
customer- or business-identifying and have no bearing on the confirmed shape).
7d's own fixtures (job-log text confirming the masking/echo behaviour) are a
separate, smaller set — no `DataAccessApi` involved, just a job log.

**Dialect risk, closed for the endpoints this phase has probed (updated by
Finding 7.7, 2026-09-09 — superseding the "narrowed but not resolved"
framing this paragraph previously had).** Unlike Phase 6 (which found one
inline cadence check in upstream's content adapter), nothing in
`RestLibraryAdapter.ts` or the generated `DataAccessApi` client carries a
visible version branch. This phase's probing covered **two independent Viya
4 deployments** (`verde` and `Innov`, Findings 7.1–7.4/7.5/7.6) — the deployment
axis closed first. Finding 7.7 then read each deployment's own
`/deploymentData/cadenceVersion` and found they are also **two different
cadence classes** (`verde` on `lts`/`2026.03`, `Innov` on `stable`/`2026.06`,
three release-months apart) — closing the cadence axis too, since Findings 7.5/7.6 already showed every `DataAccessApi` mechanism this phase covers
agreeing between them. Nothing so far found a version-conditioned branch on
either axis. (Viya 3.5 remains out of scope entirely — ADR-0022.)

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
  first). The busy-submission *wire behaviour* is now settled (Finding 7.3);
  what 7a still owns is the UI decision it implies (block/queue/warn) and
  whatever cadence/version differences a second-deployment probe turns up.
  `SASHELP`/`WORK` are enough to exercise every read-only path without
  creating anything.
- **7b — Data viewer webview.** *Medium/Large* — decided 2026-09-10: React +
  ag-grid-community, following `useDataViewer.ts`'s virtualized-datasource
  shape (infinite row model), backed by `getRows`/`getColumns`. Finding 7.10
  settles a real implementation question in 7b's favour before any code was
  written: the rows collection's `count` is populated even at a small
  `limit`, so the grid can show an exact total row count from the first
  page rather than needing upstream's "fewer than a full page came back,
  assume this is the last one" heuristic.
- **7c — Sort, filter, CSV export, table properties.** *Medium* — the
  `createView`-based sort (with its orphan-view cleanup question),
  `TableFilter`'s `where=`-clause text filter, `downloadTable`'s CSV
  streaming (local-disk-write question above), and `showTableProperties`'s
  static properties/columns viewer (`TablePropertiesViewer.ts` — a much
  smaller webview than the grid, no ag-grid dependency either way since it's
  two static HTML tables).
- **7d — Document, probe, and snippet-ize Python↔library data exchange.**
  *Small* — no new backend code. `SAS.sd2df`/`df2sd`/`submit` confirmed
  working end to end (Finding 7.11) and the credential-echo question settled
  (Finding 7.12); what remains is the documented example and, once 7a's
  tree exists (it does), the drag-and-drop snippet.

*Exit:* a user can browse SAS libraries and tables from the same session
their Python already runs in (My Libraries-equivalent, `WORK`, `SASHELP`,
and any site-registered libraries), open a table in a paged, sortable,
filterable grid, view its properties and column metadata, and export it to
CSV — the same library-browsing workflow the SAS extension offers today, for
a Python-on-Viya session. **With 7d:** the user can also drop a library
table straight into their Python — a `.py` cell reading `SAS.sd2df(...)` or
writing `SAS.df2sd(...)` against `WORK`, `SASHELP`, or a site-registered
SAS/ACCESS-connected external database — using the same Viya connection an
administrator already provisioned, with no local driver and no second
credential to manage. This is a capability upstream's SAS extension has no
equivalent of at all (its users write SAS, which already reads a libref
directly), and it needed no new Viya-side work to reach — only surfacing,
documenting, and confirming what `PROC PYTHON` already provides.

---

Everything above is the product. Everything below is breadth, and each phase
is independently valuable and independently shippable. Order is a
recommendation, not a dependency chain — reprioritise based on what users
actually ask for once v0.1.0 is in their hands.

---

## Runbook

_Scoped 2026-09-03 (7a–7c), before any code was written — technical grounding
(what ports closely vs. what needs rework vs. what is a deliberate non-goal)
came from the codebase survey described in the Plan section above and six live
probes against `verde` (Findings 7.1–7.4 below). 7d was scoped 2026-09-04 from
a separate session, stashed rather than committed, and resurrected and
live-probed 2026-09-10 (Findings 7.11/7.12). **Recommended execution order:
7a → 7b → 7c, with 7d startable independently** — 7d needs none of 7a–7c's
session/tree/viewer work except its very last item (the drag-and-drop
snippet, which needs 7a's tree to drop *from*, and 7a is now done). Nothing
here is a hard technical barrier — this is a recommendation, not a
dependency lock._

☑ **7a — `LibraryAdapter` + read-only tree.** Code written 2026-09-09 (this
session, from the `sas-py-vscode-cowork` clone), adversarially reviewed before
the branch was pushed (per `CLAUDE.md`'s review-before-PR-exists rule), and
merged 2026-09-10 via [PR #142](https://github.com/Shai-Alit/sas-py-vscode/pull/142)
(squash).

- ☑ A second-**deployment** probe of `GET /sessions/{sessionId}/data`, the
  summary/tables content-negotiation Finding 7.5 corrected, `…/{tableName}`,
  `…/columns`, `…/rows`. Finding 7.5 (2026-09-09) re-ran the full set against
  `verde` again and reconfirmed Findings 7.1–7.3's practical shape (correcting
  7.1/7.2's URL-suffix mechanism to `Accept`-header content negotiation) and
  Finding 7.4 (session-state is bare `text/plain` regardless of `Accept` —
  stronger/simpler than originally stated). Finding 7.6 (2026-09-09) then
  re-ran the same set against a second, distinct deployment (`Innov`) and
  every mechanism reproduced identically. **Done** for the second-deployment
  axis specifically.
- ☑ A second-**cadence** probe. **Done** — Finding 7.7 (2026-09-09) read each
  deployment's own `/deploymentData/cadenceVersion` and found `verde` on
  `lts`/`2026.03` and `Innov` on `stable`/`2026.06`: not merely two
  deployments but two different cadence classes, three release-months
  apart. Combined with Findings 7.5/7.6 (every `DataAccessApi` mechanism this
  phase covers already agreed between them), the cadence axis of this
  phase's dialect risk is closed, not merely narrowed. Viya 3.5 remains out
  of scope per ADR-0022.
- ☑ Design the "session busy" UI 7a needs as a result of Finding 7.3. **Done**
  — [ADR-0027](../adr/0027-library-adapter-shape.md): refuse rather than
  queue, reusing `ComputeSessionManager.isBusy(profileId)`, mirroring
  `startSubmission`'s existing precedent (finding 27). An unclaimed race
  (busy becomes true between the check and the request landing) is accepted
  rather than closed — see the ADR's Consequences.
- ☑ Read `RestLibraryAdapter.ts`/`LibraryModel.ts`/`LibraryDataProvider.ts`
  in full for what they do, not what they are, per this project's own
  ported-code rule. **Done** — findings folded into
  [ADR-0027](../adr/0027-library-adapter-shape.md).
- ☑ Design how a `LibraryAdapter`-equivalent asks `ComputeSessionManager`
  for the active profile's session, rather than owning a connection.
  **Done** — [ADR-0027](../adr/0027-library-adapter-shape.md):
  `current(profileId)`, profile-keyed, no adapter-owned connection. One UX
  call stays open on purpose (lazy `connect()` on first tree expansion vs. an
  explicit "not connected" state) — see the ADR's Consequences.
- ☑ Build `LibraryItem`/`LibraryAdapter`/`LibraryModel`/
  `LibraryDataProvider`/`PaginatedResultSet` (names TBD to this project's own
  conventions) under a new `src/data/` (or similar) module, per
  [ADR-0027](../adr/0027-library-adapter-shape.md)'s shape. **Done**, with two
  names settled differently than the plan's placeholders: no separate
  `LibraryModel`/`LibraryDataProvider` split (`src/data/dataTree.ts` talks to
  `LibraryAdapter` directly — a library and a table are two variants of one
  `DataItem` union, not two dispatch layers), and no `PaginatedResultSet`
  (`LibraryAdapter`'s private `collectPages` walks a collection's `next` link
  to the end and returns the whole list — this slice's tree has no reason to
  hold a page open, unlike 7b's data-viewer grid, which is where a real
  windowed/virtualized reader belongs if one is needed). `src/data/types.ts`,
  `problems.ts`, `adapter.ts` are `vscode`-free; `presentation.ts` maps a
  `DataItem` to a label/icon/`contextValue`; `dataTree.ts`/`dataExplorer.ts`
  are the thin shells, mirroring 6a-ii's own split. Two implementation-time
  corrections to this Plan section's expectations, both probed rather than
  assumed — Findings 7.8 and 7.9 below.
- ☑ Add the tree view to the `viewsContainers` entry 6a-ii already created
  (6a landed first — this is no longer a coordination question, just an
  implementation step). Command ids follow the flat `pythonOnViya.<verb>`
  convention. **Done** — `pythonOnViya.dataExplorer` is a second view in the
  `pythonOnViya` container, `pythonOnViya.refreshDataExplorer` mirrors
  `refreshContentExplorer`, and a third `viewsWelcome` state
  (`pythonOnViya.hasProfiles && pythonOnViya.authorized && !pythonOnViya.connected`)
  invites a Connect the tree itself never triggers — ADR-0027's open UX
  question, resolved as an amendment to that ADR rather than silently
  defaulted: no lazy `connect()` on first expansion, an explicit state
  instead, for the same reason browsing SAS Content never triggers a silent
  sign-in. `src/compute/commands.ts` gained one small addition this needed
  that nothing before it did: `onDidChangeConnection`, an event fired
  alongside its existing `pythonOnViya.connected` context-key sync, since
  this is the first tree whose contents (not just its welcome banner) depend
  on the compute session.
- ☑ `test/helpers/recorded-data-access.ts` + `test/fixtures/data/`, built
  from Findings 7.1–7.4's scrubbed shapes. **Done** as
  `test/helpers/recorded-data.ts` (named to match `recorded-content.ts`'s own
  convention once it was in front of us, rather than the plan's placeholder
  name) plus six fixtures under `test/fixtures/data/`, scrubbed from a fresh
  2026-09-09 probe pass (Findings 7.8/7.9) rather than reconstructed from
  Findings 7.1–7.4's prose after the fact. **One real defect found and fixed
  the same day, before review:** `recorded-content.ts`'s route-matching
  convention (a bare string route matches any query string on the same base
  href) is safe there only because no content test ever follows a `next`
  link; copied unchanged into `recorded-data.ts`, it let a route meant for
  page 1 of the librefs collection also answer page 2's request, which
  carried the identical `next` link back, and `LibraryAdapter.collectPages`
  followed it forever — an actual `npm run coverage` run crashed with a V8
  out-of-memory error rather than merely failing an assertion. Fixed by
  making `recorded-data.ts`'s string routes match the href exactly (no query
  stripping); `LibraryAdapter.collectPages` also gained its own
  `MAX_DATA_PAGES` runaway guard (mirroring `compute/fileref.ts`'s
  `MAX_FILEREF_PAGES`) as defence in depth against a real deployment ever
  producing a non-terminating `next` link, with a test pinning it. Both
  `recorded-data.ts`'s own doc comment and `collectPages`'s record the full
  story for whoever next copies this helper's shape into a fourth service.
  **A second, smaller gap surfaced once the OOM fix landed:** with the
  infinite loop gone, `npm run coverage` ran to completion but failed the
  95% branch-coverage threshold at 94.88%, traced to `src/data/adapter.ts`
  (86.27% branches) and one line of `src/data/types.ts`. Eight branches were
  genuinely untested rather than untestable: `getLibraries` skipping an item
  with no usable name, skipping one whose `self` follow-up returns a body
  that isn't a valid library, propagating a failed `self` follow-up rather
  than swallowing it, a response body that isn't an object at all, the
  `malformed` helper's missing-`contentType` fallback text, an `AbortSignal`
  actually reaching the wire request; `getTables` propagating a failed
  tables-collection fetch; and `readTableItem` in `types.ts` dropping a
  non-object or `null` value outright. Closed with eight new tests (no
  production-code change beyond the OOM fix above); `recorded-data.ts` also
  gained `hadSignal` on `RecordedDataCall` so the `AbortSignal` case has
  something to assert against. `npx tsc --noEmit` (both configs) and
  `npx prettier --check` are clean on every file this touched; the actual
  branch percentage still needs `npm run coverage` run on a real machine to
  confirm it clears 95%, since the sandbox does not run coverage.
  **A third symptom then surfaced on the real machine, and it was not Phase 7
  code at all.** `npm run coverage` failed with two tests timing out at the 2s
  unit budget — `check-contracts`'s before-all hook and `check-coverage-scope`'s
  "this repository" case — and, downstream of those never finishing, the global
  lines/statements/functions thresholds fell short (~92% against 94/93/94) while
  branches passed. The low percentage was a pure artefact: `check-contracts.mjs`
  reads 24% only because its test timed out before exercising it; let the test
  finish and it climbs back and the thresholds clear. The two failing tests are
  the only ones that load the TypeScript compiler and parse the whole source
  tree — `check-contracts`'s hook `import`s a script that pulls in `typescript`
  plus `js-yaml`, and `check-coverage-scope`'s repository case walks and parses
  every file. Native, both finish well under a second; under c8, in a process
  that by then holds V8 coverage data for the entire suite, that work runs
  several times slower and lands right on the 2s line — so it passed one run and
  timed out the next (the failing set flip-flopped run to run, the signature of
  a marginal test rather than a hung one). Phase 7 added enough tests to eat the
  thin margin these two always had. A first attempt — excluding
  `eslint-ignores.test.ts` from the coverage pass — did nothing, and the run
  output showed why: tests run in alphabetical file order, so both failing tests
  run *before* `eslint-ignores`, whose heap therefore was not even allocated
  when they timed out. Fixed by giving those two suites a real, bounded budget
  for the compiler work they genuinely do (`this.timeout(30_000)` at the
  suite level in each file), exactly as `eslint-ignores.test.ts` already does
  for loading ESLint; the fast pure-function cases in those files keep the 2s
  ceiling in practice. Moving them out of c8 was not an option: `scripts/`
  coverage counts toward the global threshold, so dropping `check-contracts.mjs`
  and `check-coverage-scope.mjs` from the run would have cratered it. No
  production-code or threshold change; the two timeouts and the downstream
  percentage shortfall were both pure symptoms of a budget that never fit these
  two whole-tree-parse tests under coverage instrumentation. `npm run verify`
  passed clean on a real machine once fixed: 1295 passing, lines 94.81%,
  branches 95.22%, functions 94.45%, statements 94.81% — every threshold met.
  **Adversarial self-review completed before push**, against the finished
  diff (`src/data/`, `src/compute/commands.ts`, `src/extension.ts`, the
  package/nls/docs edits, and the test/fixture additions). No blocking
  findings. Five low-priority notes, each verified independently against the
  code rather than relayed on trust: two were folded into this slice —
  `syncConnectedContext`'s sync in `src/compute/commands.ts` now fires
  `connectionChanged` from `.finally` rather than `.then`, so a rejected
  `setContext` no longer silently drops the event and leaves the
  session-dependent view stuck on stale state; and `MAX_DATA_PAGES`'s doc
  comment in `src/data/adapter.ts` had an unevidenced claim — "the session's
  own librefs default is `limit=10`" was never actually probed (that number
  belongs to Finding 94's *fileref* collection, a different endpoint) and the
  arithmetic it was paired with was wrong regardless (394 tables ÷ 10 is 40
  pages exactly, not "under 40"). Corrected to cite only what Finding 7.9
  actually established — `SASHELP`'s 394 tables paginated at `limit=5`, which
  is 79 pages — and to note that neither the adapter nor the wire sets
  `limit` at all, so a real deployment's page size is whatever the server
  chooses. Two more are recorded here rather than fixed, as genuine
  scope decisions rather than defects: **`SasLibraryTreeProvider.getChildren`
  never passes an `AbortSignal` to `getLibraries`/`getTables`**, so a
  mid-load collapse or refresh leaves in-flight requests running with their
  results discarded (each request is still bounded by its own timeout, and
  `src/content/contentTree.ts` does the same, so this is consistent with the
  existing tree, not a regression) — wiring a per-refresh `AbortController`
  through the tree is left for a later slice, not this one. **The tree does
  not refresh on an `isBusy` transition**: expanding a library while a run is
  in flight logs `session-busy` and renders empty, and stays empty until a
  manual refresh after the run ends — acceptable for a read-only tree, but a
  real gap if a later slice adds anything that depends on catching the
  session becoming idle again. The fifth note (`src/data/adapter.ts` and
  `src/content/adapter.ts` carrying the project header rather than a SAS one)
  was confirmed as the already-ratified ADR-0026/0027 approach, not a defect.
  `npx tsc --noEmit`/`npx prettier --check` clean on every file the two
  folded-in fixes touched.

☑ **7b — Data viewer webview.** Architecture decided and the whole slice
implemented 2026-09-10, then adversarially reviewed the same day (see the
review bullet below) with three real findings folded in; `npx tsc -p
tsconfig.webview.json --noEmit` is now clean against the actually-installed
`ag-grid-community`/`ag-grid-react`/`react`/`react-dom` packages, closing the
one gap nothing in the sandbox this was written in could check. Sean's own
`npm run verify` and `npm run test:integration` are both green (see the
verify/integration bullet below for the two real gaps that round surfaced
and closed). Sean's own manual visual check of a real panel then ran
**twice**, 2026-09-10 — see the last bullet for the full account of both
passes, the Finding 7.14 fix, the second adversarial review, and the two
items left open at Sean's own direction (a busy-session recovery gap; the
grid's light-only theme) as documented, non-blocking follow-ups rather than
things this box waits on.

- ☑ Decide React + ag-grid vs. a hand-rolled paginated/virtualized table
  (Plan, above) — a real architecture decision, not a default. **Done**,
  2026-09-10, with Sean: React + ag-grid-community. See the Plan section's
  updated bullet for the full reasoning.
- ☑ Add `ag-grid-community`/`ag-grid-react`/`react`/`react-dom`, a `.tsx`
  type space alongside `tsconfig.webview.json`'s existing carve-out, and a
  JSX loader on `esbuild.mjs`'s webview context. **Done** — all four as exact
  version-pinned `devDependencies` (never `dependencies`, ADR-0005's
  invariant unchanged); `tsconfig.webview.json` gained `jsx: "react-jsx"` and
  `src/webview/**/*.tsx` in its own `include`; `esbuild.mjs` gained a third
  context (`dataViewerContext`) bundling `src/webview/dataViewerEntry.tsx` to
  `dist/webview/dataViewer.js`. **Caveat resolved 2026-09-10**: none of the
  library-specific API usage in `dataViewerEntry.tsx` could be typechecked
  from the sandbox this was written in (`npm install` is off-limits there),
  so this box's own honesty required saying so explicitly. Sean ran
  `npm install` in the real clone and `npx tsc -p tsconfig.webview.json
  --noEmit` came back clean on the first pass after two small fixes the
  install itself surfaced (not found by review, since neither package was
  installed for it either): an ambient `declare module "*.css"` shim
  (`src/webview/css.d.ts`) `ag-grid-community`'s own stylesheet imports need
  because the package ships no types for its CSS exports, and dropping an
  explicit `rowCount: undefined` in favour of omitting the key entirely
  (`exactOptionalPropertyTypes: true` rejects the former; `IDatasource`'s own
  doc comment confirms the latter is the intended "no upfront total" signal).
- ☑ Write the new ADR (next number after 0027) recording the grid-library
  decision, the rederived CSP threat model for an interactive panel, and the
  testing-boundary call (React/ag-grid wiring excluded from unit coverage
  like `src/webview/entry.ts`; adapter/pagination logic stays ordinary
  unit-tested code) — before, not after, the code that depends on it. **Done**
  — [ADR-0028](../adr/0028-data-viewer-is-react-and-ag-grid.md), with a dated
  amendment to [ADR-0005](../adr/0005-supply-chain-policy.md) recording that
  its "still zero runtime dependencies" invariant survives this change
  because the four packages above land as `devDependencies`.
- ☑ Paginated datasource backed by `getRows`, following `useDataViewer.ts`'s
  infinite-row-model shape. Finding 7.10 settles the total-row-count
  question: `count` is populated even at a small `limit`, so no "last page"
  guessing heuristic is needed. **Done** — `LibraryAdapter.openTable`/
  `getRows` (`src/data/adapter.ts`), unit-tested against recorded fixtures in
  `test/unit/data-adapter.test.ts`; `getRows` never follows a returned `next`
  link (Finding 7.13 confirms the rows collection's own `next` is typed
  correctly on this deployment, but the method does not depend on that
  holding true elsewhere).
- ☑ Column metadata from `getColumns`, mapped to grid column defs. **Done** —
  `LibraryAdapter.getColumns` (`src/data/adapter.ts`) and
  `toWireColumns`/`toWireRows` (`src/data/dataViewerModel.ts`, the
  `vscode`-free host↔webview message module both sides of the panel import
  from), unit-tested in `test/unit/data-adapter.test.ts`.
- ☑ Host-side panel wiring: `DataViewerPanelManager`/`OpenTablePanel`
  (`src/data/dataViewerPanel.ts`) — one panel per open table, the buffered
  `init`/`failure`-only opening-state handshake, per-panel CSP rederived for
  this threat model (no `img-src`, `style-src 'unsafe-inline'` for a
  different, narrower reason than the result panel's own), and the new
  `<link rel="stylesheet">` esbuild's companion `dataViewer.css` needs.
  **Done**, integration-tested (a real `LibraryAdapter` against recorded
  fixtures, a fake `DataWebviewPanel`) in
  `test/integration/data/data-viewer-panel.test.ts`; added to `.c8rc.json`'s
  exclude list, which required teaching `scripts/check-coverage-scope.mjs`
  about `.tsx` files at all — its own `walk()` only ever matched `.ts`, a
  gap this project's first JSX source file exposed.
- ☑ Wire the command: `pythonOnViya.openTable`, bound to a table tree item's
  own `command` (`src/data/dataTree.ts`) and its `view/item/context` menu
  entry (`package.json`), registered in `src/data/dataExplorer.ts` and
  constructed once in `src/extension.ts`.
- ☑ **Adversarial review before the PR exists** (`CLAUDE.md`'s standing
  rule), 2026-09-10, against the finished diff. Three real findings, all
  folded into the branch before any push: (1) `dataViewerModel.ts` had no
  unit test of its own — exercising it only through the integration test
  does not count toward the unit-tier coverage gate, since that tier runs
  outside `c8`'s measurement; added `test/unit/data-viewer-model.test.ts`.
  (2) A `requestId` collision across a webview reload: `retainContextWhenHidden:
  false` means a hide/show reloads the document and resets its own
  `nextRequestId`/`pendingRowRequests`, but the host's `ready` flag and
  buffered-reply logic do not know a reload happened, so a pre-reload
  `getRows` resolving late could resolve the *new* document's same-numbered
  pending request with rows for the wrong window — fixed by switching to
  `crypto.randomUUID()`, globally unique regardless of how many times the
  document reloads. (3) None of `OpenTablePanel`'s three adapter calls
  carried an `AbortSignal`, so closing the panel mid-load did not cancel the
  in-flight compute request — added a per-panel `AbortController`, aborted on
  `onDidDispose`. Two minor nits also folded in: an unused `gridRef` removed,
  and `WireColumn.type` actually wired into `toColumnDefs` (right-aligning
  `NUM` columns via `ag-right-aligned-cell`/`-header`, delivering on a claim
  the model's own doc comment had made since 7b started but nothing read).
- ☑ **Sean's own `npm run verify` and `npm run test:integration`**,
  2026-09-10, surfaced two real gaps the review pass could not have caught
  (it predates both `npm install` and a full local test run). (1) Three
  `DataViewerPanelManager` integration tests called `fake.sendReady()`
  before `manager.open(...)` had been invoked at all, so the fake panel's
  message listener did not exist yet and `sendReady()` was a silent no-op —
  `this.ready` stayed `false`, and `post()`'s guard swallowed every message.
  Fixed by starting `open(...)` without awaiting it, calling `sendReady()`
  synchronously (valid because `open()`→`start()` runs synchronously up to
  its first `await`), then awaiting the result — applied to all three
  affected tests in `test/integration/data/data-viewer-panel.test.ts`.
  (2) Branch coverage fell to 94.82% against the 95% global gate, traced to
  `src/data/types.ts` at 76.47%: `readTableDetail`/`readColumnItem`/
  `readRowItem` (written for 7b, before the review round) had several
  defensive branches no fixture had ever exercised — both counts absent, a
  non-empty label/format/informat, a non-number count, a non-array `cells`.
  Closed with three new `describe` blocks in `test/unit/data-types.test.ts`.
  While in there, one more genuinely-reachable gap in `src/data/adapter.ts`
  was closed the same way: every existing `getRows` test used a bare
  `.../rows` link, so `withQuery`'s `?`-already-present → `&`-joined branch
  had never fired; one test added in `test/unit/data-adapter.test.ts`.
  `readCount`'s own non-object-body guard was traced and deliberately left
  alone — `getRows` only reaches it after `readItems` has already applied
  the identical object/null check, so that branch is unreachable dead code
  from this call site, not a real gap. `npx tsc -p tsconfig.test.json
  --noEmit` and `npx prettier --check` clean on every touched file; Sean's
  own re-run of `npm run verify && npm run test:integration` came back
  green.
- ☑ **Sean's own local build (`npm run build` or the watch task) plus a
  manual visual check of a real panel** — light, dark, and high-contrast
  themes; confirm ag-grid's icon set actually renders (this panel's CSP
  declares no `img-src`, on the prediction that ag-grid needs none — see
  `dataViewerPanel.ts`'s own doc comment on `buildHtml`, which names the
  narrow CSP fix if that prediction is wrong); confirm scrolling actually
  pages new rows in. This was the one check nothing in this sandbox could
  perform, and ran twice — a first pass and, after the Finding 7.14 fixes
  below, a second pass against a confirmed-fresh build.
  **First pass, 2026-09-10,** against a real panel (`manual-test-pass.md` §10/§11, all
  boxes ticked in that file's own diff, committed in the same change as the
  fixes below) — most of both sections pass as documented
  (tree/connection-state behaviour in §10;
  open/scroll/paging/independent-tabs/reveal-not-duplicate/switch-away-and-back
  in §11). **Three real findings surfaced. A second pass, against a
  confirmed-fresh build, then confirmed one fix end-to-end, refined the
  second into a more specific and deliberately deferred gap, and left the
  third exactly as an open design decision:**
  1. **Fixed, and confirmed by Sean's own re-test.** Numeric columns were not
     right-aligning — `Age`/`Height`/`Weight` in `SASHELP.CLASS` rendered
     left-aligned, contradicting §11's own expected result and the alignment
     fix the 7b adversarial review folded in (`toColumnDefs`,
     `src/webview/dataViewerEntry.tsx`, only applied
     `ag-right-aligned-cell`/`-header` when `column.type === "NUM"`).
     **Confirmed live** (Finding 7.14, below, `verde`, 2026-09-10): a real
     `GET …/SASHELP/CLASS/columns` returns `type: "FLOAT"` for every numeric
     column and `type: "CHAR"` for every character one — `"NUM"` never
     appears, matching SAS's own `getColumns` reference example exactly.
     `toColumnDefs` now compares against `"FLOAT"`. The same wrong value had
     also been baked into `test/fixtures/data/columns-class.json` (labelled
     as probe-derived when it was not) and the assertions in
     `test/unit/data-adapter.test.ts` and
     `test/integration/data/data-viewer-panel.test.ts` that read it — all
     three swept to `"FLOAT"` in the same change, per this project's own
     "every claim carries its evidence" rule. Sean's own rebuilt-panel
     re-test confirms numbers render right-aligned now.
  2. **A real fix landed (kept), but it was not the whole story — Sean's own
     re-test against a confirmed-fresh build surfaced a second, deliberately
     deferred gap.** Opening a table while the session is busy showed a blank
     grid with no message, contradicting §11's own expected result (a message
     in the panel, not just the log). One real defect was found and fixed:
     `buildHtml`'s own `<style>` block (`src/data/dataViewerPanel.ts`) set
     `color: var(--vscode-foreground)` on `body` but never set a
     `background-color` — VS Code does not give a webview a themed background
     for free, and a same-shaped public defect report
     (`MoonshotAI/kimi-agent-sdk#225`, "webview ignores VS Code dark theme,
     renders with a white background") confirms this is a known failure mode,
     not a one-off guess. `background-color: var(--vscode-editor-background);`
     was added to that rule and is a correct fix in its own right.
     **Sean re-tested against a fresh, updated, installed build (ruling out
     the stale-build theory) and reported a second, more specific behaviour**:
     while Python runs, both the SAS Libraries tree and an open data-viewer
     panel go blank, and **neither recovers on its own once the run
     finishes** — the tree needs a manual refresh, and the panel has no
     equivalent affordance at all, so it is left showing its busy-session
     state indefinitely; only closing and reopening the tab loads it again.
     For the tree, this is not a new defect: 7a's own Runbook entry already
     recorded it explicitly — *"The tree does not refresh on an `isBusy`
     transition: … and stays empty until a manual refresh after the run
     ends — acceptable for a read-only tree, but a real gap if a later slice
     adds anything that depends on catching the session becoming idle
     again."* 7b's data viewer panel is exactly that later slice, so this
     finding turns 7a's hedge into a concrete yes for the panel too. **Left
     open, deliberately, at Sean's own direction** — not blocking this slice,
     and not addressed by anything already planned in 7c's punch list
     (sort/filter/CSV export/table properties touches none of this), so it
     needs its own future slice or a dedicated decision, not an assumption
     that a later phase absorbs it for free. Whether the busy-session failure
     message itself is legible now (the original contrast question) was not
     independently reconfirmed this pass — Sean's report described the
     recovery gap, not text legibility specifically — so treat that narrower
     point as fixed-and-applied-but-not-re-confirmed, separate from the
     recovery gap, which is confirmed and open.
     **Related, not investigated**: `src/run/resultPanel.ts`'s own `buildHtml`
     has the identical `color`-without-`background-color` gap and was not
     touched — same shape, different panel, out of this slice's scope either
     way.
  3. **Open — a design decision for Sean, not fixed.** The grid always
     renders with `ag-grid`'s light-only `ag-theme-alpine`
     (`src/webview/dataViewerEntry.tsx`), with no dark counterpart or
     theme-detection logic. Sean confirmed text stays legible against it
     either way, so this is not blocking, but it is a real, undecided gap
     ADR-0028 did not address: whether 7b should switch ag-grid themes to
     track VS Code's active theme before this box ticks, or accept a
     light-themed grid inside an otherwise theme-following panel as a known,
     documented limitation. Left alone pending that decision.

  **Adversarial review, 2026-09-10 (Sean, against `origin/main`, covering
  commit `7b111fc` plus the Finding 7.14 fixes above): no blocking findings.**
  Confirmed: every adapter call threads an `AbortSignal` and returns a typed
  `Result` rather than throwing; CSP is nonce-only for scripts with a
  specifically-justified `style-src 'unsafe-inline'` (ag-grid's own inline
  row-positioning styles, not user-controlled HTML); no secrets in any
  fixture; React/ag-grid correctly land as `devDependencies` with ADR-0005
  amended so its dormant production `npm audit` gate doesn't silently apply;
  no `any`/unchecked casts/`console.log`; tests mock at the HTTP/message
  boundary and cover every error branch rather than copying the logic under
  test. Two non-blocking observations, neither a new finding: (a) no test
  directly asserts that disposing a panel aborts its in-flight
  `AbortController` — folded in below; (b) the ag-grid `img-src`-omission and
  light-only-theme items are already tracked above, nothing new.

  **(a) is now folded in and verified**: a new
  `test/integration/data/data-viewer-panel.test.ts` case captures the
  `AbortSignal` a real adapter call carried during `loadTable`, disposes the
  panel, and asserts that exact signal flips to `aborted`, closing the gap
  between "every call threads a signal" and "disposal actually aborts the
  same controller those calls used." `npx tsc -p tsconfig.test.json --noEmit`
  and `npx prettier --check` clean.

  **The prior session's networking trouble did not reproduce.** That session
  (also from the `sas-py-vscode-cowork` clone) could not reach `verde` at all
  — every `curl`/Python attempt failed mid-TLS-handshake while a public host
  succeeded. This session reached both `verde` (200/302, `viya-api-probe`
  ran cleanly) and `Innov` on the first attempt; `Innov`'s stored token had
  since expired (401, unrelated to the earlier failure) and was not
  refreshed, since `verde` alone already settled the question with
  documented-shape agreement. Confirms the earlier problem really was a
  transient, session-specific quirk, not the deployment, the VPN, or the
  skill.

  Two untracked scratch files sit at the repo root, reviewed this session and
  left untouched: `.pr-body-phase-10-scoping.md`/`.pr-body-phase-7d-scoping.md`
  are pre-written PR bodies for other, unrelated scoping slices (Phase 10 and
  7d), not part of this change.

  **A real, pre-existing localisation gap, found while writing this PR's own
  body and fixed at Sean's direction, 2026-09-10**: `dataViewerPanel.ts` had
  been passing `describeDataProblem`'s own log fragment (`src/data/problems.ts`,
  explicitly documented as "the English sentence for a log") straight into the
  webview's `FailureMessage`/`RowsErrorMessage` — the exact busy-session and
  link-missing text this whole Runbook entry is about — with no `l10n.t()`
  anywhere in the path. Every other panel in this project keeps that split:
  `resultPanel.ts` calls a dedicated `localiseBackendProblem`
  (`src/backend/messages.ts`), and `contentFileSystem.ts` calls
  `localiseContentProblem` (`src/content/messages.ts`) for exactly the same
  reason — a `describe...Problem` function is for the log and stays
  `vscode`-free; a `localise...Problem` function is for the one place a
  failure reaches the user directly, and needs `vscode.l10n.t()`, which lives
  on a module `problems.ts` must never import. `src/data/` had no such module.
  Added `src/data/messages.ts` with `localiseDataProblem`, matching that
  pattern exactly (delegating a wrapped `ComputeProblem` to
  `compute/messages.ts`'s own `localiseComputeProblem` rather than
  re-wording it); `dataViewerPanel.ts`'s three call sites, plus its one raw
  literal (`"the table is not open yet"`, in the race-guard `handleRequestRows`
  hits if a row request somehow arrives before `init`), now go through it.
  Neither adversarial review caught this — it is not a correctness or
  security defect, just an inconsistency with the project's own
  localisation-boundary convention. New integration coverage in
  `test/integration/data/messages.test.ts` (the same suite shape as
  `compute/messages.test.ts`), and `.c8rc.json`'s exclude list gained
  `src/data/messages.ts` alongside the project's other `messages.ts` files —
  all `vscode`-importing, so none is reachable from the unit tier
  (`check-coverage-scope: OK — 92 source files, 35 unreachable`). One existing
  integration assertion (`data-viewer-panel.test.ts`, "posts failure... when
  openTable finds no self link") was checking for the word "link" in the old
  log-fragment text; updated to match `localiseComputeProblem`'s own
  deliberately link-free wording instead. `npx tsc --noEmit` / `-p
  tsconfig.test.json`, `npx prettier --check`, `check-secrets`,
  `check-copyright`, and `check-coverage-scope` all clean. **Sean's own call:
  this specific fix skipped the standing pre-push manual adversarial pass**,
  relying on Codex + Claude's automated PR reviews to catch anything further
  — a deliberate, one-off exception, not a change to the standing rule. No
  `CHANGELOG.md` entry — the English text shown to the user is materially
  unchanged (still a plain-language explanation of the same failure), so
  this is an internal-correctness/i18n-infrastructure fix, not a user-facing
  behaviour
  change.

  **[PR #150](https://github.com/Shai-Alit/sas-py-vscode/pull/150) opened
  2026-09-10** — four commits (the original implementation, the Finding
  7.14 fix, the docs-only reconciliation of `STATUS.md`/this file with both
  manual-test passes, and the l10n fix above), against `main` at `58f60ec`
  (post-6c-i). Three more commits landed before merge: the fourth-manual-pass
  documentation update (`d4ddb76`), the profile-scoping panel-key fix
  (`801a6ff`, see below), and a merge of `main` reconciling the 6c-ii
  conflict (`6c93a62`). **Merged 2026-09-10 as squash `60a944e`.**

  **github-advanced-security (CodeQL) finding on PR #150, `js/missing-origin-check`,
  2026-09-10: real, fixed — in two attempts.** `dataViewerEntry.tsx`'s
  `window.addEventListener("message", …)` trusted `event.data` with no check
  on who posted it — the same class of gap CVE-2021-43908 exploited in a
  real VS Code webview (an arbitrary page, loaded in an `<iframe>` pointed at
  the webview, could post a message the handler would process as if the
  extension host had sent it).

  The first fix checked `event.origin` against bare `vscode-webview:`/`https:`
  prefixes, following a Microsoft community thread
  (`microsoft/vscode-discussions#1061`) that suggested the `https:` fallback
  so a future web-hosted (`vscode.dev`) build wouldn't silently break.
  **Codex's automated PR review caught that this was itself broken**: a bare
  `https:` prefix matches essentially every HTTPS origin on the web, so any
  attacker-controlled page loaded in an `<iframe>` pointed at the webview
  still passes the check — it defeats the purpose of having one at all. The
  community thread's suggestion, taken at face value, was wrong; this project
  should have verified it independently rather than citing it as the answer.

  The corrected fix narrows the check to the two concrete origins VS Code
  actually issues a webview: `vscode-webview://<uuid>` for the desktop host,
  confirmed via community-reported `location.origin` values, and
  `https://<uuid>.vscode-webview.net` for a web/`vscode.dev`-hosted build,
  confirmed via the `vscode-resource.vscode-webview.net` domain referenced in
  the CVE-2021-43908 writeup:

  ```ts
  if (
    !event.origin.startsWith("vscode-webview://") &&
    !event.origin.endsWith(".vscode-webview.net")
  ) {
    return;
  }
  ```

  This is narrower than CodeQL's own suggested one-liner would have left it
  if taken as a ceiling (`vscode-webview://` only) in that it still allows a
  future web-hosted build to work, but does not allow an arbitrary HTTPS
  origin the way the first attempt did.
  **Third manual pass, 2026-09-10: confirmed.** Neither of Sean's first two
  passes covered this — both predate the fix — so a dedicated check was
  handed over: open a real table, confirm the grid renders past its initial
  frame, and check the main window's own DevTools console for anything
  naming `postMessage` or `origin`. Sean's console export (a real VS Code
  log, not paraphrased) showed no such error, and the two webview URLs in it
  carry `origin=<uuid>` / `parentOrigin=vscode-file://vscode-app` query
  params consistent with the webview's own origin being
  `vscode-webview://<uuid>` — matching what the check expects. Sean then
  confirmed directly: the grid showed column headers and rows for a real
  table. The failure mode this check exists to catch (every host→webview
  message silently dropped, panel stuck on its initial blank frame) did not
  occur. Closed.
  **Related, not fixed here**: `src/webview/entry.ts` (the result panel's own
  message listener, already shipped) has the identical gap and was not
  touched — a different, already-merged file, out of this PR's diff; worth
  its own decision, not a silent piggyback fix.

  **New finding, incidental to the console check above, 2026-09-10: real,
  not fixed, needs a decision.** Sean's console export also showed, twice:

  ```
  Loading the font 'data:font/woff2;...' violates the following Content
  Security Policy directive: "default-src 'none'". Note that 'font-src' was
  not explicitly set, so 'default-src' is used as a fallback. The action has
  been blocked.
  ```

  Confirmed the source: `node_modules/ag-grid-community/styles/ag-theme-alpine.css`
  itself declares an `@font-face` with a base64 `woff2` payload (ag-grid's
  own bundled icon font for the legacy/classic theming path this project
  uses — see ADR-0028). `buildHtml`'s CSP (`src/data/dataViewerPanel.ts`)
  has no `font-src` directive, so `default-src 'none'` blocks it. This is
  the same class of gap that same file's own doc comment already flagged
  for `img-src` and predicted might need a fix — but the actual break is a
  font, not an image, so the comment's specific prediction was half right:
  right that *something* CSP-adjacent would need attention, wrong about
  which directive.

  **Currently latent, not visibly broken**: `toColumnDefs` ships
  `sortable: false` and no filter (7c's own scope, not 7b's), so nothing in
  today's grid currently renders an icon glyph from that font — consistent
  with Sean's own observation that no sort/filter icons appear at all (that
  absence is 7b's documented scope, not this CSP gap). The gap becomes a
  real, visible defect (missing/broken icons) the moment 7c turns on
  anything ag-grid renders an icon for. **First decision, 2026-09-10: defer
  to 7c** — out of this PR's original scope (verifying the origin check),
  flagged rather than silently folded in, tracked as a 7c punch-list item.

  **Superseded same day.** A second adversarial review (prompted with this
  exact deferral, asked to weigh in) agreed the deferral was *reasonable*
  given 7b's actual behavior, but flagged that the fix is a single directive,
  already confirmed real, and cheaper to fold in now than to keep carrying as
  a tracked item — a judgment call, not a correctness objection. **Sean's
  final call: fix it now.** Added `font-src {cspSource} data:;` to
  `buildHtml`'s CSP — `data:` because the font itself is a data-URI payload
  inside the bundled CSS, `{cspSource}` alongside it for the same reason
  `style-src` already carries it. `buildHtml`'s own doc comment now explains
  this as a correction to its earlier `img-src` prediction (right that
  something CSP-adjacent would need attention, wrong about which directive).
  The integration test that already asserts every other CSP directive
  (`data-viewer-panel.test.ts`) now asserts `font-src` too. The 7c punch-list
  item this created is removed below — there is nothing left for 7c to pick
  up here. `tsc --noEmit` / `-p tsconfig.test.json` and `prettier --check`
  clean.

  **github-actions Bot finding on PR #150, 2026-09-10: real, fixed.**
  `dataExplorer.ts`'s `pythonOnViya.openTable` command handler dropped
  `panels.open(item, adapter)`'s promise with a bare `void`, justified by a
  comment claiming it was "the same shape `provider.refresh()` already is in
  this file." Verified and found the comparison false: `provider.refresh()`
  (`dataTree.ts`) is synchronous and returns `void` — it can never reject.
  `panels.open()` returns a real `Promise<void>` that runs through
  `ComputeClient.send` (`src/compute/client.ts`), which has one narrow, real
  rethrow gap — `resolveHref` throwing anything that is not a
  `ForeignLinkError` propagates rather than becoming a typed `Result` — the
  exact hazard `sessionManager.ts`'s own `deleteSession` call already guards
  against, in an almost identically worded comment, for the same reason.
  Every failure `LibraryAdapter` itself anticipates (busy session, missing
  link, unauthorized, unreachable) already comes back as a `Result` the
  panel surfaces in its own UI; the gap is only the narrow rethrow path,
  plus whatever `buildHtml`/`createWebviewPanel` could throw synchronously.
  Fixed to match the existing `sessionManager.ts` precedent exactly:
  `void panels.open(item, adapter).catch((error) => log.error(...))`, using
  the `log: vscode.LogOutputChannel` already in scope. `src/data/dataExplorer.ts`
  is already excluded from the coverage gate (imports `vscode`), so no new
  test is owed here. `tsc --noEmit` / `-p tsconfig.test.json` and `prettier
  --check` both clean.

  **Second adversarial review, 2026-09-10** (prompted with the font-src
  deferral specifically, per the process above): no blocking findings across
  the full 7b diff (11 files across the 7b commits). Endorsed the origin
  check as sound after the Codex-caught tightening, the `AbortSignal`
  wiring, the `dataExplorer.ts` `.catch`-logging fix above, the HTTP-boundary
  test mocks, the licensing headers, and the build/config changes. Two low,
  non-blocking findings — **both fixed, 2026-09-10, Sean's call to fold them
  in alongside the CSP fix**:
  - `dataViewerEntry.tsx`'s message-listener guard (`typeof message !==
    "object"`) let a `null` `event.data` through, since
    `typeof null === "object"` — `message.type` would then throw. Practically
    unreachable (the origin check already restricts who can post, and
    nothing this project's own host code sends is `null`), and this file is
    structurally excluded from every test tier, so nothing would have caught
    it either way. Fixed with an explicit `message === null` arm in the
    guard.
  - `dataViewerModel.ts`'s doc comment for `WireColumn.type` still read
    "`CHAR`, `NUM`, …" — the literal value Finding 7.14 replaced with
    `"FLOAT"` everywhere else. A documentation-only miss of this project's
    own "sweep the superseded value out of every place it was written down"
    rule. Fixed to read `` `CHAR`, `FLOAT`, … `` with a pointer to Finding
    7.14.

  `dataViewerEntry.tsx` is structurally excluded from every test tier
  (browser-only webview code), so no new test is owed there. `dataViewerModel.ts`
  is not excluded and already has unit coverage (`test/unit/data-viewer-model.test.ts`) —
  a doc-comment-only fix needs no new test, but that same fixture file is
  worth its own look later: it still uses `"NUM"` as its sample type-string
  value in several cases (the field is opaque passthrough there, never
  compared, so this is not a correctness bug the way `toColumnDefs`'s old
  check was — just a stale-looking example value). Not touched here, out of
  this fix's actual scope; flagged rather than silently swept.
  `tsc --noEmit` (root, `-p tsconfig.webview.json`, `-p tsconfig.test.json`)
  and `prettier --check` all clean.

  **CodeQL "Commit suggestion" applied directly to the PR branch, 2026-09-10,
  commit `03e6caec` — origin check rewritten again, real gap flagged, fixed
  by re-verifying.** After the third manual pass above confirmed the
  `startsWith("vscode-webview://")` / `endsWith(".vscode-webview.net")`
  check, GitHub's Advanced Security "Copilot Autofix" suggestion for the same
  `js/missing-origin-check` alert was applied via the code-scanning UI's
  "Commit suggestion" button, landing as its own commit without going through
  local review first. It replaced the check with:

  ```ts
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(event.origin);
  } catch {
    return;
  }
  const isTrustedOrigin =
    parsedOrigin.protocol === "vscode-webview:" ||
    (parsedOrigin.protocol === "https:" &&
      parsedOrigin.hostname.endsWith(".vscode-webview.net"));
  if (!isTrustedOrigin) {
    return;
  }
  ```

  A subsequent automated PR review correctly caught that this exact
  implementation had never itself been run against a real panel — the third
  manual pass verified the previous `startsWith`/`endsWith` version, not this
  rewrite, and `STATUS.md`/this file hadn't been updated to say so. On
  inspection the logic is at least as strict as the version it replaced
  (proper `URL` parsing instead of raw-string matching, and an explicit
  `protocol === "https:"` requirement that the old `endsWith` check never
  pinned), so this was not treated as a suspected regression, but the
  project's own standing rule for this file — confirm against a real panel
  before merge, every time the check changes — still applied.
  **Fourth manual pass, 2026-09-10: confirmed**, against `03e6caec`
  specifically. Sean opened a real table on this branch; DevTools showed no
  `postMessage`/`origin` error, and the grid rendered column headers and
  rows. A separate console log from opening another table the same session
  showed only `Unrecognized feature: 'local-network-access'` and `An iframe
  which has both allow-scripts and allow-same-origin for its sandbox
  attribute can escape its sandboxing` — both traced to VS Code's own
  `webviewElement.ts`/`overlayWebview.ts` internals (present in every VS Code
  webview panel, including this project's existing result panel), not to
  anything in this PR's diff. Closed.

  **Automated review finding on PR #150, 2026-09-10: real, fixed —
  `DataViewerPanelManager`'s panel key was not profile-scoped.**
  `open()`'s reuse key was `` `${table.libref}.${table.name}` `` alone.
  `ComputeSessionManager.live` (`src/compute/sessionManager.ts:227`)
  explicitly supports two profiles holding sessions at once, and a table
  name like `SASHELP.CLASS` exists under virtually every deployment.
  Concretely: open `SASHELP.CLASS` under profile A, switch the active
  profile to B (A's session can remain live), open `SASHELP.CLASS` again —
  `open()` found the existing panel under the same key and called
  `existing.reveal()` without ever re-binding it to the newly-passed
  adapter, so the tab kept scrolling/paging against profile A's session
  under a title that looked like it belonged to B. If A had since
  disconnected this would surface as `not-connected`, but with both
  connected (the supported case) it was a silent cross-deployment mix-up —
  the same shape of bug the 6b review already caught and fixed for the
  `sasContent:` `FileSystemProvider`'s `ETag` guard (keyed by href alone,
  now deployment root + href).

  Fixed by exposing `LibraryAdapter`'s already-private `profileId`
  (`src/data/adapter.ts`, constructor parameter changed from `private
  readonly` to `readonly`) and folding it into the panel key:
  `` `${adapter.profileId}\n${table.libref}.${table.name}` ``, `\n`-joined
  for the same reason the `sasContent:` guard's key is — neither a profile
  id nor `libref.name` can contain one, so the two parts can never collide
  across the join. A new regression test ("opens a fresh panel, not the
  other profile's, for the same table under a different profile",
  `test/integration/data/data-viewer-panel.test.ts`) opens the same table
  under two different profiles and asserts each gets its own panel (its own
  `openTable`/`getColumns` requests, neither `reveal()`ed). The reviewer's
  suggestion to also scope the panel/tab *title* by profile (so two
  profiles' same-named tables are visually distinguishable, not just
  correctly isolated) is not done here — `LibraryAdapter` has a raw
  `profileId`, not a human-readable label, and plumbing one through is a
  separate, cosmetic follow-up, not the correctness fix this finding was
  about. `npm run verify` (1419 unit passing) and `npm run test:integration`
  (296 passing) both green.

☑ **7c — Sort, filter, CSV export, table properties.** Split into three
sub-slices (Sean, 2026-09-10), mirroring 6c's own split — each is
independently valuable and none blocks another: **7c-i** sort + filter
(share one request payload and one probe, since upstream combines them into
a single re-fetch); **7c-ii** table properties/columns static viewer (fully
static, no grid interaction); **7c-iii** CSV export to local disk (the one
host-side-only, local-disk-write feature, standalone since Phase 6 deferred
its own upload/download to Phase 11 entirely rather than shipping a helper
this could share). **7c-i, 7c-ii, and 7c-iii are all done and merged** —
[PR #155](https://github.com/Shai-Alit/sas-py-vscode/pull/155),
[PR #158](https://github.com/Shai-Alit/sas-py-vscode/pull/158) /
[PR #160](https://github.com/Shai-Alit/sas-py-vscode/pull/160), and
[PR #161](https://github.com/Shai-Alit/sas-py-vscode/pull/161) (squash
`dac4f7f`) respectively.

☑ **7c-i — Sort + filter.** [PR #155](https://github.com/Shai-Alit/sas-py-vscode/pull/155)
opened 2026-09-10. Code written 2026-09-10 (`sas-py-vscode-cowork`
clone), following the live-probed shape Findings 7.15–7.18 established.
Design decisions (view-per-(sort,filter)-state reuse across pagination, a
filter baked into `createView`'s own body whenever a sort is active, a
serialised `ensureReadTarget` closing a real concurrent-view-creation race,
guaranteed cleanup on every state change and on dispose) recorded in
[ADR-0029](../adr/0029-sort-view-lifecycle.md), written alongside this code
per this project's own convention. `src/wire/viyaError.ts`'s `readViyaError`
also gained a fallback to a nested `errors[0].details` sentence (Finding
7.18) — a shared-module fix, not scoped narrowly to this slice, since any
future caller hitting the same envelope shape benefits. New
`docs/dev/manual-test-pass.md` §12 (unrun — Sean's own manual check of the
filter-bar layout and sort-icon rendering is still needed, per this slice's
own "not yet visually confirmed" notes in `dataViewerEntry.tsx`); §11's own
"no sort/filter" known-gap row updated to point at it. `CHANGELOG.md`
updated. `npm run verify` green (1468 unit passing; 95.35% lines / 95.44%
branches / 94.98% functions / 95.35% statements, every threshold met — 100%
on every line/branch this slice touched, including two small branch-coverage
gaps a first coverage run found and closed:
`dataViewerModel.ts`'s `isSortSpec` guard against a `null`/non-object sort
entry, and `viyaError.ts`'s two nested-`errors[]`-loop branches); `npm run
test:integration` green (309 passing — three new-test failures on the first
run traced to a pre-existing fixture bug, not a code bug, see below);
`npm run check:docs`/`l10n:extract`/`build` all clean. **A pre-existing
fixture bug found and fixed the same session**: `test/fixtures/data/
table-detail-class.json` (built for 7a/7b, before this slice's own probe)
had guessed both its `createView` and `rowsAsCSV` link hrefs wrong
(`.../CLASS/createView` and `.../CLASS/rowsAsCSV`, plausible-looking
extrapolations from the relation name that Finding 7.15 shows are not what a
real deployment sends); neither had a caller before 7c-i, so it went
unnoticed until this slice's own new tests tried to follow `createView` and
hit an unmatched-route failure. Corrected to the real shape, and the
fixture's missing `delete` link added.

**Adversarial review ran twice before any push, per `CLAUDE.md`'s standing
rule.** First, an independent agent pass against the finished diff (Sean's
own call, given this session's own tool access) — no blocking findings. Two
low-priority notes, both addressed: a doc comment added to
`dataViewerPanel.ts`'s dispose handler working through, and rejecting on the
merits, the "does a leak survive a createView POST still in flight at
dispose time" question (no — `AbortSignal` wiring already guarantees an
aborted in-flight request resolves to a failure, not a late success, so
`ensureReadTargetLocked` never reaches the assignment that would leak it;
already covered by `compute-client.test.ts`'s own abort tests, not something
this file needs a new, necessarily-inaccurate-fake test for); and a
type-level hardening suggestion (a discriminated `ReadTarget` type so
passing a filter against a view fails to compile rather than relying on
`getRows`'s own doc comment) noted as a real, deliberately deferred
architecture question for a future slice, not built here — `getRows` has
exactly one caller today and it is correct.

**Second, Sean's own review** (per this project's actual standing
requirement — the review must be handed to the developer and answered, not
merely performed in-session), against the same `git diff main`. Also no
blocking findings, but three further real, low-priority notes this pass
caught that the first missed — all folded in before push:

1. **The new filter `<input>` had no theme-aware styling** — it would have
   rendered with the browser's default control chrome (a bright white box)
   regardless of VS Code's active theme. Fixed: a CSS rule added to
   `buildHtml`'s own `<style>` block (`dataViewerPanel.ts`) using
   `--vscode-input-background`/`-foreground`/`-border`/
   `-placeholderForeground` and `--vscode-focusBorder`, the same VS
   Code-documented variables this panel's own `body` rule already uses for
   `--vscode-foreground`/`--vscode-editor-background`. A new assertion in the
   existing "builds an HTML shell" integration test checks for the rule.
2. **A `getRows` call that follows a resolved `ensureReadTarget` is not
   itself serialised against a *later* request's own state change** — a fast
   sort/filter change could leave an earlier request's read still in flight
   against a view a newer request has already discarded and recreated,
   answering (say) a 404 for a request nothing is meaningfully waiting on
   anymore. Fixed: `handleRequestRows` now compares `sort`/`filter` against
   the panel's *current* `activeSort`/`activeFilter` immediately before
   posting either a `rows` or a `rowsError` reply, and drops it silently if
   they no longer match — closing this found, in fixing it, that
   `ensureReadTargetLocked`'s own no-sort branch never updated
   `activeFilter` at all, which would have made this exact check
   permanently misfire against every plain filtered-no-sort request. Fixed
   in the same change. A new integration test (`test/integration/data/
   data-viewer-panel.test.ts`, "drops a stale reply…") reproduces the race
   directly via a raw fake `ComputeClient` whose one held-back response is
   resolved by hand, after a second, faster request has already superseded
   it.
3. **`ensureReadTarget` returned the raw, un-`catch`'d promise** — the
   `.catch()` on the *stored* chain protects every later call from a
   poisoned chain, but left the promise `handleRequestRows` itself awaits
   still capable of rejecting (nothing in this codebase's adapter layer
   actually throws today, so this was latent hardening rather than a
   reachable gap, but a future regression would have surfaced as a silent
   unhandled rejection through the `void this.handleRequestRows(...)`
   fire-and-forget call, rather than an ordinary `rowsError` reply). Fixed:
   the returned promise now also converts a rejection into an ordinary
   `DataResult` failure.

One more note from this pass was examined and needs no change:
`encodeURIComponent` leaving `'` unencoded in a `where=` query string is
legal and matches how Finding 7.16 was itself probed — the existing test
asserting that exact encoded shape is intentional, not an oversight.
`npm run verify`/`test:integration` re-run green after all three fixes
(1468 unit passing; 95.35%/95.44%/94.98%/95.35%, unchanged; 310
integration passing).

- ☑ Live-probe the `createView` mechanism against `verde` — **done**,
  Findings 7.15–7.18. Settled, correcting this bullet's own original
  framing: `where=` does **not** compose onto an already-created view's own
  `rows` link (Finding 7.16 — silently ignored, no error); it must be baked
  into the same `createView` body as `sortBy` instead, meaning a filter
  change while a sort is active requires recreating the view. A filter
  change with **no** sort active needs no view at all — `where=` applies
  directly to the base table's own `rows` link (confirmed working there).
  `TableDetail.links` carries a real `createView` relation (`POST`) and a
  real `delete` relation (`DELETE`) — both followed the way every other
  `LibraryAdapter` call already does, no hand-composed URL. Also settled:
  `count` (Finding 7.10's total-row-count field) is present only on a plain,
  unfiltered base-table read — **absent** the instant a filter or a view is
  involved (Finding 7.17), so the grid must fall back to the "short page ⇒
  last page" heuristic whenever sort or filter is active. An invalid
  `where=` is a `400` in the standard error envelope with the real parser
  message nested in `errors[0].details` (Finding 7.18) — surface that
  nested text, not just the generic top-level message. **Not done**:
  a second-deployment (`Innov`) cross-check — `Innov`'s stored token had
  expired this session; left open, not blocking (see Finding 7.18's own
  "not probed" paragraph).
- ☑ Fix, not port, upstream's orphan-view bug: `RestLibraryAdapter.
  getSortedRows` (`vscode-sas-extension`) calls `createView` → `getRows` on
  the view → `deleteTable`, with no try/finally — a throwing read leaves the
  view orphaned in the session until the session itself is torn down, with
  no cleanup-on-dispose anywhere in that codebase. This project's own
  version reuses one view across every page fetch for as long as the same
  sort+filter state is active (a real improvement over upstream's own
  per-page-fetch create/delete churn, confirmed wasteful but harmless by
  Finding 7.15) and must guarantee the delete fires whenever that state
  changes (a new sort, a new filter while sorted, sort turned off) or the
  panel disposes — on every exit path, not just the success path.
- ☑ `where=`-clause text filter, matching `TableFilter.tsx`'s upstream shape:
  one free-text "expression" box (a raw SAS `WHERE` clause), committed on
  Enter or an explicit action, never live-typed. No sort active: appended
  directly to the base table's own `rows` link the same way `getRows`
  already appends `start=`/`limit=` via `withQuery`. Sort active: baked into
  the `createView` body alongside `sortBy` (Finding 7.16), not applied as a
  query parameter.
- ☑ New host↔webview messages for a combined sort+filter re-fetch, following
  `dataViewerModel.ts`'s existing `requestId`-echo pattern (`requestRows`/
  `rows`/`rowsError` today carry no sort/filter state at all).
- ☑ `toColumnDefs`'s hardcoded `sortable: false` (`dataViewerEntry.tsx`, with
  an explicit comment deferring it to 7c) becomes real server-side sort,
  wired to ag-grid's own header-sort state the way upstream's `useDataViewer.
  ts` reads `params.sortModel` on every `getRows` call — not a client-side
  ag-grid sort.

**Sean's own manual test pass, 2026-09-10** (`manual-test-pass.md` §12,
before PR #155 merged), found three real bugs, all fixed on the same branch:

1. **A sort or filter was silently lost switching away from the table's tab
   and back.** Root cause: `createRealPanel`'s `retainContextWhenHidden:
   false` (unchanged from 7b, ADR-0021's own reasoning for the result panel)
   means VS Code tears the webview document down and reloads it from scratch
   on every hide/show. The freshly mounted grid sends its own `"ready"`
   handshake again, but had no memory of a sort or filter the *previous*
   document had applied, so its first `requestRows` read as `sort: []`,
   `filter: ""` — which `ensureReadTargetLocked`'s own `sort.length === 0`
   branch takes as the user having cleared both, discarding the still-wanted
   server-side view rather than merely losing a UI indicator. **Fixed**:
   `InitMessage` (`dataViewerModel.ts`) gained `initialSort`/`initialFilter`,
   and `OpenTablePanel` (`dataViewerPanel.ts`) now replays its *current*
   `activeSort`/`activeFilter` on every `"ready"` — not the state frozen at
   `loadTable()` time — via a new `openingMessageFor` helper. On the webview
   side, `dataViewerEntry.tsx`'s `"init"` handler now restores the filter
   box's displayed text and seeds `committedFilterRef`, and `toColumnDefs`
   sets a matching column's `sort`/`sortIndex` so ag-grid seeds its own
   sort-model state at mount, the documented way to give it a default sort.
   Two new integration tests in `data-viewer-panel.test.ts` simulate the
   reload directly (a second `sendReady()` with no request in between) and
   assert the replayed `init` carries the sort/filter a prior request made
   active, for both the sorted and the filter-only cases.
2. **An invalid filter showed a blank grid — no error, no warning, nothing in
   the log.** Finding 7.18 had already settled that the host computes a
   real, specific message for this (a `400` with the SAS parser's own
   complaint nested in `errors[0].details`, surfaced through
   `localiseComputeProblem`'s existing `compute-rejected` case) — the defect
   was `dataViewerEntry.tsx`'s own `buildDatasource`, which discarded a
   failed `requestRows` promise's rejection reason and called only
   `params.failCallback()`. **Fixed**: the datasource now takes an
   `onRowsError` callback, wired to a new `rowsError` React state rendered
   as a small banner above the grid (themed with
   `--vscode-inputValidation-error*`, the standard VS Code error-styling
   variables, matching the filter box's own `--vscode-input-*` use). Also
   added: `dataViewerPanel.ts`'s `handleRequestRows` now logs a `warn` for
   both of its failure paths (`ensureReadTarget` failing before a read is
   even attempted, and `getRows` itself failing) — there was no log output
   for either before, which is what "nothing in the log" actually meant. A
   new integration test asserts the warning; the existing "answers
   rowsError…" test was left as-is (it already asserts the reply shape).

None of the three fixes touch a code path any of §12's other, already-`[x]`
rows exercise — `initialSort`/`initialFilter` are empty on a table's first
open, identical to before, and the `onRowsError` callback is inert on every
success. `npm run verify` re-run green (1468 unit passing, coverage
unchanged — 95.35%/95.44%/94.98%/95.35%, thresholds still met); `npm run
test:integration` green (313 passing, three new); `check:docs`/`tsc -p
tsconfig.webview.json`/`build` all clean. `manual-test-pass.md` §12 updated:
the invalid-filter row and two new tab-switch rows are unchecked pending
Sean's own re-verification against a real panel; every other row in §12
stays checked.

**Also found, separately, while investigating why both AI PR reviewers
showed "pass" on PR #155 with no actual review comment posted**: not a
runner fluke. Both `ai-review.yml` and `claude-review.yml` share one failure
mode — their `concurrency: cancel-in-progress` group cancelled the review
runs against the branch's real source commits (`b309ea5`, `7d31ae7`) the
moment a fast-follow, correctly-`[skip-review]`-tagged docs-only commit
(`73e190f`) was pushed right after; that commit's own run then legitimately
skipped *itself*, but the net effect is that neither reviewer ever actually
saw the substantive diff, while the PR's checks read "pass" for both. Fixed
in a separate PR, [#156](https://github.com/Shai-Alit/sas-py-vscode/pull/156)
(squash), rather than folded into this branch: both `ai_review.py`'s
`should_skip_review` and the Claude Review guard step now also require the
commit immediately *before* a `synchronize` push to be skip-tagged before
honouring the head's own flag, otherwise they review the current
(complete) diff instead of skipping. Sean squash-merged #156 into `main`
2026-09-10; this branch was then reconciled with `main` a second time
(merge commit, no conflicts — only `.github/` files, nothing this branch
also touches) and pushed, at which point both automated reviewers actually
ran for the first time against this branch's real diff.

**Both reviewers then found one real finding each, both fixed before any
further push** — collected together per this project's own "fix everything
in one local pass" rule, not pushed one at a time:

1. **Blocking (github-actions bot): a stale `requestRows` reply was
   silently dropped, never answered at all.** The staleness check
   `handleRequestRows` added during 7c-i's own second review round (see
   above) returned with no reply once `sort`/`filter` no longer matched the
   panel's current state — reasoning that nothing was "meaningfully
   waiting" on it. Verified independently before fixing, since the
   PR-opening rule requires it: `dataViewerEntry.tsx`'s own
   `pendingRowRequests` map is keyed by `requestId` and only ever cleared
   when a `rows`/`rowsError` reply for that exact id arrives — a silently
   dropped reply leaves that map entry, and the `getRows` promise it would
   resolve, pending forever. A real, if narrow, unbounded leak across a
   session with enough sort/filter changes, confirmed correct — this
   project's own message protocol requires every `requestRows` to get
   exactly one reply, with no documented exception for a stale one. Fixed:
   the branch now posts a `rowsError` (`"This request was superseded by a
   later sort or filter change."`) instead of returning silently. The
   existing regression test for this path ("answers a stale request with
   rowsError, not silence…", renamed from "drops a stale reply…") now
   asserts the reply arrives, rather than asserting it doesn't.
2. **Non-blocking (github-actions bot): no regression test exercised
   `onDidDispose`'s own stale-view cleanup.** Every existing dispose test
   ("disposes every open panel", "aborts the panel's own AbortController…")
   disposes a panel with no active sort/filter, so `activeView` is always
   `undefined` at dispose time in each of them — the `deleteView` call that
   handler's own comment reasons through adversarially (does a leak survive
   an in-flight `applySort` at dispose time — no, `AbortSignal` wiring
   already guarantees it) had zero coverage on either its success or its
   failure-logged path. Verified real by inspection (no other test creates
   a view and *then* disposes, as opposed to superseding it with a new
   sort). Fixed: two new tests — one asserts the `DELETE` fires for the
   active view on dispose, the other asserts the existing `log?.warn`
   fires when that `DELETE` fails, mirroring the already-covered
   supersede-path version of the same log line.

`npm run verify` re-run green (coverage unchanged, `src/data` still 100%
lines/100% statements/99.5% branches/100% functions); `npm run
test:integration` green (321 passing — the jump from 313 includes 6c-iii's
own new tests picked up by the `main` reconciliation, plus this round's 2
new dispose tests); `check:docs`/`build` clean.

**A third finding arrived from the same review pass, against the fix
commit above (Major, github-actions bot): all four of `dataViewerPanel.ts`'s
own `log?.warn` calls — the two this round added, plus two pre-existing
ones from 7c-i's original commit (the dispose-time and the supersede-path
view-delete-failure warnings) — were hard-coded English, not run through
`vscode.l10n.t()`.** Verified against this project's own established
convention before fixing: `dataTree.ts`/`contentTree.ts`/
`contentFileSystem.ts`/`sessionManager.ts` all wrap a `describeXProblem()`
log fragment in `vscode.l10n.t("<area>: {0}", describeXProblem(...))` — the
outer sentence is localised even though the inner fragment stays English by
design (`describeDataProblem`'s own doc comment). This file's four
`log?.warn` calls never did, missed since the original 7c-i commit. Fixed:
all four now wrap in `vscode.l10n.t()`, `"SAS Libraries: {0}"` prefix
(matching `dataTree.ts`'s own precedent for this exact `DataProblem`
vocabulary), with the table/view name and the `describeDataProblem`
fragment passed as `{0}`/`{1}` placeholder arguments rather than
interpolated into the message string itself, so `npm run l10n:extract`
picks them up (confirmed: 212 strings extracted, up from 208, 5 total
carrying the "SAS Libraries" prefix). No test changes needed — every
existing assertion on these lines matches a substring of the rendered
English text (e.g. `/could not delete/`), unaffected by the wrapping.
`npm run verify` green (1479 unit passing, coverage unchanged); `npm run
test:integration` green (321 passing, unchanged).

☑ **7c-ii — Table properties / columns static viewer.** Code written
2026-09-10/2026-09-11 (`sas-py-vscode-cowork` clone), live-probed first
(Finding 7.19: the full `TableInfo` field set, and the timestamp-shape
question this punch list itself raised — ISO-8601, not a raw SAS epoch
number). `src/data/types.ts`'s `TableDetail`/`readTableDetail` gained
`type`/`label`/`engine`/`extendedType`/`logicalRecordCount`/
`physicalRecordCount`/`recordLength`/`creationTimeStamp`/`modifiedTimeStamp`/
`compressionRoutine`/`encoding`/`bookmarkLength`, read with the same
"empty string ⇒ absent" tolerance `readColumnItem` already gives `Column`'s
own optional fields. A new `src/data/tablePropertiesModel.ts` (`vscode`-free,
unit-tested: `escapeHtml`, `formatTimestamp` — ISO-first with the
upstream-parity epoch fallback kept but not confirmed reachable — and three
`formatOptional*` helpers) and `src/data/tablePropertiesPanel.ts`
(`TablePropertiesPanelManager`/`TablePropertiesPanel`, `.c8rc.json`-excluded
and integration-tested, mirroring `DataViewerPanelManager`'s own
profile-scoped panel-key discipline). **Deliberately not a straight port of
`TablePropertiesViewer.ts`'s own client-side tab toggle**: this panel needs no
`<script>` at all — the "Properties"/"Columns" tabs are two `<input
type="radio">` elements with `<label>`s styled as tab buttons, and the two
content panes are shown or hidden by a plain CSS sibling selector keyed off
which radio is `:checked`. `enableScripts` is `false`, the only one of this
project's three webview panels that needs no script execution — a smaller
attack surface than upstream's own version, at no cost to the two-tab UX,
not a scope addition of its own. The panel's HTML is rebuilt in place
(loading → success/failure) with no message protocol; every dynamic field is
`escapeHtml`-escaped, since (unlike the other two panels) this one
concatenates untrusted wire text (a column's own `label`/`format`/`informat`)
directly into HTML strings rather than going through a message channel or the
DOM API. New command `pythonOnViya.showTableProperties`, wired the same way
`openTable` is (`dataExplorer.ts`, `dataTree.ts`'s context menu). `npm run
verify` green (1519 unit passing; coverage 95.48% lines / 95.43% branches /
95.15% functions / 95.48% statements, every threshold met — `src/data/`
itself 100% lines/functions/statements, 99.59% branches); `npm run
test:integration` green (333 passing, 9 new — this clone's own baseline is
higher than the "321" figure quoted earlier in this file for 7c-i alone,
since `main` here also carries 6d-i's own tests). A first coverage run found one
real gap: `readTableDetail`'s new `extendedType` field never had a
non-empty-value test (the real fixture's own probed value is always `""`),
closed with one more unit test. A first `npm run lint` pass also found a real
`@typescript-eslint/no-unnecessary-condition` finding: a `disposed`-flag guard
reused verbatim after two different `await` points let TypeScript narrow the
second occurrence to a compile-time `false` (it does not model that a
callback registered elsewhere, not this method's own control flow, is what
flips the flag) — fixed by moving the guard into its own `render()` helper
called fresh at each of the three render sites, which is also the cleaner
shape on its own merits (one write path instead of three inline ones).
`test/fixtures/data/table-detail-class.json` (shared with 7a/7b/7c-i) gained
the new fields from Finding 7.19's own real values; no existing assertion
read the whole object, so nothing else needed updating.

**Adversarial review before the PR exists** (`CLAUDE.md`'s standing rule),
2026-09-11, against the finished diff (`types.ts`, the two new `src/data/`
files, the `dataExplorer.ts`/`extension.ts`/`package.json` wiring, both new
test files, the fixture, and this slice's own docs). **No blocking
findings.** Confirmed independently, not merely relayed: every dynamic value
interpolated into the panel's HTML goes through `escapeHtml`/`formatOptional*`;
the panel key is profile-scoped the same way 6b's `sasContent:` `FileSystemProvider`
and 7b's `DataViewerPanelManager` already are, with its own regression test;
the `315619200` SAS-epoch constant is arithmetically correct (3653 days ×
86400s); `readTableDetail`'s new fields genuinely omit rather than carry
`undefined`, confirmed by a strict `deepEqual`. Four low-priority notes, one
folded in:

1. **Folded in.** `formatTimestamp`'s own epoch-fallback unit test re-derived
   the function's `315619200` constant rather than asserting against an
   independently-computed expected value — a wrong constant in the code would
   have still passed. Fixed: the test now asserts against
   `2023-05-18T03:33:20Z`, computed by plain date arithmetic (2,000,000,000
   seconds after 1960-01-01), not by repeating the function's own subtraction.
2. **Accepted as-is.** `formatTimestamp`'s `new Date(value)` parses a bare
   short numeric string as a year (`"2026"` → the year 2026), so such a value
   never reaches the SAS-epoch fallback branch at all. Not reachable with real
   data (Finding 7.19: the two fields are ISO-8601, and the fallback is
   already documented as not confirmed reachable) — parity with upstream's own
   identical ordering (`new Date` first, numeric fallback second), not a
   regression to fix here.
3. **Deliberately deferred, not fixed here.** If `openTable`/`getColumns`
   *rejects* rather than resolving `{ok:false}` (the narrow
   `resolveHref`-rethrow path `adapter.ts`'s own `openTable` doc comment
   already names), `TablePropertiesPanel.start()`'s promise rejects,
   `dataExplorer.ts`'s `.catch` logs it, and the panel is left showing
   "Loading…" forever rather than a failure message. **This is not new**:
   `DataViewerPanelManager`'s own `loadTable` has the identical gap today, so
   fixing it only in this slice's panel would leave the sibling one
   inconsistent, and fixing both is a second file this slice did not open —
   real scope creep for a one-line `try`/`catch`, not a defect this diff
   introduced. Left as a known, shared, non-blocking gap; worth a small
   follow-up covering both panels together rather than fixed piecemeal here.
4. **Not a defect, just an observation.** `TablePropertiesPanel.render()`
   guards on its own `disposed` boolean rather than `this.controller.signal
   .aborted` — already deliberately documented (this file's own comment on why
   a shared `if (this.disposed) return;` across multiple `await` points
   tripped `@typescript-eslint/no-unnecessary-condition`, and why `render()`
   exists as its own method instead) and covered by a test.

`npm run test:unit` re-run green after the one fix (1519 passing, unchanged —
the fix only strengthened an existing assertion, adding no new test);
`npx prettier --check` clean on the touched file. No other file in this diff
changed, so no wider re-verification was warranted for a test-only fix.

**[PR #158](https://github.com/Shai-Alit/sas-py-vscode/pull/158) opened
2026-09-11.** Both automated PR reviewers ran against the real diff. The
project's own Claude reviewer found nothing beyond what the pre-PR pass had
already disclosed (independently re-verified the same escaping/profile-scoping/
epoch-constant/`deepEqual` claims and approved). **Codex found two real
issues, both fixed before any further push:**

1. **Blocking.** `panelHead`'s CSP allowed `style-src {cspSource}
   'unsafe-inline'`, reasoned (in this file's own pre-PR write-up above) as
   safe because every dynamic value is `escapeHtml`-escaped before it reaches
   the page. Codex correctly pushed back: relying solely on this file's own
   escaping discipline is weaker than not needing the exception at all.
   Unlike `dataViewerPanel.ts` (which genuinely needs `'unsafe-inline'` —
   `ag-grid`'s own runtime sets `style="…"` *attributes* on arbitrary
   elements, which a CSP nonce cannot cover, only a `'unsafe-inline'`/
   `'unsafe-hashes'` source can), this panel has exactly one `<style>`
   *element* and zero inline `style="…"` attributes anywhere in its generated
   markup — so a nonce, the same mechanism `resultPanel.ts`/
   `dataViewerPanel.ts` already use for their own `<script>` tag, removes the
   exception entirely rather than merely justifying it. Fixed:
   `panelHead()` generates its own nonce, `style-src 'nonce-{nonce}'`
   replaces `{cspSource} 'unsafe-inline'`, and `cspSource` is dropped from
   `TablePropertiesWebviewPanel` entirely (now genuinely unused). A new
   integration test (`"locks style-src to the <style> tag's own nonce, with
   no 'unsafe-inline' anywhere"`) pins both the absence of `unsafe-inline`
   and that the CSP's nonce matches the `<style>` tag's own.
2. **Major.** The two `log.error` calls this slice added
   (`dataExplorer.ts`'s `openTable`/`showTableProperties` command handlers'
   own `.catch`) were hard-coded English, unlike every comparable log line
   elsewhere in this codebase (`dataTree.ts`/`contentTree.ts`/
   `dataViewerPanel.ts`'s own `"<area>: {0}"` pattern, and 7c-i's own
   identical fix for `dataViewerPanel.ts`'s `log?.warn` calls). Codex flagged
   only the new `showTableProperties` one (the only one in this PR's diff),
   but `openTable`'s own log line — right above it, copied from when 7b wrote
   it — has the exact same defect; fixing only the flagged line and leaving
   its literal neighbor un-localised would have been inconsistent, so both
   were wrapped in `vscode.l10n.t()` in the same file, same pattern as the
   rest of this project.

**A CI failure surfaced separately, on the same push: `test (windows-latest,
node 24)` timed out at the unit tier's 2s default budget**, on
`tablePropertiesModel.test.ts`'s very first test. Root cause: `formatTimestamp`
is this project's first-ever caller of `Date.prototype.toLocaleString()` —
confirmed nothing else in `src/` or `test/unit/` calls it — and this was the
first time the whole test process ever exercised `Intl`-backed date
formatting, which has to load ICU data somewhere on first use; that
first-use cost apparently exceeded 2s on this specific runner/Node
combination (passed on `windows-latest, node 22.18.0` and every other
platform). Same category `eslint-ignores.test.ts` (loading ESLint) and
`contracts.test.ts`/`coverage-scope.test.ts` (loading TypeScript) already
carry their own suite-level `this.timeout(30_000)` for — "loading a tool,"
per `docs/dev/testing.md`'s own exemption line, not I/O this suite should be
mocking instead, since `Intl` cannot be mocked the way an HTTP boundary can.
Fixed the same way: `this.timeout(30_000)` on the outer
`describe("data/tablePropertiesModel", …)` block. `formatTimestamp` itself
does no I/O and stays millisecond-fast on every platform this failure did
not reproduce on.

`npm run verify` re-run green after all three fixes (1519 unit passing,
coverage unchanged: 95.48/95.43/95.15/95.48); `npm run test:integration`
green (334 passing — the CSP nonce test is new); `npx tsc --noEmit` (all
three configs) and `npx prettier --check`/`npm run lint` clean.

**Second review round, same push.** Codex's automated re-review, now against
the fix commit itself, raised one further **Major**: the deferred
"stuck-on-Loading…-forever-if-the-adapter-rejects" note this file's own
pre-PR write-up had accepted as a pre-existing, shared, cross-panel gap not
this slice's job to fix — reasonable in isolation, but a second reviewer,
seeing only this PR's own diff (not this file's own deferral reasoning),
correctly treated introducing *new* code that reproduces a known-bad UX
pattern as its own, in-scope defect, distinct from the separate question of
whether to *also* patch `dataViewerPanel.ts`'s identical pre-existing
instance. **Fixed, scoped to this slice's own file only**: `start()` now
wraps its `openTable`/`getColumns` calls in a `try`/`catch`; a caught
rejection renders `buildFailureHtml` (via the same `localiseDataProblem`
path, wrapped as a `{code: "compute", problem: {code: "compute-unreachable",
detail: messageOf(error)}}` — the identical shape `dataViewerPanel.ts`'s own
`ensureReadTarget` already produces for an unexpected throw) and then
rethrows, so the command handler's own `.catch`-and-log in `dataExplorer.ts`
still fires unchanged. `dataViewerPanel.ts`'s own identical gap is
**deliberately left untouched** — genuinely a different file, from an
earlier phase, and patching it was never this PR's own diff; if it needs
closing, that is its own small follow-up, not a silent scope-widening here.
A new integration test drives a raw `ComputeClient` whose `send` rejects
directly (the same shape a `resolveHref` throw would produce) and asserts
both the rendered failure text and that `manager.open(...)` itself still
rejects (so the caller's log line survives). `npm run verify` green (1519
unit passing, coverage unchanged — `tablePropertiesPanel.ts` stays
`.c8rc.json`-excluded); `npm run test:integration` green (335 passing, one
more new); `npx tsc --noEmit`/`npm run lint`/`npx prettier --check` all
clean.

**Post-merge fix — blank Properties/Columns panes, found in Sean's own
manual test pass** (`docs/dev/manual-test-pass.md` §13), 2026-09-10, against a
real panel: **Table Properties** opened with both tab labels showing, but
neither pane ever rendered any content — the panel looked entirely blank
regardless of which tab was selected. Root cause: `buildPropertiesHtml`
wrapped the two `<input type="radio">` tab controls (and their `<label>`s) in
their own `<div class="...tabs">`, one level of nesting deeper than the two
`#python-on-viya-pane-*` divs it was supposed to reveal. `panelHead`'s
tab-switch rule (`#tab-properties:checked ~ #pane-properties`) is a **general
sibling** combinator, which only matches elements sharing the *same parent* as
the checked input — nesting the input inside its own wrapper meant that
selector could never match either pane, so `.python-on-viya-table-properties-pane`'s
`display: none` default never lifted for anything. Confirmed live in a real
browser (Chromium, matching this panel's own webview renderer) before and
after the fix — the broken structure reproduces the exact blank-pane symptom,
and the fixed structure renders and tab-switches correctly. **Fixed**
(`src/data/tablePropertiesPanel.ts`): the two radio inputs, their labels, and
both pane `<div>`s are now all direct children of `<body>` — no wrapping
element between any checked input and the pane it targets. The wrapper's own
visual bottom-border (previously `.tabs`'s `border-bottom`) moved to a new,
purely decorative `.python-on-viya-table-properties-tabs-underline` div
inserted after the two label elements — it carries no `id`/`:checked` logic of
its own, so it cannot reintroduce the bug. A new integration test (`"keeps
both radio inputs as direct siblings of the panes they reveal, not nested in a
wrapper div"`, `test/integration/data/table-properties-panel.test.ts`) pins
the exact flat sibling order this relies on; confirmed by temporarily
reverting the source change alone that this test fails against the old,
buggy structure and passes against the fix. Existing tests did not catch this
because they only assert that expected text appears somewhere in the
generated HTML string — true both before and after the fix, since the broken
version still emits the right text, just inside a `display: none` pane. No
adapter, wire, or data-mapping change of any kind; this is a client-side
CSS/DOM defect only, so no Viya probe was needed. `npm run verify` green
(1538 unit passing, coverage 95.52% lines / 95.51% branches / 95.23% functions
/ 95.52% statements, thresholds unaffected — `tablePropertiesPanel.ts` stays
`.c8rc.json`-excluded); `npm run test:integration` green (338 passing, one
new); `npm run check:docs` green.

**Adversarial review before the PR exists**, 2026-09-11, against this
five-file diff (`STATUS.md`, `manual-test-pass.md`, this file,
`tablePropertiesPanel.ts`, and the new test). **No blocking findings** — the
root-cause analysis and fix were confirmed correct (the general-sibling
combinator reasoning, and that the flattened structure cannot reintroduce the
bug); the new test was confirmed to be a genuine structural regression pin
rather than a copy of the logic under test; no CSP, secret, or script-related
change of any kind in this diff, correctly requiring no probe. One non-blocking
note: `buildPropertiesHtml`'s doc comment is long for a now-simple flat
structure, accepted as justified given the subtlety of the bug it documents.

**Re-verified live, 2026-09-11 (Sean), against `verde`** with a `.vsix` built
from `fix/7c-ii-table-properties-blank-panes`: every §13 field on the
Properties tab matches (Name **CLASS**, Library **SASHELP**, Type **DATA**,
Label **Student Data**, Engine **V9**, Row Count **19**, Column Count **5**,
Created/Modified as real dates, Compression Routine **NO**, Encoding
**us-ascii ASCII (ANSI)**), and the section's remaining rows (Columns tab
switch, re-opening reveals the same panel, theme legibility, busy-session
message) all pass — §13 is now fully ticked in `manual-test-pass.md`.

**Also folded into this same branch, as a docs-only addition (Sean):**
`manual-test-pass.md` gained new §15/§16, Phase 6's own first live manual
pass (SAS Content browsing/mutations, and favourites/Recycle Bin) — out of
this project's normal "add a section when the phase closes" cadence, since
Phase 6→7/8 housekeeping (`HOUSEKEEPING.md`) has not yet run. Two open Phase 6
items surfaced (drag-and-drop is entirely non-functional; the
top-level-folder permanent-delete confirmation could not be exercised, no
permission on this deployment) — both left as-is here, since fixing or even
formally tracking them is that housekeeping's job, not this branch's.

☐ **7c-iii — CSV export.**

- ☑ Probe the CSV mechanism directly rather than porting upstream's literal
  `.../rows#CSV` URL suffix unexamined — **done, Finding 7.20** (2026-09-11,
  `verde`): `rowsAsCSV` is `Accept`-header content negotiation on the
  identical `rows` href, confirmed with a real `GET` returning genuine CSV
  text (not upstream's own accidentally-JSON fallback); `start`/`limit`
  pagination and `where=` are both honoured the same as the JSON `rows` link;
  default quoting is already RFC-4180-correct with no query parameter needed.
- ☑ Host-side only, no webview involvement — the panel's CSP
  (`default-src 'none'`, no `connect-src`) would block an in-webview
  `fetch` outright, and upstream's own download command bypasses its
  webview entirely too (a separate command, not a `DataViewer.ts` message).
  `vscode.window.showSaveDialog` + a paginated write to the chosen file,
  same shape as upstream's `LibraryModel.writeTableContentsToStream`.
- ☑ No shared helper with Phase 6's own download command — Phase 6 deferred
  all upload/download to Phase 11 and never built one (`STATUS.md`,
  2026-09-10), so this is standalone; revisit sharing if Phase 11 lands a
  local-disk-write helper later.

  **7c-iii is code-complete 2026-09-11** (`sas-py-vscode-cowork` clone) —
  live-probed first (Finding 7.20, above): the real `rowsAsCSV` mechanism,
  `start`/`limit` pagination, `where=`, and already-correct default quoting,
  plus the byte-exact page-boundary behaviour (`\n`-only line endings, no
  separator needed between pages) that makes a naive page-by-page relay
  correct. `LibraryAdapter.getRowsAsCsv` (`src/data/adapter.ts`) follows the
  new `ROWS_AS_CSV_REL` link; a new, `vscode`-free
  `src/data/csvExportModel.ts` (`exportTableToCsv`) relays each page's raw
  CSV text straight through with no client-side re-serialization — a
  deliberate improvement on upstream's own `LibraryModel.
  writeTableContentsToStream`, which never actually reaches a CSV response
  at all (Finding 7.20's own account of why) and re-quotes every field
  unconditionally instead of relying on the server's already-correct
  RFC-4180 output. The loop is deliberately unbounded (no `MAX_DATA_PAGES`-
  style page cap): a hard ceiling here would silently truncate a real user's
  large export, the opposite of what streaming exists to prevent.

  A new `src/data/csvExportCommand.ts` (`vscode`-facing, `.c8rc.json`-
  excluded) wires `pythonOnViya.exportTableToCsv` — a `showSaveDialog`, a
  cancellable progress notification, and a streaming `fs.createWriteStream`
  write. **Sean's own call, in review**: a cancelled or failed export
  deletes its own partial output file (upstream leaves a silently truncated
  one behind), and a pre-flight check (`ensureDiskSpace`) samples a small
  first page, projects a rough total from it and the table's own `rowCount`,
  and refuses to start if the destination volume's free space
  (`fs.promises.statfs`) does not clear the estimate by a 20% safety margin
  — better to say so up front than run out of disk space mid-export. This
  is a safety margin, not a guarantee either way (a table whose later rows
  run wider than the sample can still run out); the ordinary per-write
  failure path, unconditionally, is what actually catches that. A new
  `DataProblem` variant, `insufficient-disk-space` (`src/data/problems.ts`,
  `src/data/messages.ts`), carries the estimated/available byte counts
  through this project's usual describe/localise split.

  **A genuine architecture decision, flagged and confirmed with Sean before
  writing the code**: local disk streaming writes have no browser-host
  equivalent in this codebase's reach — `vscode.workspace.fs.writeFile`
  only ever writes one complete buffer, so a large table would have to be
  held in memory in full first, defeating the reason this feature streams
  at all. `src/data/csvExportCommand.ts` is therefore the **fifth** file on
  [ADR-0003](../adr/0003-extension-host-target.md)'s Node-built-ins
  allow-list (`node:fs`, `node:path`), alongside `caAgent.ts` — see that
  ADR's own 2026-09-11 amendment for the full reasoning, including why this
  is a different shape of exception than `caAgent.ts`'s own (a
  correctness/scalability rejection of a nominally-available web-host path,
  not a capability the web host forbids outright). `csvExportModel.ts`
  itself stays free of any Node built-in — only the one file that actually
  touches the filesystem widens the allow-list.

  `npm run verify` green (1551 unit passing; coverage 95.56% lines / 95.51%
  branches / 95.25% functions / 95.56% statements, every threshold met);
  `npm run test:integration` green (344 passing, 5 new —
  `test/integration/data/csv-export-command.test.ts`); `npm run check:docs`/
  `l10n:extract`/`build`/`check:copyright`/`check:secrets`/
  `check:coverage-scope`/`check:contracts` all clean.

  **Adversarial pass (independent agent) ran before any push, per
  `CLAUDE.md`'s standing rule** — three real, Medium-severity findings, all
  fixed on the branch before it went anywhere:

  1. **An existing file at the chosen destination was destroyed even when
     the export never wrote a single row** — `fs.createWriteStream` truncates
     on open, and a failure right after (an expired session, an
     `insufficient-disk-space` refusal) then `unlink`ed that same path in
     cleanup, so a user who picked an existing file as the destination lost
     it regardless of whether anything new was ever written. **Fixed** by
     writing to a `<destination>.<randomUUID()>.tmp` file the whole time and
     `fs.promises.rename`-ing it onto the real destination only once
     {@link exportTableToCsv} returns success — atomic on the same directory,
     so there is no window where the destination is a half-written file, and
     a failed or cancelled run's cleanup only ever removes its own temporary
     file. This subsumes the module's own earlier "deletes its own partial
     output file" framing, which did not account for what was already there.
  2. **`createWriteStream`/`stream.once("error", ...)` sat before the `try`
     block**, so a (low-probability, but real) synchronous throw from opening
     the stream skipped `bridge.dispose()` (the exact `CancellationLike`
     leak `cancellation.ts`'s own doc comment warns about) and reached only
     `dataExplorer.ts`'s own `.catch`, which logs but never shows the user
     anything — silently different from every other failure path this
     feature has. **Fixed** by moving stream creation inside the `try`, so
     it now reports through the same `catch` as everything else.
  3. **No test exercised the stream-error path at all** — `fakeStream()`'s
     own comment admitted "no real stream in this fake ever emits error",
     leaving `runCsvExport`'s `streamError`/cleanup handling for a genuine
     disk failure (`ENOSPC` mid-write) completely unverified. **Fixed**: a
     new `fakeStream({ errorDuringEnd })` option fires the registered
     `"error"` listener during `end()`, simulating a failure that surfaces
     only once the stream's internal buffer is finally flushed — after every
     `write` callback already resolved cleanly — which is exactly the gap a
     second, post-flush `streamError` check (added alongside this fix) now
     closes; a new test drives it end to end (routes fetch and write
     cleanly, then the flush itself fails) and asserts the temp file is
     cleaned up and the failure is reported.

  `crypto.randomUUID()` (not `Math.random()`, which `eslint.config.mjs`
  already bans project-wide for exactly this reason) names the temporary
  file, so `csvExportCommand.ts`'s own allow-list entry now reads `node:fs`,
  `node:path`, `node:crypto` — ADR-0003's amendment updated to match. `npm
  run verify`/`test:integration` re-run green after all three fixes (1551
  unit unchanged; 345 integration passing, one net new); `check:docs` clean.

  **Sean's own review** (per this project's actual standing requirement —
  the independent-agent pass above is a complement, not a substitute) found
  no blocking issues: "careful, well-documented... error handling is sound...
  no swallowing catches... the atomic temp-then-rename guarantees no
  truncated destination." Three minor, non-blocking notes, two folded in at
  Sean's discretion (cheap and strictly better, no back-and-forth needed):

  - **No test exercised a `write`'s own callback failing directly** (as
    opposed to the delayed, end-of-flush failure the review above already
    added a test for) — a distinct, more ordinary failure shape. **Fixed**:
    a second `fakeStream` option (`errorOnWrite`) answers a chosen write
    with its error directly, and a new test drives it (a first write
    succeeds, a second fails mid-export, no third page is ever requested).
  - **The temporary file was created before `openTable`/`ensureDiskSpace`
    ran**, so a table that failed to open, or an export refused for
    insufficient disk space, still left a fleeting empty temporary file to
    clean up. **Fixed**: `createWriteStream` now runs only once both checks
    have passed, immediately before the real export starts — an early
    failure now touches the filesystem not at all, not even briefly. This
    needed its own small correctness fix alongside the reorder: the
    `finally` block's cleanup previously assumed a temporary file always
    existed by the time any failure could occur (true before this reorder);
    a new `tempFileCreated` flag gates the cleanup `unlink` now, so a
    failure that never got as far as creating a stream does not try to
    remove a file that was never made.
  - A third note (a stream that already errored is still handed to `end()`
    in `finally`) was checked and confirmed harmless — a destroyed Node
    stream's `end()` still invokes its callback rather than hanging — and
    left as-is, per Sean's own call.

  `npm run verify`/`test:integration` re-run green after folding both fixes
  in (1551 unit unchanged; 346 integration passing, one further net new);
  `check:docs`/lint/typecheck all clean.
- ~~☐ Add `font-src` to the data viewer panel's CSP~~ — **fixed in 7b
  instead of deferred here**, 2026-09-10 (see 7b's Runbook entry above for
  the full account). Nothing left for 7c to pick up on this; the same
  `buildHtml` doc comment's still-open `img-src` question is worth
  resolving whenever 7c actually exercises an ag-grid icon, in case the
  SVG-icon path needs it too.
- ☑ Hide `pythonOnViya.openTable` from the global Command Palette —
  `package.json`'s `commandPalette` array gives the four analogous content
  commands (`createContentFolder`/`createContentFile`/`renameContentItem`/
  `deleteContentItem`) a `"when": "false"` entry each, but `openTable` had
  none, so it was reachable from Ctrl+Shift+P where it silently no-ops (no
  tree item to act on — `dataExplorer.ts`'s handler returns early). Real,
  non-blocking finding from PR #150's final review round, 2026-09-10;
  deferred rather than fixed on that PR (Sean's call). **Fixed** 2026-09-10,
  from the `sas-py-vscode-cowork` clone: a fifth `commandPalette` entry,
  `{ "command": "pythonOnViya.openTable", "when": "false" }`, added
  alongside the four content commands' own.
- ☑ Remove the dead `data-title` attribute from the data viewer's HTML
  shell (`buildHtml`, `src/data/dataViewerPanel.ts`) — nothing in
  `dataViewerEntry.tsx` reads `#root`'s `dataset.title`; the panel title
  only ever flows through the `WebviewPanel`'s own `title` param. Real,
  non-blocking finding from PR #150's final review round, 2026-09-10;
  deferred rather than fixed on that PR (Sean's call). **Fixed** 2026-09-10:
  the attribute, its `escapeHtmlAttribute` helper (its only caller), and
  `buildHtml`'s now-unused `table`/`title` locals and parameter all removed
  together — nothing else in the file read any of them.
- ☑ Add a JSX test case for `check-coverage-scope.mjs`'s `scriptKindFor` —
  the `.tsx`/`ts.ScriptKind.TSX` handling it added for this slice has no
  test exercising actual JSX syntax, only `.tsx` files that happen not to
  contain any. Real, non-blocking finding from PR #150's final review
  round, 2026-09-10; deferred rather than fixed on that PR (Sean's call).
  **Fixed** 2026-09-10: two new cases in `test/unit/coverage-scope.test.ts`
  feed `importsHostModule` a `.tsx` fileName with a real, ag-grid-shaped
  self-closing JSX element (string, expression, and bare-boolean
  attributes, mirroring `dataViewerEntry.tsx`'s own `<AgGridReact>` usage) —
  one with a runtime `vscode` import, one without. Investigated first
  whether either direction could be made to flip a wrong answer if
  `scriptKindFor` regressed to always returning `ts.ScriptKind.TS`: tried
  several representative shapes (a bare-`<T>` generic arrow, a
  multi-attribute self-closing tag, JSX before and after the import) against
  both script kinds directly via `ts.createSourceFile`, and none disagreed —
  TypeScript's parser resyncs cleanly at the unambiguous `import` keyword
  regardless of script kind for every case built from realistic, syntactically
  complete JSX, so this specific check (top-level import-declaration
  detection only) turns out not to depend on getting `ScriptKind.TSX` right
  for any well-formed input. The two cases still close the literal gap
  (no test previously fed real JSX through this function at all) and lock in
  the correct answer for this project's actual `.tsx` shape.

  These three were picked up together as a small, pre-7c batch closing out
  PR #150's deferred findings, not as the start of 7c proper (none of the
  four items above are touched). `npx tsc --noEmit` / `-p tsconfig.test.json`,
  `npx prettier --check` (the four touched files), `npm run lint`, and
  `npm run check:coverage-scope` all clean; `npm run test:unit` green (1443
  passing, up from 1441 with the two new cases) and `npm run test:integration`
  green (305 passing, unchanged — `buildHtml`'s signature change needed no
  test update, since no integration test asserted the removed parameter or
  attribute); `npm run coverage` green (95.29% lines / 95.37% branches /
  94.95% functions / 95.29% statements, every threshold met); `npm run build`
  clean across all three esbuild contexts; `check:copyright`/`check:secrets`/
  `check:contracts` all clean. **Adversarial review before any push** (per
  `CLAUDE.md`'s standing rule) found no blocking issues — confirmed
  `buildHtml`'s 3-to-2-param signature change dropped nothing (its one caller
  updated correctly, no test asserted the removed attribute or parameter,
  `escapeHtmlAttribute`'s removal reopens no XSS surface since every
  remaining interpolation is either regex-validated or a UUID/URI), and the
  new `package.json` entry is well-formed and consistent with the other four.
  One real, non-blocking finding: the in-file comment ahead of the two JSX
  cases overstated what they prove — reading as if they would catch a
  `scriptKindFor` regression, when (as this same punch-list item's own
  account above already found) no realistic well-formed JSX makes this
  particular check's answer depend on the script kind. **Fixed** — the
  comment now says plainly that these two cases close the literal test-input
  gap without being a regression guard, matching this document's own
  candor. `npx tsc -p tsconfig.test.json --noEmit`, `npx prettier --check`,
  and `npm run test:unit` (1443 passing, unchanged) all clean after the fix.

☑ **7d — Document, probe, and snippet-ize Python↔library data exchange.**
Scoped 2026-09-04, resurrected and live-probed 2026-09-10 after sitting
unmerged in a stash — see the Plan section's 7d entry for the full account.

- ☑ A live probe against `SASHELP.CLASS` exercising `SAS.sd2df`, `SAS.df2sd`,
  and `SAS.submit` from inside a real `PROC PYTHON` job on this project's
  own execution path. **Done** — Finding 7.11 (2026-09-10, `verde`): all
  three completed successfully in one job (`sd2df` shape `(19, 5)`, `df2sd`
  into `work`, `submit` ran without error).
- ☑ Settle the log-echo question: does `SAS.submit()`'s SQL/DDL text, or a
  credential passed through it, appear in the job log the way Finding 92
  (Phase 8) found for an inline `CASTOKEN` literal? **Done** — Finding 7.12
  (2026-09-10, `verde`): a `LIBNAME` statement assembled from a
  runtime-built string and executed via `SAS.submit()` was logged with SAS's
  standard `password=XXXXXXXXXXXXXXXXXXXXXXXXX` masking, not the resolved
  value — the stash's speculative "worse than Finding 92" risk does not
  hold for this mechanism specifically. Finding 92's own mechanism (the
  outer job-source echo reproducing submitted Python verbatim) is untouched
  and still applies to a credential written as a literal, regardless of
  `SAS.submit()`.
- ☑ Write the documented example (`docs/data-access.md` or folded into
  7a/7b's own docs) — the `SAS.sd2df`/`PROC SQL`-pass-through pattern above,
  and an explicit warning against writing a credential literal anywhere in
  submitted Python. **Done** — a new top-level `docs/data-access.md`
  ("Python and SAS libraries"), registered in `.vitepress/config.mjs`'s
  sidebar and `docs/README.md`'s index (neither 7a/7b/7c ever added a
  user-facing doc page of their own to fold this into, so the new-file
  branch of this bullet applies). Covers `SAS.sd2df`/`SAS.df2sd`, the
  `PROC SQL` pass-through pattern, the drag-and-drop feature below, and the
  credential-literal warning Finding 7.12 settles.
- ☑ Wire the drag-and-drop snippet (`SAS.sd2df("libref.table")`) the Plan
  section's discussion resolves — 7a's tree now exists, so this is
  unblocked. **Done** — `src/data/dataDragAndDrop.ts`/`dragSnippet.ts`; see
  this slice's own Runbook entry below for the design (Sean's own call on
  both of the Plan section's open questions, and the escaping this needed).
- ☑ A small fixture set for the log-echo probe's own confirmed shape — no
  `DataAccessApi` involved, so no dependency on 7a–7c's own fixtures.
  **Done** — `test/fixtures/data/submit-log-echo.txt`, a verbatim
  transcription of Finding 7.12's own already-sanitized log excerpt (not a
  captured wire JSON envelope — this mechanism has no wire call to capture),
  pinned by `test/unit/data-submit-log-echo.test.ts`.

**7d is code-complete 2026-09-11** (`sas-py-vscode-cowork` clone). Two design
questions the Plan section explicitly left open for whoever wrote the drag
handler were put to Sean rather than assumed: **the choice on drop** — a
quick pick between a plain `SAS.sd2df(...)` read and a `SAS.submit`-based
`PROC SQL` pass-through, Sean's call, over always inserting the plain read —
and **the variable-name heuristic** — the table's own name sanitized to a
Python identifier and suffixed `_df` (`CLASS` → `class_df`), deduplicated
against the drop target document's own text (`class_df`, `class_df2`, …),
Sean's call over a fixed generic name. `src/data/dragSnippet.ts`
(`vscode`-free, unit-tested) derives the variable/view names and builds both
snippet bodies; `src/data/dataDragAndDrop.ts` is the one class playing both
`vscode` roles this needs — `TreeDragAndDropController` (putting the dragged
`TableItem` on a private MIME) and `DocumentDropEditProvider` (registered for
`{ language: "python" }`), mirroring upstream's own `LibraryDataProvider`
shape rather than this project's own 6c-ii split, since a content move never
leaves the tree but this drop always does. Only the first dragged table is
handled, matching upstream's own restriction (7a's tree has no
`canSelectMany`). `libref`/`table` — wire-provided text with no length or
character restriction this project controls, unlike the self-sanitized
variable/view names — are escaped twice before landing in either snippet:
once for the Python string-literal context, and, for the SQL pass-through
only, once more for the VS Code snippet grammar the whole result is parsed
as (`$`/`}`/backslash are snippet metacharacters); the plain `sd2df` snippet
is returned as an unparsed string, needing only the first layer. The SQL
pass-through mirrors its view-name tabstop (`${1:...}`/`$1`) across both the
`create view` step and the `sd2df` read, so retyping it once updates both.

**Adversarial pass (independent agent) ran before any push, per
`CLAUDE.md`'s standing rule** — one real, blocking finding and two related
Medium ones, all fixed on the branch before it went anywhere:

1. **The SQL pass-through's own `select * from libref.table` line had no
   protection against a `;` in the table name** — the two escaping layers
   above protect the *Python* and *snippet* boundaries the text passes
   through, but neither stops a semicolon (plausible for exactly the
   SAS/ACCESS external-table case this snippet is written for) from closing
   the generated `create view` statement early and letting the rest run as
   independent SAS statements the moment the inserted snippet is run
   unmodified. **Fixed**: a third layer, `sasNameRef` (`dragSnippet.ts`),
   wraps a name outside the ordinary bare-identifier shape in a SAS name
   literal (`'…'n`) before either escaping layer runs — everything between
   the quotes is one atomic name token to the SAS tokenizer, embedded
   `;`/whitespace/`&`/`%` included — applied only to the SQL pass-through's
   own generated SAS source, not to `buildSd2dfSnippet`'s `libref.table`
   argument, which is a runtime string handed to `SAS.sd2df` rather than SAS
   source this project generates and hands to the interpreter itself. Two
   new unit tests pin this directly (a `;`-bearing table name, and an
   embedded `'` doubling correctly).
2. **The drop's own `CancellationToken` never reached the quick pick** —
   `vscode.window.showQuickPick` takes an optional token specifically so an
   external cancellation dismisses the picker, but neither the real call nor
   `DataDragAndDropDeps.showQuickPick`'s own type threaded it through, so a
   drop cancelled elsewhere left the picker lingering. **Fixed**: the token
   now flows into `showChoice` and both the real and injected
   `showQuickPick` calls; a new integration test asserts the injected stub
   receives the exact same token instance.
3. **An already-cancelled drop still showed the quick pick before discarding
   the answer** — cancellation was checked only after `showChoice` resolved.
   **Fixed**: checked before calling `showChoice` too, via a `cancelled()`
   closure (matching `contentDragAndDrop.ts`'s own idiom) rather than two
   direct `token.isCancellationRequested` reads — the latter trips a
   TypeScript narrowing false-positive across the intervening `await`, the
   same class of gotcha `contentDragAndDrop.ts`'s own closure already
   avoids. A strengthened integration test now asserts the quick pick is
   never shown in this case.

`npm run verify` green (1567 unit passing; coverage
95.6%/95.5%/95.35%/95.6%, every threshold met — `dragSnippet.ts` itself
99.45%/95%/100%/99.45%, the one remaining branch gap a `for (;;)` loop
construct c8 cannot fully instrument, not a missing case); `npm run
test:integration` green (355 passing, 9 new); `check:docs` (all four steps,
including `docs:build`) green after adding `docs/data-access.md`;
`check:coverage-scope`/`check:contracts`/`check:copyright`/`check:secrets`
all clean. (`check:secrets` also caught a real false-positive of its own
making, worth recording: a doc comment's `` `PASSWORD=` `` markdown code-span
read as a quoted credential-literal assignment to the scanner's own
`assigned-literal` rule; reworded to drop the backtick immediately after
`=` rather than suppressed, since the simpler fix was to stop tripping the
heuristic at all.)

**[PR #163](https://github.com/Shai-Alit/sas-py-vscode/pull/163) opened
2026-09-11.** Sean's own live test against an installed build then found the
drop broken in a way no tier here could have caught: the drag engaged, the
quick pick appeared with the right title, and choosing *either* option
inserted nothing at all — no error, no output-channel line, the picker simply
closed. The failure was visible only in the DevTools console, as the same
`TypeError: Cannot read properties of undefined (reading 'toLowerCase')`
printed twice per drop.

**Root cause — a tree→editor drop crosses the extension-host RPC boundary,
and VS Code serializes the payload on the way.** Traced through VS Code
1.109's own source rather than guessed at:

1. `dropIntoEditorController.ts:163`/`:165` are the two `console.error(err)`
   calls in `getDropEdits`'s catch block — hence the doubled log line. A throw
   out of `provideDocumentDropEdits` is **swallowed**: no edits are returned
   and the drop is a silent no-op, which is why nothing surfaced anywhere a
   user or the extension's own logging would see it.
2. `extHostTypes.ts:1672-1674` — `DataTransferItem.asString()` returns
   `JSON.stringify(this.value)` for a non-string value.
3. `extHostTypeConverters.ts:2206` — the drop side rebuilds the item as
   `new types.InternalDataTransferItem(item.asString)`, so `value` arrives as
   the JSON **string**, not the `TableItem[]` `handleDrag` set.

The slice had cast it (`dataTransfer.get(TABLE_MIME)?.value as TableItem[]`),
which made `payload[0]` the single character `"["`. That is truthy, so the
`table === undefined` guard passed; every field then read `undefined`, the
quick pick rendered its title as `Insert "undefined.undefined" into Python
as…`, and `deriveVariableName(undefined)` hit `raw.toLowerCase()` at
`dragSnippet.ts:56`. Upstream's own `ContentDataProvider` parses at the
identical point for the identical reason
(`JSON.parse(dataTransferItem.value)[0]`) — the reference implementation had
the answer all along, and the cast is what this slice wrote instead.

**Fixed** by routing the payload through a new `readDraggedTables` /
`readDraggedTable` pair in `src/data/types.ts` rather than parsing inline:
`types.ts` is `vscode`-free and therefore unit-testable, whereas
`dataDragAndDrop.ts` is coverage-excluded (`.c8rc.json`), so inline parsing
would have shipped the boundary untested a second time. Each entry is
validated rather than cast, malformed JSON yields no tables rather than
throwing (a throw here is swallowed anyway, so it would reproduce the same
silent no-op with less to read afterwards), and an already-parsed array is
accepted too — which of the two forms a `DataTransferItem` holds is VS Code's
own call and differs by drop target, so a reader that works either way cannot
be broken by that choice changing. Six new unit tests, the first of them a
round-trip regression pin that stringifies a real `TableItem[]` and asserts it
reads back. **Re-tested live by Sean the same day: the drag, both snippet
choices, and the inserted code all work** (`manual-test-pass.md` §17).

**This is the one respect in which a tree→editor drop differs from
`contentDragAndDrop.ts`'s tree→tree drop**, and the difference is worth
stating explicitly because the two look identical in the API: for a *same-view*
drop, `extHostTreeViews.ts:193-195` calls `_addAdditionalTransferItems`, which
re-runs `handleDrag` **locally** in the extension host — so Phase 6 genuinely
does get the live objects back, and its `Array.isArray(payload)` check is
correct and must not be "fixed" into a parse.

**A second, unrelated root cause was found in Phase 6's own drop while
confirming that** — `handleDrop`'s `CancellationToken` does not survive the
RPC hop, so `src/content/contentDragAndDrop.ts:203` throws before doing any
work. It is recorded in `phase-6.md` rather than duplicated here, since it is
that phase's defect and its fix belongs on that phase's branch; nothing in 7d
depends on it. Noted here only because the two were diagnosed together and the
shared theme — VS Code's drag-and-drop RPC boundary loses things that the
declared API types promise will be there — is what made each easier to find
once the other was understood.

**Reconciled with `main` 2026-09-11** (merge `30771e8`), picking up Phase 6's
6e merge ([PR #162](https://github.com/Shai-Alit/sas-py-vscode/pull/162),
squash `a74f756`) and two docs-only follow-ups. One conflict, both halves of
`STATUS.md`'s phase-index table, resolved by taking `main`'s Phase 6 row
wholesale and `main`'s Phase 7 row with this slice's own 7d tail. The merge is
pure additions against `main` in `src/` and `test/` — nothing from 6e was lost,
and this branch has never touched `src/content/`.

`npm run verify` re-run green after the fix and the merge (1574 unit passing;
coverage 95.62%/95.54%/95.38%/95.62%, `src/data/types.ts` itself at 100% on
all four); `npm run test:integration` green (372 passing).

---

## Probe findings

All probes below ran 2026-09-03 against `verde` (Viya 4), via the
`viya-api-probe` skill, after an initial attempt this same session failed at
the network layer (every `CONNECT` through the sandbox's egress proxy to
`verde` came back `502 Bad Gateway`, while a public host tunnelled fine
through the same proxy) — a VPN outage on the deployment side, confirmed
resolved once retried. One throwaway compute session was created (`SAS
Studio compute context`) to run the mutating parts of this list and deleted
at the end, confirmed gone by a `404` read-back. Findings in this phase are
numbered independently as `7.x`, per the phase-scoped numbering scheme
adopted 2026-09-09 (`STATUS.md`, repo-root `CLAUDE.md`) — this probe session
predates that change and originally continued the project's old global
sequence from Finding 82 (`phase-6.md`); renumbered `7.1` onward below as
part of that switch.

**Finding 7.1 — the core `DataAccessApi` read shapes are exactly what the
generated client and `RestLibraryAdapter.ts` claim, on this deployment.**
**Superseded in part by Finding 7.5, below: `…/data/{libref}#summary` and
`…/data/{libref}#tables` are not real, requestable paths — see Finding 7.5
for the corrected `Accept`-header content-negotiation mechanism. The rest of
this finding (the field shapes themselves) stands.**
`GET /compute/sessions/{id}/data` (libraries), `…/data/{libref}` with the
default `library+json` media type (per-library `readOnly`/engine detail — the
rich representation, not the `summary` one; see Finding 7.5), `…/data/{libref}`
with the tables media type (tables in a libref), `…/data/{libref}/{tableName}`
(table info), `…/{tableName}/columns`,
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

**Finding 7.2 — the plain `getLibraries`/`getTables` collections carry no
per-item detail; the `readOnly`/size fields only appear on the singular
per-item detail `GET`, not on the list.** **Superseded in part by Finding 7.5,
below: the `#summary` notation is not a real path — the per-item detail comes
from the *default* `library+json` representation, reached by `Accept`-header
content negotiation on the *same* bare URI (the `summary` media type is
actually the *sparse* one; see Finding 7.5), not from a separate
`#summary`-suffixed resource. The practical conclusion — the list is sparse, a
per-item follow-up is needed — stands; the mechanism described here does not.** The
default `GET …/data` and the tables-media-type read on `…/data/{libref}`
responses return `type: null`, `rowCount: null`, `columnCount: null` on every
item, exactly matching upstream's own two-tier fetch (list, then a per-item
`getLibrarySummary`/`getTable` for the fields the UI actually needs) — not a
gap in the probe, a confirmed reason `RestLibraryAdapter.getLibraries` makes
one follow-up request per library. Measured directly (via the bare
`…/data/{libref}` URI with the default `library+json` `Accept` — the rich
representation; the `summary` media type is the sparse one, and the
`#summary`-suffixed URL notation an earlier draft of this sentence showed was
never what curl actually requested, since it silently strips the `#…` fragment
before the wire, per Finding 7.5): `GET …/data/WORK` → `readOnly: false`;
`GET …/data/SASHELP` → `readOnly: true`, `concatenationCount: 4` (four physical
paths concatenated into one libref) — confirms the read-only/writable
distinction the tree's icon and context-menu gating depend on is real and
populated, not merely documented.

**Finding 7.3 — a `DataAccessApi` call blocks behind a running job in the same
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

**Finding 7.4 — the session `state` endpoint needs its own media type, not a
bare `Accept: application/json`.** **Superseded by Finding 7.5, below: on
re-probe, the specific media type did *not* return cleanly-parseable JSON
either — both `Accept` values return the identical bare `text/plain` word.
Treat this endpoint as always plain text regardless of `Accept`, not as
media-type-sensitive.** `GET /compute/sessions/{id}/state` with a
generic `Accept` returned a bare unquoted word (`idle`) that broke `jq`
parsing; requesting `Accept: application/vnd.sas.compute.session.state+json`
returned the same content cleanly. Incidental — not part of this phase's own
wire surface — but worth a one-line note for whoever next writes a session
probe from scratch, the same way Finding 14 already exists for a different
Compute media-type trap.

**Not probed this session, left open:** a second Viya 4 cadence/deployment
(the dialect-risk item above); whether a *second* `DataAccessApi` call queues
the same way a job does (Finding 7.3's own open question); the `createView`
sort round trip and its cleanup-on-failure behaviour (a mutating probe,
deliberately out of scope for this pass); and the CSV (`rowsAsCSV`) and
`promptContent` relations `getTable`'s link set surfaced but
`RestLibraryAdapter.ts` reaches by composed URL rather than by link. All are
7a/7c implementation-time probes, not settled here.

**Finding 7.5 — re-probe against `verde`, 2026-09-09 (no second deployment was
available this session — see below): Finding 7.3 reconfirmed as measured;
Finding 7.4 does not reproduce as stated; Findings 7.1/7.2's mechanism was
wrong, though their practical conclusion holds.** Run via `viya-api-probe`
against a fresh throwaway `SAS Studio compute context` session (created and
deleted per-check below; each read back `404` after its `DELETE`). This
re-probe continues phase 7's own `7.x` numbering (from `7.4`); it originally
continued the project's old global sequence from Finding 94 (`phase-5.md`)
before the 2026-09-09 renumbering.

- **Finding 7.3 — reconfirmed, same magnitude.** Idle baseline `GET
  …/data/SASHELP/CLASS/rows?start=0&limit=2` → **0.547s**. Immediately after
  submitting `data _null_; x=sleep(15,1); run;` (async, no wait), the
  identical call → **15.003s** — again a wait matching the job's own sleep
  almost exactly, not a fast race or an error. The blocking-not-erroring
  behaviour this phase's busy-submission UI design depends on is stable
  across sessions on this deployment.
- **Finding 7.4 — does not reproduce; corrected.** Today, `GET
  …/sessions/{id}/state` returned **`Content-Type: text/plain;charset=UTF-8`**
  with the bare unquoted body `idle` for **both** a generic `Accept:
  application/json` **and** the specific
  `Accept: application/vnd.sas.compute.session.state+json` — neither parses
  as JSON (`jq` fails identically on both). The original finding's claim that
  the specific media type "returned the same content cleanly" (i.e.
  JSON-parseable) did not hold this time; both requests behave identically,
  and neither is JSON. Treat the session-state endpoint as **always** a bare
  text/plain state word regardless of `Accept`, not as a media-type-sensitive
  endpoint — a stronger and simpler statement than Finding 7.4 made, and the
  one to design against.
- **Findings 7.1/7.2 — the mechanism they describe does not exist; the
  practical conclusion they drew is still correct.** `{libref}#summary` and
  `{libref}#tables` are not real URL path segments. Directly confirmed:
  requesting the properly percent-encoded path
  `…/data/WORK%23summary` returns **HTTP 400**, `errorCode 5334`, "The
  library name included in the path is invalid. It contains too many
  characters" — the server parsed the literal string `WORK#summary` as an
  (invalid, >8-char) libref, meaning no such suffixed resource exists to
  request in the first place. (The original probe's `#summary`/`#tables`
  writing almost certainly reflects curl silently stripping an unencoded
  `#…` as a URL fragment before sending, landing on the **bare** `…/data/{libref}`
  URL by accident and getting the rich response from a plain GET — not from
  a `#summary` resource that was never actually requested.)

  **The real mechanism is `Accept`-header content negotiation on the same
  bare URI**, and it inverts which media type is "rich" versus "sparse" from
  what Finding 7.2's naming implied:
  - `GET …/data/WORK` with the default/bare `Accept` (equivalently,
    explicit `Accept: application/vnd.sas.compute.library+json`) returns the
    **rich** shape — `readOnly`, `concatenationCount`, `engineName`,
    `physicalName`, `fileFormat`, `links`, etc. Reconfirmed unchanged:
    `WORK` → `readOnly: false, concatenationCount: 0`; `SASHELP` →
    `readOnly: true, concatenationCount: 4` — same numbers Finding 7.2
    measured, just obtained by the correct request.
  - `GET …/data/WORK` with `Accept: application/vnd.sas.compute.library.summary+json`
    on the **identical URI** returns the **sparse** shape (`id`, `name`,
    `links`, `version` only, everything else absent) — "summary" is the lean
    representation, not the detailed one; this is the reverse of what the
    word suggested and the reverse of how Finding 7.2 characterized it.
  - The plain collection `GET …/data` (all libraries) already negotiates to
    this same sparse per-item media type by default — its own envelope says
    `"accept":"application/vnd.sas.compute.library.summary"`. That is *why*
    list items arrive with `type`/`rowCount`/`readOnly` absent: it's the
    collection's default per-item media type being the sparse one, not a
    separate "list truncates fields" behaviour.
  - Tables-in-a-library ("`#tables`") work the same way: `GET
    …/data/WORK` with `Accept:
    application/vnd.sas.collection+json;itemtype=application/vnd.sas.compute.data.table.summary`
    on the **same bare library URI** returns the tables collection (`count:
    0, items: []` for empty `WORK` in a fresh session) — again
    content-negotiated on one URI, not a second URL.
  - The bare library response's own `links[]` already carries this as data:
    a `rel:"self"` entry (`type: application/vnd.sas.compute.library`) and a
    `rel:"tables"` entry (`itemType:
    application/vnd.sas.compute.data.table.summary`, `type:
    application/vnd.sas.collection`) both pointing at the **same href** —
    the link set is telling the client which `Accept` to send, not which
    URL to build.

  **Implementation consequence for 7a:** a `LibraryAdapter`'s per-item
  detail follow-up must be built as an `Accept`-header request against the
  same URI the list item's own link already names — exactly the
  link-following discipline `src/wire/links.ts` already applies elsewhere
  in this project (promoted there from `src/compute/links.ts` in 6a-i,
  ADR-0025, merged before this branch), and the same discipline Finding 7.1
  already flagged as worth adopting here. **Composing a `#summary`/`#tables`-suffixed URL by
  hand, the way the original finding's wording could be read to suggest,
  would not work at all** (confirmed: 400, not merely suboptimal) — this is
  a correctness-affecting correction, not a style note.

**Finding 7.6 — second deployment (`Innov`), 2026-09-09: every part of
Finding 7.5 reproduces identically; the dialect-risk item for these endpoints
is closed.** Sean added an `innov` section (deployment `Innov`) to
`creds.json` after the Finding 7.5 checkpoint. Re-ran the same probe set via
`viya-api-probe` against a fresh throwaway `SAS Studio compute context`
session on `Innov` (created and deleted; `404` read-back confirmed):

- Session-state endpoint: `text/plain;charset=UTF-8` with a bare unquoted
  word for **both** generic and specific `Accept`, exactly as Finding 7.5
  corrected. The word itself differed — `pending` rather than `idle` — but
  that's the state of a just-created session at the instant checked, not a
  media-type or version difference; both requests still agree with each
  other, which is the property that matters.
- `GET …/data` (library list): sparse per-item shape, envelope reports
  `"accept": "application/vnd.sas.compute.library.summary"`, identical to
  `verde`.
- Bare `GET …/data/WORK` with default/`library+json` `Accept` → rich detail
  (`readOnly: false, concatenationCount: 0, engineName: "V9"`). Same URI
  with `Accept: application/vnd.sas.compute.library.summary+json` → sparse
  (`id`/`name`/`links`/`version` only). Same URI with
  `Accept: application/vnd.sas.collection+json;itemtype=…table.summary` →
  tables collection (empty, fresh `WORK`). All three exactly reproduce the
  content-negotiation mechanism Finding 7.5 established on `verde` — this
  was the main thing worth re-confirming on a second deployment, and it did.
- `SASHELP` → `readOnly: true, concatenationCount: 4`, same values as
  `verde`.
- The literal percent-encoded `WORK%23summary` path → **HTTP 400**,
  `errorCode 5334`, same message, confirming the "`#summary` is not a real
  path segment" conclusion isn't a `verde`-specific quirk.
- Finding 7.3 (busy-blocking): idle baseline **0.452s**; immediately after
  submitting the same 15s sleep job, the identical `getRows` call →
  **15.039s**. Same magnitude and shape as both `verde` runs.

**Finding 7.7 — second-cadence probe, 2026-09-09: `verde` and `Innov` are not
just two deployments, they are two different Viya 4 cadence classes,
closing the cadence axis of this phase's dialect risk.** Documented shape
checked before probing (public `sasctl` source): a Viya 4 deployment's
cadence is read via `GET /deploymentData/cadenceVersion`, returning
`cadenceName` (`stable`/`lts`) and `cadenceVersion`; a prior `/licenses/grants`
step distinguishes Viya 3 from 4, not needed here since Findings 7.1–7.4
already established both deployments are Viya 4. Run via `viya-api-probe`,
read-only, against each deployment directly (no session needed for this
endpoint):

- `verde` → `200`, `cadenceName: "lts"`, `cadenceDisplayName: "Long-Term
  Support 2026.03"`, `cadenceVersion: "2026.03"`.
- `Innov` → `200`, `cadenceName: "stable"`, `cadenceDisplayName: "Stable
  2026.06"`, `cadenceVersion: "2026.06"`.

One LTS, one Stable, three release-months apart — a materially different
pair than "two deployments that happen to run the same build." Findings 7.5/7.6 already established that every `DataAccessApi` mechanism this phase
has probed (library/table list and detail shapes, the summary/tables
content-negotiation mechanism, the busy-blocking behaviour, the
session-state media type) agrees identically between them. Combining that
agreement with this finding closes the question the Plan section and the
punch list both left open: it is no longer "two deployments agreeing, which
isn't the same evidence as two cadences agreeing" — it is two different
cadences agreeing, for the specific endpoints this phase covers. What this
does **not** claim: agreement outside those specific endpoints, or that no
future cadence could ever diverge — only that the endpoints Findings 7.1–7.4/7.5/7.6 exercised show no cadence-conditioned difference between an LTS
and a Stable release three months apart.

**Net effect on the Plan section's dialect-risk note:** for the specific
endpoints and mechanisms Findings 7.1–7.4/7.5/7.6 cover (library/table list and
detail shapes, the summary/tables content-negotiation mechanism, the
busy-blocking behaviour, and the session-state media type), two independent
Viya 4 deployments now agree in every particular except a session-state
*value* that differs for an unrelated, expected reason (session age at time
of check). Finding 7.7 establishes those two deployments are also two
different cadence classes (LTS vs. Stable), so this agreement is evidence
across cadences, not merely across deployments — **both axes of this
phase's dialect risk are now closed** for the endpoints probed. (Viya 3.5 is
out of scope entirely — ADR-0022 dropped it; not a question this phase
carries.)

Whether a *second* concurrent `DataAccessApi` call (no job involved) queues
the same way a job does remains unprobed, as does the `createView` sort
round trip — both deliberately out of scope for a read-only pass.

**Finding 7.8 — implementation-time probe, 2026-09-09 (same session as 7a's
code, `verde`): the `tables` relation needs no `itemtype` accept-header
parameter, and a table's own sparse list entry carries no `readOnly`.** Two
questions this Plan section's prose left unsettled when 7a's code was
actually being written, both read-only against a fresh throwaway `SAS Studio
compute context` session (created and deleted; `404` read-back confirmed):

- **`itemtype` is not required.** Finding 7.5 recorded the *documented*
  mechanism for reaching a library's tables collection as
  `Accept: application/vnd.sas.collection+json;itemtype=application/vnd.sas.compute.data.table.summary`
  — and `Link`/`readLinks` (`src/wire/links.ts`) do not carry `itemType` at
  all, which would have been a real gap had the parameter been load-bearing.
  It is not: requesting the identical `.../data/WORK` URI with a **bare**
  `Accept: application/vnd.sas.collection+json` (no `itemtype`) returned the
  identical tables collection, envelope
  `"accept":"application/vnd.sas.compute.data.table.summary"` — this
  deployment infers the item type from the base media type alone, since
  `library`/`library.summary`/`collection` are the only three
  representations this URI ever serves. `LibraryAdapter.getTables` therefore
  follows a library's own `tables` link (`type: "application/vnd.sas.collection"`)
  through the ordinary `client.send({ link })` path with no `itemtype` string
  anywhere in `src/data/` — confirming, rather than merely assuming,
  ADR-0027's "acceptFor already derives the correct Accept... with no new
  media-type constant."
- **A table's sparse list entry carries no `readOnly` of its own.** `GET`
  `SASHELP`'s `tables` collection (394 tables) returned each entry as
  `{ id, name, version, links }` — the same two-tier sparse/rich split
  Findings 7.2/7.5 established for libraries, but 7a does not add the
  per-table rich-detail follow-up that would parallel a library's: no caller
  in this slice needs a table's own fields beyond its name, and a per-table
  `GET` for 394 tables just to populate an icon would be exactly the kind of
  request a read-only tree should not make. `src/data/types.ts`'s
  `readTableItem` inherits `readOnly` from the owning `LibraryItem` instead —
  matching upstream's own documented "inherited unless overridden" contract,
  since no override has ever been observed on either deployment probed this
  phase.

**Finding 7.9 — implementation-time probe, 2026-09-09 (same session,
`verde`): a paginated collection's own `next` link carries no media type, and
following it literally changes what the URI answers.** `GET` `SASHELP`'s
`tables` collection at `limit=5` returned a `next` link
(`.../data/SASHELP?limit=5&start=5`) with **no `type` field at all** — Finding
14's established shape for a link with no media type (the key is omitted, not
`null`). Requesting that exact href with **no `Accept` header** (the ordinary
consequence of following a typeless link through the existing `acceptFor`
logic) answered `200` with `Content-Type: application/vnd.sas.compute.library+json`
and the **library's own rich detail** — not a continuation of the tables
listing. The same URI genuinely serves three representations (Finding 7.5),
and an absent `Accept` falls back to the richest one by default; a `next`
link's own silence about its type is not a promise that the default still
means "more of this listing." A naive pagination loop that re-derives
`Accept` fresh from each page's own `next` link — the shape
`compute/fileref.ts`'s `listFilerefNames` (Finding 94) uses, safely, because
the filerefs collection is not overloaded onto a shared URI the way
`DataAccessApi`'s per-libref endpoint is — would silently switch
representations on page 2 and either misread the library object as more
table rows or fail confusingly. `LibraryAdapter`'s private `collectPages`
avoids this by fixing the *first* link's own `type`/`responseType` across
every page and varying only the `href` a `next` link names, so the request
that actually reaches the wire always carries page 1's accept header. No
equivalent risk exists for `listFilerefNames` or any other collection this
project already paginates — this is specific to the two-or-three-representations-
per-URI shape Findings 7.5/7.6/7.8 establish is unique to `DataAccessApi`.

**Net effect on 7a specifically:** both findings *confirm* ADR-0027's design
(one concrete adapter, `acceptFor`'s existing link-driven `Accept`, no new
media-type constant) rather than requiring a change to it — the risk each
probe closed was a risk in the Plan section's own prose, not in the shape the
ADR actually settled on. Recorded here, in the same slice as the code
relying on them, per this project's own "every claim carries its evidence"
rule.

Whether a *second* concurrent `DataAccessApi` call (no job involved) queues
the same way a job does remains unprobed, as does the `createView` sort
round trip — both deliberately out of scope for a read-only pass, and
neither bears on 7a, which issues no such call and does not sort.

**Finding 7.10 — implementation-time probe, 2026-09-10 (`verde`, ahead of
7b's own code): the rows collection's `count` is populated at any `limit`,
not left `null` the way other Compute collections sometimes are.**
Documented shape checked first: `RestLibraryAdapter`/upstream's own
`useDataViewer.ts` treat a paginated rows response's `count` as
authoritative when present, falling back to "fewer than a full page came
back, assume this is the last one" only when it is absent — the same
count-is-sometimes-null caution this project's own "Compute wire facts"
findings (Phase 2b) already established for a different collection. Probed
directly against a fresh throwaway `SAS Studio compute context` session
(created and deleted; `404` read-back confirmed): `GET
…/data/SASHELP/CLASS/rows?start=0&limit=2` → `count: 19` (the table's true
row count), `itemCount: 2`; the identical request at `limit=1000` (larger
than the table) → `count: 19`, `itemCount: 19`. **`count` is exact and
present at both a small and an over-large `limit`, on this deployment.** 7b's
own datasource can read `count` directly as the grid's total row count and
does not need upstream's "assume last page" heuristic — worth reconfirming
against a second deployment if 7b's own implementation session has time,
the same way 7a's own findings did, but not blocking: the mechanism is a
plain field read, not a branch this project would dialect-gate.

**Correction, 2026-09-10 (later the same day, `verde`): this finding's own
`itemCount: 2` claim does not reproduce.** A fresh, independent re-probe of
the identical request (`GET …/data/SASHELP/CLASS/rows?start=0&limit=2`, a
new throwaway session, created and deleted, `404` read-back confirmed)
returned `count: 19` exactly as recorded above, but no `itemCount` field at
all — absent, not `null`. Nothing in this codebase reads `itemCount`
(`src/data/adapter.ts`'s `readCount` only ever looks at `count`), so this does
not change 7b's implementation, but the earlier prose's specific mention of
it is corrected here rather than left standing uncorrected, per this
project's own rule that a superseded value gets swept rather than quietly
left beside its correction. `count`'s own behaviour — populated, exact, at
both a small and an over-large `limit` — is unaffected and reconfirmed by
this same re-probe.

**Finding 7.11 — implementation-time probe, 2026-09-10 (`verde`): `SAS.sd2df`,
`SAS.df2sd`, and `SAS.submit` all complete successfully inside one `PROC
PYTHON` job on this project's own execution path.** `phase-1.md`'s Finding 2
confirmed only that `'SAS' in dir()` is `True`; no prior finding had actually
invoked any of the bridge object's methods. Documented shape checked first
(SAS's own Python-procedure documentation, cross-referenced against public
SAS blog/community material describing the same four callback methods —
see the Plan section's 7d entry). Probed via a job submitted to a fresh
throwaway `SAS Studio compute context` session (created and deleted; `404`
read-back confirmed): a single `PROC PYTHON` block called `df =
SAS.sd2df("sashelp.class")` (returned `shape (19, 5)`, matching the table's
known row/column count from Findings 7.1/7.5), built a small `DataFrame` and
wrote it back via `SAS.df2sd(newdf, "work.probe_df2sd_out")`, then called
`SAS.submit(stmt)` for a `LIBNAME` statement (see Finding 7.12) — all three
completed without error and their own print markers all appeared in the job
log in the expected order. **This is the first confirmation any of the
three methods actually work on this project's own path, not merely that the
bridge object is present.**

**Finding 7.12 — implementation-time probe, 2026-09-10 (`verde`): a
`LIBNAME` statement executed via `SAS.submit()` gets SAS's standard
`PASSWORD=` masking in its own log echo; this corrects, rather than
confirms, the 2026-09-04 stash's speculative risk.** Documented shape
checked first (SAS's own LIBNAME-statement documentation, via web search):
`PASSWORD=`/`PASS=`/`PWD=`/`PW=` values are, by default, replaced with `X`
characters in the SAS log wherever a `LIBNAME` statement is logged. The
2026-09-04 scoping session, unable to reach `verde`, guessed by analogy to
Finding 92 (Phase 8's plaintext `CASTOKEN` leak) that a credential passed to
`SAS.submit()` would leak the same way. This session probed it directly,
designed to isolate `SAS.submit()`'s own behaviour from the already-known
outer-echo mechanism: a submitted Python block assembled a `LIBNAME`
statement's password from a list of string fragments joined at runtime
(`"".join([...])`), specifically so the resolved value never appeared as a
literal anywhere in the submitted Python source, then passed the assembled
statement to `SAS.submit(stmt)`. **Observed:** the job log's echo of the
Python source (the outer, already-documented mechanism — Finding 2/93) shows
only the *code* that builds the string (`parts = ["FAKE","PW", …]`, `stmt =
"libname … password='" + pw + "' schema='test';"`) — never the resolved
value, because the value never existed as source text. The log's *separate*
echo of the statement `SAS.submit()` actually executed reads
`libname mysqllib mysql server='fake-host-not-real.example'
user='fakeuser' password=XXXXXXXXXXXXXXXXXXXXXXXXX schema='test';` — masked,
exactly as a top-level `LIBNAME` would be. (The statement itself then failed
downstream with `ERROR: The SAS/ACCESS Interface to MYSQL cannot be
loaded.`, expected since no such engine/host exists in this deployment —
irrelevant to the masking question, which concerns the log echo, not
whether the connection succeeded.)

**Documented vs. observed, stated explicitly:** the 2026-09-04 stash
documented a *hypothesis* ("`SAS.submit()` likely leaks a credential the way
Finding 92 did"), not a probed fact. The observation refutes that specific
hypothesis for the mechanism actually tested — `SAS.submit()`'s own
statement-level echo inherits SAS's ordinary option-masking. **What this
does not settle, and what remains exactly as risky as Finding 92 already
established:** the *outer* job-source echo (Finding 2/93's documented,
unconditional behaviour) reproduces a user's submitted Python verbatim
regardless of what it does — so a credential written as a Python string
*literal* anywhere in a submitted cell (including as an argument to
`SAS.submit()` itself, if typed directly rather than assembled at runtime)
still leaks in full, before `SAS.submit()`'s own masking ever has a chance
to run. This session's probe deliberately avoided that literal-in-source
case to isolate `SAS.submit()`'s own behaviour; it does not claim the
literal case is safe — Finding 92 already established it is not, and
nothing here changes that. **The practical guidance 7d's documentation
should give:** never write a credential as a literal string in submitted
Python, whether or not `SAS.submit()` is involved; source it from a runtime
value if one is genuinely needed, and prefer a site-assigned, pre-provisioned
libref over an ad hoc `SAS.submit("libname ...")` carrying any credential at
all — the same shape of answer Phase 8 reached for CAS tokens (`8b`'s own
punch list), generalized to this call site.

Not probed this session, left open for whoever writes 7d's documentation or
its drag-and-drop snippet: `SAS.symget`/`SAS.symput` (the fourth bridge
method, not exercised here since 7d's own scoping never named a use case for
it); whether `sd2df`'s in-memory pull against a genuinely large external
table produces the OOM failure shape the Plan section's own risk bullet
above predicts (no such table was available to test against this session);
and a second-deployment (`Innov`) rerun of Findings 7.10–7.12, which would
close the dialect-risk question for these mechanisms the same way Findings
7.5–7.7 did for 7a's own wire shapes.

**Finding 7.13 — implementation-time probe, 2026-09-10 (`verde`, while
writing `LibraryAdapter.getRows`): the `rows` collection's own `next`,
`last`, `self`, and `collection` links all carry an explicit `type` and
`itemType` — unlike the `data/{libref}` URI's untyped `next` (Finding 7.9),
this is not a representation trap.** Documented shape checked first: no SAS
reference documents this collection's link set field-by-field, so the check
was direct rather than doc-first, the same as Finding 7.9 itself. Probed via
a fresh throwaway `SAS Studio compute context` session (created and deleted;
`404` read-back confirmed): `GET
…/data/SASHELP/CLASS/rows?start=0&limit=2` returned a `links` array of five
entries — `self`, `collection`, `next`, and `last` each carrying
`type: "application/vnd.sas.collection"` and
`itemType: "application/vnd.sas.compute.data.table.row"`; `up` (pointing back
at the table itself, not a page of it) carrying
`type: "application/vnd.sas.compute.data.table"` and no `itemType`, which is
expected for a link to a single resource rather than a collection. **This
does not license `getRows` to follow the collection's own `next` instead of
re-deriving each window from the table's own `rows` link** — the method's own
doc comment is explicit that it does not depend on this being true to stay
correct, and Finding 7.9's caution about the *tables* collection's untyped
`next` stands unchanged, scoped to that URI. This finding only closes the
question of whether the *rows* collection carries the same trap: on this
deployment, it does not.

**Finding 7.14 — implementation-time probe, 2026-09-10 (`verde`, chasing
Sean's own manual-test finding that numeric columns were not right-aligning
in the data viewer): a real numeric column's `type` is `"FLOAT"`, never
`"NUM"`.** Documented shape checked first: SAS's own `getColumns` reference
(`developer.sas.com/rest-apis/compute/getColumns`) worked example returns
`type: "FLOAT"` for every numeric column in its `MAPSGFK.AFGHANISTAN` sample
(`SEGMENT`, `X`, `Y`, …) and `type: "CHAR"`/`"VARCHAR"` for its character
ones — `"NUM"` does not appear anywhere in that reference. Probed directly
via a fresh throwaway `SAS Studio compute context` session against `verde`
(created and deleted; `404` read-back confirmed): `GET
…/data/SASHELP/CLASS/columns` returned `type: "CHAR"` for `Name`/`Sex` and
`type: "FLOAT"` for `Age`/`Height`/`Weight` — documentation and this
deployment agree exactly. `Innov` was not reachable this session (stored
token had expired, `401`) to repeat the dialect-risk cross-check Findings
7.5–7.8 ran for other endpoints in this family; not treated as a gap worth
blocking on, since `type` is a fixed SAS metadata vocabulary rather than
version- or cadence-sensitive behaviour, and the documented example already
agrees independently. **Net effect**: `toColumnDefs`
(`src/webview/dataViewerEntry.tsx`) compared against `"NUM"` — a value
nothing had ever confirmed against a real deployment before this finding —
and now compares against `"FLOAT"` instead; `test/fixtures/data/columns-class.json`
and the tests reading it are corrected to match. **Not probed**: whether any
SAS column type besides `CHAR`/`VARCHAR`/`FLOAT` exists on this API (e.g. an
integer-only storage subtype) — SAS's own numeric storage is always a double
internally, so none is expected, but this finding only speaks to what
`SASHELP.CLASS` actually returned.

**Finding 7.15 — implementation-time probe, 2026-09-10 (`verde`, ahead of
7c-i's own code): `createView`'s real request/response shape, and two link
relations settling both 7c-i's and 7c-iii's mechanism questions in one
pass.** Documented shape checked first: the upstream generated client
(`vscode-sas-extension`'s `compute.ts`) types the request body as
`ViewRequest` (`version?`, `where?`, `fileProtection?`,
`fileProtectionEncoding?`, `includeColumns?`, `columnNaturalOrder?`,
`sortBy?: SortByRequest[]`, `distinct?`) with
`Content-Type: application/vnd.sas.compute.data.table.view.request+json`, and
reads the response as a plain `TableInfo`. Probed directly: created a
throwaway writable table (`work.probe7ci`, via `data work.probe7ci; set
sashelp.class; run;` in a throwaway session) rather than probing against
read-only `SASHELP.CLASS`, since `createView` is a mutation.

- **The rich table-detail response's own `links` (`GET
  …/data/WORK/PROBE7CI`) already carries everything 7c-i and 7c-iii need,
  confirming the link-following discipline Findings 7.5/7.8/7.9 already
  established applies here too, with no hand-composed URL required**: `rows`
  (`GET`, `application/vnd.sas.collection`), **`rowsAsCSV` — a real, distinct
  link relation, `GET`, `text/csv`, carrying the *identical href* as
  `rows`** (settles 7c-iii's mechanism question: CSV is `Accept`-header
  content negotiation on the same URI, exactly like the summary/tables
  mechanism Finding 7.5 found for libraries — **not** upstream's
  hand-composed `.../rows#CSV` suffix, which Finding 7.5's own `#`-fragment
  lesson already made suspect), `columns` (`GET`, `collection`),
  `createView` (`POST`,
  `application/vnd.sas.compute.data.table.view.request`), and **a real
  `delete` link (`DELETE`, no `type`)** — this project's `LibraryAdapter`
  needs no hand-composed delete URL for either a table or a view, following
  `findLink(detail.links, "delete")` the same way `src/content/adapter.ts`
  already does for content deletes.
- **`POST` the `createView` link with `{"sortBy":[{"key":"Age",
  "direction":"descending"}]}`, `Content-Type:
  application/vnd.sas.compute.data.table.view.request+json` → `201`, body is
  a `TableInfo` for the new view**: `libref: "WORK"` but a **system-generated
  name in a synthetic `$VIEWS` libref-like segment** (percent-encoded
  `%24VIEWS` in every link href — e.g.
  `.../data/%24VIEWS/T0D749FF8_3AC5_3143_049A352FF1A8`), `type: "VIEW"`,
  `rowCount: -1` (not yet known — a view's row count is never populated at
  creation, unlike a real table), and its own full link set (`self`,
  `rows`, `rowsAsCSV`, `rowSet`, `rowSetView`, `columns`, `createView` —
  views can themselves be re-sorted, though this project has no reason to
  chain that — and `delete`). No dialect branch needed: the response shape
  matches `TableDetail`'s existing reader with the addition of the `type`
  field this project's `TableDetail` does not currently read (not needed —
  nothing distinguishes a view from a table by consumption, only by
  cleanup obligation).
- **`DELETE` the `delete` link on both the view and the base table returned
  `204`; a follow-up `GET` on each returned `404`.** Confirms deletion is
  real and immediate, not just conceptual — no orphan risk from a *successful*
  delete; Finding 7.16 below is about a *skipped* delete.
- **A pre-existing fixture (`test/fixtures/data/table-detail-class.json`,
  built for 7a/7b, before this finding) had guessed both the `createView`
  and `rowsAsCSV` link hrefs wrong** — `.../CLASS/createView` and
  `.../CLASS/rowsAsCSV`, plausible-looking extrapolations from the relation
  name that this probe shows are not what a real deployment sends: the real
  `createView` href is `.../{tableName}/views` (this finding's own probe),
  and `rowsAsCSV` shares the *identical* href as `rows`, differing only by
  its own `type: text/csv`. Neither wrong value had a caller before this
  slice (7a/7b never followed either link), so this went unnoticed until
  7c-i's own code tried to follow `createView` and got an unmatched-route
  test failure. Corrected in the same change as 7c-i's own code, per this
  project's "every claim carries its evidence" rule — a fixture is exactly
  "a place a superseded value was written down." The fixture also gained the
  `delete` link this finding confirms every table's rich detail carries,
  absent from it entirely before now.

**Finding 7.16 — `where=` is silently ignored on a created view's own rows
read; it must be baked into the `createView` request body instead, not
applied as a query parameter the way it works on a real table.** This
contradicts the plausible assumption (and this phase's own Plan-section
prose before this probe) that a view, once created, behaves exactly like any
other readable table for every purpose including query-time filtering.
Probed directly, same throwaway session: created a view sorted by `Age`
descending with no `where` in the body, then read its `rows` link with
`?...&where=Sex%3D%27F%27` appended (`Accept:
application/vnd.sas.collection+json`) — returned all **19** rows,
identical to the unfiltered read, with **no error, no warning, silent
non-application of the filter**. The identical `where=Sex%3D%27F%27` query
param applied directly to the *base table's* own `rows` link (no view
involved) correctly returned **9** rows (all female). **The fix**: a second
view was created with `{"sortBy":[...],"where":"Sex='F'"}` **both fields in
the one `createView` body** — reading that view's `rows` correctly returned
9 rows, sorted by age descending. **Net effect for 7c-i**: `LibraryAdapter`'s
sort-view creation must always include the *current* filter value (if any)
in the same `createView` call that sets `sortBy`, and a filter-only change
(no active sort) can skip view creation entirely and apply `where=` directly
to the base table's own `rows` link — but a filter change **while a sort is
already active** requires recreating the view (delete old, create new with
both `sortBy` and the new `where`), it cannot be layered onto an
already-created view's rows read after the fact. This is a real,
correctness-affecting finding, not a style preference: porting `where=` as a
plain per-request query parameter unconditionally (the naive read of
`getRows`'s own existing `withQuery` pattern) would silently show unfiltered
results the instant a sort was also active, with no error to signal it.

**Finding 7.17 — the rows collection's `count` field, which Finding 7.10
found populated at any `limit` on a plain, unfiltered base-table read, is
**absent** the moment either a `where=` filter or a view is involved — even
on the base table.** Probed directly, same throwaway session and table:
plain `GET …/data/WORK/PROBE7CI/rows?start=0&limit=5` (no filter) →
`count: 19`, present, matching Finding 7.10's shape exactly. The *identical*
request with `where=Sex%3D%27F%27` added → `count` **absent from the
envelope entirely** (not `null` — the key itself is missing, the same
absent-vs-null distinction Finding 14 established for link `type`). Every
view-backed read probed (sorted-only, sorted+filtered) also came back with
`count` absent, regardless of whether a `where` was involved. **Net effect:
7b's own datasource (Finding 7.10, `LibraryAdapter.getRows`) can only trust
`count` as an exact total when neither a filter nor a sort is active.** The
moment 7c-i's filter or sort is in play, the grid must fall back to
upstream's own "fewer rows came back than the page size requested → this is
the last page" heuristic (`useDataViewer.ts`'s own fallback, which Finding
7.10 said this project's *base* case did not need) — this is now a real
requirement for 7c-i specifically, not a hypothetical upstream compatibility
concern.

**Finding 7.18 — an invalid `where=` clause returns a `400` in this
project's already-handled `application/vnd.sas.error+json` shape, with the
real SAS parser message nested one level down.** Probed: `where=` set to a
column name (`NoSuchColumn`) that does not exist on the table → `400`,
`errorCode: 5316`, top-level `message: "Failed to open Data Table"`, and a
nested `errors[0].details`:
`["ERROR: Variable NoSuchColumn is not on file WORK.PROBE7CI."]` — the
actual actionable text. This is the standard error envelope `src/wire/`
already reads elsewhere in this project (no new parsing needed), but 7c-i's
filter-commit UI should surface the *nested* `errors[0].details`/`message`
text (a real, specific parser complaint) rather than only the generic
top-level `"Failed to open Data Table"`, or a user who fat-fingers a column
name gets a useless error.

**Not probed, left open for 7c-i's own implementation session**: a second
deployment/cadence cross-check for Findings 7.15–7.18 (matching Findings
7.6/7.7's practice for 7a's own endpoints) — `Innov`'s stored token had
expired (`401`) mid-session and was not refreshed for this pass; not treated
as blocking, since Findings 7.5–7.9 already closed the dialect-risk question
for every other `DataAccessApi` mechanism this phase touches and nothing
about `createView`'s shape (a plain, typed `ViewRequest`/`TableInfo` pair, no
free-form content negotiation) suggests a different risk profile. Also not
probed: whether a `createView` call itself can fail with a *malformed*
`sortBy` key (e.g. a column that does not exist) the same way an invalid
`where=` does — worth a quick check while 7c-i's own error-handling code is
being written, since it is one line to add to the same throwaway-session
pass.

**Finding 7.19 — the full `TableInfo` field set 7c-ii's table properties
panel needs, and the real shape of its two timestamp fields.** Probed:
`GET /compute/sessions/{id}/data/SASHELP/CLASS` (the same rich per-item table
detail Finding 7.1 already established the mechanism for), `verde`,
2026-09-10, a fresh throwaway session (`SAS Studio compute context`, deleted
afterward, confirmed gone by a `404` read-back). Full body:

```json
{
  "bookmarkLength": 12,
  "columnCount": 5,
  "compressionRoutine": "NO",
  "creationTimeStamp": "2026-03-04T20:36:21.880Z",
  "encoding": "us-ascii  ASCII (ANSI)",
  "engine": "V9",
  "extendedType": "",
  "id": "CLASS",
  "label": "Student Data",
  "libref": "SASHELP",
  "links": [ /* self, alternate, rows, rowsAsCSV, rowSet, promptContent,
                columns, createView — no "delete" link on the table itself,
                only on a view createView produces (Finding 7.15) */ ],
  "logicalRecordCount": 19,
  "modifiedTimeStamp": "2026-03-04T20:36:21.880Z",
  "name": "CLASS",
  "physicalRecordCount": 19,
  "recordLength": 40,
  "rowCount": 19,
  "type": "DATA",
  "version": 3
}
```

**Settles the one open question 7c-ii's own punch list named**:
`creationTimeStamp`/`modifiedTimeStamp` are ISO-8601 strings with millisecond
precision and a `Z` suffix, not a raw SAS epoch-seconds number — `new
Date(value)` parses them directly on this deployment, every time. Upstream's
own `TablePropertiesViewer.ts` carries a fallback that treats the value as
seconds since 1960-01-01, in case SAS ever sends the raw-epoch shape instead
of an ISO string.
`src/data/tablePropertiesModel.ts`'s own `formatTimestamp` keeps the identical
fallback for parity, but it is **not confirmed reachable on this
deployment** — nothing here has ever exercised it against real data, and this
finding is why. **`extendedType` is an empty string, not absent** — treated
identically to absent by `readTableDetail` (the same "empty optional string ⇒
undefined" convention `readColumnItem` already applies to a column's own
`label`/`format`/`informat`). No `Innov`/second-cadence cross-check this
session (the `Innov` token was not available in this session's credentials,
matching 6d-i's own "verde-only" note); not treated as blocking, since
Findings 7.5–7.9 already closed the dialect-risk question for every other
`DataAccessApi` field/shape this phase has probed and nothing about a plain
`TableInfo` GET (no content negotiation, no version-conditioned branch
anywhere in `RestLibraryAdapter.ts`) suggests a different risk profile.

**Finding 7.20 — implementation-time probe, 2026-09-11 (`verde`, ahead of
7c-iii's own code): the real `rowsAsCSV` mechanism confirmed end to end —
`Accept`-header negotiation on the identical `rows` href, real streamable
CSV text, `start`/`limit` pagination honoured, and default quoting is already
RFC-4180-correct.** Documented shape checked first: upstream's own
`RestLibraryAdapter.getRowsAsCSV` composes a hand-built
`.../rows#CSV` URL and, because the `#` fragment is stripped before the wire
ever sees it (the same trap Finding 7.5 found for
`#summary`/`#tables`), the request that actually goes out is a plain
`GET .../rows` with no `Accept` override — so upstream's own client silently
falls back to the default JSON envelope and never receives real CSV at all;
`LibraryModel.writeTableContentsToStream` compensates by reading `data.rows`
as parsed JSON and building CSV text itself, client-side
(`stringArrayToCsvString`). **This project's own mechanism must not copy
that**: Finding 7.15 already found a real, distinct `rowsAsCSV` link relation
sharing the *identical href* as `rows`, differing only by its own declared
`type: text/csv` — the correct reading is `Accept`-header content negotiation
on that one shared URL, not a hand-composed suffix.

Probed directly, `SASHELP.CLASS` (read-only) via a fresh throwaway `SAS
Studio compute context` session (created and deleted; confirmed gone by a
`404` read-back):

- **`GET` the `rows` href with `Accept: text/csv` (no query params) → `200`,
  `Content-Type: text/csv`, body is real, valid CSV data rows — no column-name
  header row by default.** `Content-Length` matched the body exactly (19 rows,
  no envelope, no trailing JSON of any kind).
- **`includeColumnNames=true` prepends a header row of column names** (`Name,
  Sex,Age,Height,Weight`) — the same query parameter upstream's generated
  client already knows about, now confirmed to actually take effect on a real
  `Accept: text/csv` request (upstream never got this far, per above).
  `includeIndex=true` prepends an extra, unnamed leading column holding the
  1-based row index, same as the JSON `rows` collection's own per-item
  shape.
- **`start`/`limit` pagination is honoured identically to the JSON `rows`
  link** — `start=3&limit=3` returned exactly rows 4–6, `start=17&limit=10`
  (17 of 19 total) returned only the 2 remaining rows with a `200`, and
  `start=100&limit=10` (fully past the end) returned a `200` with an empty
  body (`Content-Length: 0`), not an error. **Net effect for 7c-iii: CSV
  export can page through a table exactly like the existing `getRows` path
  does, and can detect its own last page the same way — fewer rows returned
  than the page size requested — with no need to know the total row count up
  front.** This sidesteps Finding 7.17's "`count` disappears once a filter or
  view is involved" caveat entirely, since CSV export has no JSON envelope to
  carry a `count` in the first place.
- **Line endings are a bare `\n` (no `\r`), each page ends with a trailing
  newline after its last row, and the next page's own body starts immediately
  with its first row's data — no blank line, no partial-row overlap.**
  Confirmed byte-exact: `start=0&limit=3`'s raw body ends
  `...Barbara,F,13,65.3,98\n` and the immediately following `start=3&limit=3`
  page begins `Carol,F,14,62.8,102...` with no leading newline of its own.
  **Net effect: writing each page's raw response body to the output file
  stream, in order, with no separator inserted between pages, reconstructs
  the identical byte stream a single unpaginated request would produce** — no
  client-side newline bookkeeping needed across a page boundary, only
  requesting `includeColumnNames=true` on the first page and omitting it on
  every later one.
- **`where=` is honoured on the base table's own CSV read**, same as the JSON
  `rows` link (Finding 7.16 only found it silently ignored on a *view's* own
  rows read, not the base table's) — `where=Sex%3D%27F%27&includeColumnNames=true`
  correctly returned the header row plus the 9 female students only.
- **Default quoting is already RFC-4180-correct, with no query parameter
  needed.** Probed with a throwaway `WORK` table (created via a `DATA` step
  job, Sean's approval obtained first for this one mutating probe; deleted via
  its own `delete` link afterward, confirmed gone by a `404` read-back, then
  the session itself deleted and confirmed gone the same way) holding a
  comma-containing, embedded-double-quote, and embedded-newline value:
  `name="Smith, Jane ""The Great"""` read back, with no query parameters at
  all, as `"Smith, Jane ""The Great"""` (correctly comma-quoted, correctly
  double-quote-escaped) and a `note` value with an embedded newline came back
  as a single correctly-quoted multi-line CSV field. **`enableQuoting=true`
  and `enableEscaping=true` produced byte-identical output to the
  no-parameter default** on this same probe table — this deployment's default
  is already quoting-safe, so 7c-iii's own request needs neither parameter.
  Not probed: whether `enableEscaping` (backslash-style escaping instead of
  quoting) produces *different* output if explicitly requested — irrelevant to
  this project, which has no reason to ask for it, so left unprobed rather
  than chased for its own sake.

**Net effect for 7c-iii**: `LibraryAdapter`'s CSV export should follow the
`rowsAsCSV` link (identical href to `rows`, `findLink`-style, matching how
every other `LibraryAdapter` call already resolves its target) with
`Accept: text/csv`, page with `start`/`limit` exactly like `getRows` already
does, request `includeColumnNames=true` only on the first page, and needs no
`enableQuoting`/`enableEscaping` override. No dialect branch needed — nothing
in this probe suggests version-conditioned behaviour, consistent with every
other `DataAccessApi` mechanism this phase has found. No `Innov`/second-cadence
cross-check this session (matching 7.19's own note — `Innov`'s stored token
was not available); not treated as blocking for the same reason 7.19 gives.
