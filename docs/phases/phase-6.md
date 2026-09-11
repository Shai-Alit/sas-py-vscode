# Phase 6 — SAS Content explorer

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

---

## Plan

### Phase 6 — SAS Content explorer

**Scoped 2026-09-03**, while Phase 5's 5c-iii is in progress on the other
working copy — this scoping ran from a separate clone
(`sas-py-vscode-cowork`) precisely so it would not collide with that work.
Technical grounding below came from a codebase survey of both this repo and
`vscode-sas-extension` (the SAS extension's Content Navigator,
`client/src/components/ContentNavigator/` and
`client/src/connection/rest/RestContentAdapter.ts`), plus five live-Viya
probes against `verde` (Findings 78–82 below). No code was written this
session.

**What this phase is.** `PRODUCTION_PLAN.md` §3.1 already commits to parity
here — "SAS Content explorer (folders/files) … Ports closely —
language-agnostic" — and the codebase survey confirms that framing: the SAS
extension's Content Navigator talks to the Folders and Files services purely
in terms of generic resources (`name`, `contentType`, `links`), never SAS
syntax, so almost none of it is SAS-specific. What upstream calls
`ContentItem`/`ContentAdapter`/`ContentModel`/`ContentDataProvider` is the
shape to port; only the file-type resolution (§6a) and the two features
that are genuinely non-goals here (§"What does not port") are
Python-vs-SAS-shaped decisions.

**Why this is a bigger structural lift than it looks.** Every prior phase
extended machinery this repo already had — a compute session, an output
channel, a webview. Phase 6 introduces four VS Code surfaces this codebase
has never used: a `TreeDataProvider`, a `FileSystemProvider`, a
`TreeDragAndDropController`, and a `viewsContainers`/`activitybar` entry in
`package.json` — there is currently no view container at all. That is worth
naming up front the way 3d-ii named "this repository's first webview": 6a is
this repository's first tree view, first `FileSystemProvider`, and first
drag-and-drop controller, and the review bar for a slice that introduces a
whole new VS Code contribution surface is correspondingly higher than for a
slice extending an existing one.

**What ports closely, almost verbatim in shape:**

- The `ContentItem`/`ContentAdapter`/`ContentModel`/`ContentDataProvider`
  layering (`ContentNavigator/types.ts`, `ContentModel.ts`,
  `ContentDataProvider.ts`) — none of it is SAS-specific. `ContentDataProvider`
  implements `TreeDataProvider`, `FileSystemProvider`,
  `TextDocumentContentProvider` (for read-only recycle-bin content), and
  `TreeDragAndDropController` all on one class, exactly as it will need to
  here.
- The delegate-folder model — `@myFavorites`, `@myFolder`, `@sasRoot`,
  `@myRecycleBin` — confirmed live on `verde` (Finding 78): each resolves via
  `GET /folders/folders/@name` and carries the same link set upstream's
  client reads (`self`, `members`, `addMember`, `createChild`, `up`,
  `ancestors`, `deleteRecursively`, `validateNewMemberName`).
- The member-query shape: `GET <folder>/members?filter=in(contentType,'file','dataFlow')&sortBy=…`,
  confirmed live returning real `.sas`/`.py`/`.xlsx` files under "My Folder"
  (Finding 78 sub-probe) with the exact link set
  (`getResource`/`putResource`/`deleteResource`/`update`/`delete`/`ancestors`/`validateRename`)
  `renameItem`/`deleteItem`/`updateContentOfItem` read.
- `getResourceIdFromItem`'s fallback to a `self` link when `item.uri` is
  absent is **not defensive dead code** — the top-level "SAS Content" root
  listing (`GET /folders/folders?filter=isNull(parent)`) returns items with
  `uri: null` and `contentType: null` on this deployment (Finding 82), so
  that fallback path is exercised on the very first root the tree renders.
- The ETag/`If-Match`/`If-Unmodified-Since` discipline in `renameItem` and
  `updateContentOfItem` — this project already has the identical pattern in
  `src/compute/fileref.ts`/`files.ts`, so it is a second application of a
  convention this codebase already owns, not a new one.

**What needs rework, not a straight port:**

- **No adapter factory.** Upstream's `ContentAdapterFactory` dispatches
  across `{Rest, IOM, COM} × {SASContent, SASServer}` — six adapter
  combinations, of which only one (`Rest × SASContent`) will ever exist here.
  `PRODUCTION_PLAN.md`'s own parity table marks SSH/COM/IOM connections **and**
  a "SAS Server" file-navigation source as deliberate non-goals; this project
  is Viya-REST-only by design (ADR-0007's profile model, ADR-0022's Viya-4-only
  scope). Porting the factory and the `ContentSourceType` enum would build an
  abstraction with exactly one concrete case forever — the same "a method
  with no measured difference behind it is a guess with an interface around
  it" reasoning `src/dialects/dialect.ts`'s restraint clause already states
  for version branching. **6a should skip the factory and `RestServerAdapter`
  entirely**: one concrete class implementing `ContentAdapter` directly,
  built once `RestContentAdapter.ts` (Viya-REST/SAS-Content half only,
  ignoring everything in it gated on `ConnectionType.IOM`/`COM` or
  `ContentSourceType.SASServer`) has been read for what it does, not
  transcribed for what it is.
- **Where the link-following helpers live.** Upstream's `getLink` (two
  versions, different arity, in two different files — `rest/common.ts` and
  `rest/util.ts`) is exactly the name-collision problem `src/compute/links.ts`
  already solved once, for Compute. Its `readLinks`/`findLink`/
  `findLinkOfType`/`resolveHref`/`computeMediaType` are not Compute-specific —
  the `Link` shape (`rel`/`href`/`method`/`type`) is the same hypermedia
  envelope the Folders and Files services use. Content code importing from
  `src/compute/links.ts` would be a layering smell (content has nothing to do
  with a compute session); the alternative — copy the module under
  `src/content/` — recreates the two-copies problem this module exists to
  avoid. **Open decision for 6a:** promote `links.ts` (and `ForeignLinkError`)
  to a shared, session-agnostic home (e.g. `src/wire/links.ts`) with
  `compute/` and `content/` both importing it, and update its own doc
  comments (currently written Compute-first) accordingly. Small, mechanical,
  but worth deciding explicitly rather than defaulting to whichever import
  path is more convenient in the moment.
- **File-type resolution for `.py`.** Upstream hardcodes exactly one special
  case (`.sas` → `programFile`) and falls back to
  `GET /types/types?filter=contains('extensions', ext)` for everything else,
  including `.py`. **Finding 79**: on `verde`, that generic lookup already
  resolves `.py` to a real registered type — `file_py`, extensions `["py"]`,
  `mediaType: "application/x-python"` — so the same fallback path upstream
  wrote for "everything that isn't SAS" already does the right thing for our
  primary extension, with no `.py`-specific special case needed in 6a. The
  one open risk: this was confirmed on one cadence, on one deployment. Worth
  a second probe against a different Viya 4 cadence before 6a ships, since an
  older or freshly-installed deployment might not have `file_py` registered
  and would need the `defaultContentType` ("file") fallback upstream's
  `getTypeDefinition` already has for exactly this case.
- **Command naming.** Upstream groups commands as `SAS.content.<verb>`
  (`SAS.content.deleteResource`, etc.). This project's existing commands are
  flat — `pythonOnViya.runFile`, `pythonOnViya.signIn` — with no dotted
  sub-namespace. 6a's new commands should follow the existing flat
  convention (e.g. `pythonOnViya.deleteContentResource`), not upstream's
  grouping, for consistency with every command `package.json` already
  registers.
- **`ContentModel`'s reason to exist.** Upstream's `ContentModel` is a thin
  pass-through whose real job is letting `ContentNavigator` swap the whole
  adapter when the active profile's `connectionType` changes (Rest → IOM,
  etc. — see `index.ts`'s `onDidChangeConfiguration` handler constructing a
  fresh `ContentModel`). With no adapter-type switching possible here (one
  adapter, always Rest), that specific reason is gone. What remains — a
  reconnect-and-refresh reaction to a profile switch — already has a home in
  this codebase (`ComputeSessionManager`'s own profile-change handling).
  **Open decision for 6a:** decide whether `ContentModel` is still worth
  keeping as a seam (e.g. for HTTP-boundary test mocking, matching this
  project's "mock at the HTTP boundary" testing rule) or whether the tree
  data provider can talk to the adapter directly, once whoever writes 6a has
  looked at how `ComputeSessionManager` currently reacts to a profile switch.

**What does not port — deliberate non-goals, already settled elsewhere:**

- **`convertNotebookToFlow`** (`.sasnb` → `.flw`, SAS Studio flow conversion)
  — `PRODUCTION_PLAN.md` §3.1 lists "SAS Studio flow conversion" as a
  deliberate non-goal outright, and `.sasnb` is not a file type this
  extension's own Phase 9 notebooks will produce.
- **`ContentSourceType.SASServer`** / the "SAS Server" file-navigation root
  and its `RestServerAdapter`/`ItcServerAdapter` — covered above; this is a
  different capability (browsing a Compute session's own OS-level file
  system through the `getDirectoryMembers` context option) that nothing in
  this project's plan has scoped, for any phase.

**What is genuinely undecided — not one of 6a–6d, not a non-goal either:**

- **Upload/download to and from local disk**
  (`SAS.content.uploadResource`/`downloadResource`/the three upload-variant
  commands). `PRODUCTION_PLAN.md` §3.1 treats overall parity as an explicit
  goal, so this shouldn't silently vanish, but it also isn't in the original
  four-slice breakdown (6a–6d) `PRODUCTION_PLAN.md` already commits to. Left
  as an open scope question for whoever starts 6a: fold it into 6c (it's a
  mutation, in upstream's own terms) or defer it explicitly to Phase 11's
  parity sweep. Not decided this session.

**Testing.** This project's own rule ("mock at the HTTP boundary, never copy
the logic under test into the test") means content needs the same kind of
fixture-and-recorded-transport helper `test/helpers/recorded-proc-python.ts`
already is for Compute — a new `test/helpers/recorded-content.ts` (or
similar) plus fixtures under `test/fixtures/content/`. Findings 78–82 below
are the source-of-truth shapes those fixtures should be built from
(scrubbed per this project's own rule — real user name, folder ids, and
hostname all need replacing with synthetic-but-structurally-faithful
values before anything from today's probes becomes a committed fixture).

**Dialect risk, flagged not resolved.** Upstream's own content adapter
carries one inline cadence check — `this.viyaCadence === "2023.03"` gating
whether the `sortBy` query param includes a `contentType`-based clause. That
is exactly the shape `eslint.config.mjs`'s version-branch ban exists to
catch, and `src/dialects/`'s restraint clause ("a dialect method with no
measured difference behind it is a guess... methods arrive one at a time as
a probe or defect proves a difference") doesn't yet have a slot for
*cadence*-level differences within one `DialectId`, only generation-level
ones. Not resolved here — flagged so that if 6a's own probe pass reproduces
a live cadence-shaped difference, the question of where that logic goes gets
a real decision (and probably an ADR) rather than an inline string compare
slipping in under time pressure.

**Resolved for 6a-ii by not having the branch.** 6a-ii's probe pass
(findings 97–101) reproduced no cadence-shaped difference in the member
listing, and the adapter omits `sortBy` entirely — it orders the listing
client-side (folders first, then name). So upstream's `viyaCadence ===
"2023.03"` check has no analogue here to gate.
[ADR-0026](../adr/0026-content-adapter-shape.md) records this. The question
above stays open for any later slice whose own probing *does* turn up a live
cadence difference.

*Slices, refined from `PRODUCTION_PLAN.md`'s original one-line sketch:*

- **6a — Adapter + read-only tree.** *Medium/Large* — the structural lift
  above (first tree view, first view container, first `ContentAdapter`
  implementation, the `links.ts` promotion decision) lands here even though
  the wire calls themselves (Findings 78, 82) are already confirmed working.
- **6b — Open/save via `FileSystemProvider`.** *Medium* — `readFile`/
  `writeFile`/`stat` plus the ETag round trip (findings 6.1/6.2). **Done** —
  [PR #141](https://github.com/Shai-Alit/sas-py-vscode/pull/141), squash
  `1c13854`, 2026-09-10; scoped to the open/save core — see the Runbook block
  for the three items moved out. The drag-and-drop "insert a
  snippet referencing this file" behavior (`getFileStatement`) has no direct
  Python equivalent (a `filename … filesrvc …;` statement is SAS syntax);
  **decision (Sean, 2026-09-09): build a Python-shaped equivalent, gated on a
  probe** of how Python inside `PROC PYTHON` reaches a `filesrvc` fileref, and
  do it in **6c** alongside the drag-and-drop move.
- **6c — Mutations (create/rename/move/delete).** *Medium* — closely
  confirmed live (Finding 78's link set covers every verb here); the open
  upload/download scope question above most naturally lands in this slice
  if it's taken on at all.
- **6d — Favourites and recycle bin.** *Small/Medium* — mechanically small,
  but Findings 80 and 81 are two live anomalies (a favorites member-count
  mismatch; an inconsistent `previousParent` restore link) that need a
  follow-up probe at implementation time, not just a port of upstream's
  optimistic-path code.

*Exit:* a user can browse SAS Content (My Favorites / My Folder / SAS
Content / Recycle Bin), open and edit a remote `.py` file in place, and
create/rename/move/delete/favourite/recycle content — the same tree-based
workflow the SAS extension offers today, for Python files on Viya.

---

Everything above is the product. Everything below is breadth, and each phase
is independently valuable and independently shippable. Order is a
recommendation, not a dependency chain — reprioritise based on what users
actually ask for once v0.1.0 is in their hands.

---

## Runbook

_Scoped 2026-09-03, before any code was written — technical grounding (what
ports closely vs. what needs rework vs. what is a deliberate non-goal) came
from the codebase survey and the five live probes described in the Plan
section above and recorded in full below. **Recommended execution order:
6a → 6b → 6c → 6d**, matching the dependency chain PRODUCTION_PLAN.md's
original sketch already implies (a tree before a filesystem provider that
resolves URIs the tree hands it; mutations before the favourites/recycle-bin
affordances that are themselves particular mutations). Nothing here is a
hard technical barrier — this is a recommendation, not a dependency lock._

☑ **6a — `ContentAdapter` + read-only tree.** Split 6a-i (`src/wire/`
promotion, merged) and 6a-ii (adapter + read-only tree). 6a-ii merged as
`phase-6a-ii-content-tree`.

- ☑ Read `RestContentAdapter.ts` in full for what it does (not what it is) —
  the Viya-REST/SAS-Content half only, per the "no adapter factory" decision
  above. **Done in 6a-ii.** Audited, not transcribed. Notes:
  `getResourceIdFromItem`'s `self`-link fallback is load-bearing on the first
  level the tree renders (confirmed, finding 98); a folder *member* carries no
  `members` link, so listing its children means composing `${uri}/members`
  (finding 99), which upstream also does; upstream's `deleteResource` swallows
  a `404`/`403` from its follow-up member delete and returns it as success —
  noted for 6c, not ported here.
- ☑ Settle the `links.ts` promotion question (see Plan) before writing
  content-side wire code against either copy of it. **Resolved in 6a-i:**
  promoted to a new session-agnostic `src/wire/` layer
  (`src/wire/links.ts` + `src/wire/viyaError.ts`), `src/compute/` and
  `src/content/` both import it. [ADR-0025](../adr/0025-shared-wire-layer.md).
  `computeMediaType` renamed `sasMediaType` in the move. Zero behaviour change;
  the moved unit suites pass unchanged.
- ☑ Build the `src/content/` module — **done in 6a-ii.** `vscode`-free and in
  the coverage denominator: `types.ts`, `problems.ts`, `client.ts`,
  `adapter.ts`, `contentSession.ts` (adapter lifecycle — endpoint cache,
  sign-out clear, the silent token flow), `presentation.ts` (icon /
  `contextValue` / collapsible mapping). Thin `vscode` shells (excluded):
  `contentTree.ts` (`TreeDataProvider`), `contentExplorer.ts` (the registrar).
  **No `ContentModel`, no `ContentAdapterFactory`, and no `messages.ts` yet** —
  the read-only tree only logs, so the `l10n.t()` renderer had no caller and
  returns with 6b; [ADR-0026](../adr/0026-content-adapter-shape.md). The
  HTTP-boundary test seam is a fake `ContentClient`
  (`test/helpers/recorded-content.ts`); `contentSession`/`presentation` are
  unit-tested directly, and `test/integration/content/` smoke-tests the two
  shells in the extension host. (Splitting the logic out of the shells and
  adding the integration suite folded in the two AI-review findings on PR #139
  before merge.)
- ☑ Add the `viewsContainers`/`activitybar`/`views` contributions to
  `package.json` — this repo's first. **Done in 6a-ii:** view container
  `pythonOnViya`, view `pythonOnViya.contentExplorer`, `viewsWelcome` for the
  no-profile / signed-out states, command `pythonOnViya.refreshContentExplorer`
  (flat convention, not upstream's `SAS.content.<verb>`), a `view/title`
  refresh button, and `media/activity-bar.svg`.
- ☑ ~~A second live probe of `/types/types?filter=contains('extensions','py')`~~
  **Moved to 6c.** That endpoint is only read by *create file*
  (`getTypeDefinition`), a mutation; nothing in the read-only 6a-ii path calls
  it. The read-only slice's own probe pass (findings 97–101) confirmed the tree
  shapes instead. Finding 79's "confirmed on one cadence" caveat stands until
  6c re-probes it. (A side observation from finding 99: a `.py` file *member*
  already carries `typeDefName: "file_py"` inline on read — so 6c may not need
  a `/types/types` round trip at all, only a probe to confirm that.)
- ☑ `test/helpers/recorded-content.ts` + `test/fixtures/content/`, built
  from findings 97–99's scrubbed shapes. **Done in 6a-ii:** six fixtures
  (delegate folders, `isNull(parent)` root, member listing with a `.py` file
  and a child folder, nested folder). Real user name, folder GUIDs and
  hostname replaced with synthetic-but-faithful values.

☑ **6b — Open/save via `FileSystemProvider`.** Merged 2026-09-10 —
[PR #141](https://github.com/Shai-Alit/sas-py-vscode/pull/141), squash
`1c13854`. `npm run verify` green (1347 unit + 280 integration passing;
coverage 94.93% lines / 95.22% branches / 94.53% functions / 94.93%
statements). Adversarial pass done before the PR; Codex + Claude PR reviews
clean, all threads resolved (one finding deferred to 6c — see the 6c punch
list). Scoped down at slice start (Sean, 2026-09-09) to the open/save core;
three items moved to the slices that give them a reason to exist — see the
struck lines below.

- ☑ `readFile`/`writeFile`/`stat` via a new `sasContent:` `FileSystemProvider`
  (`src/content/contentFileSystem.ts`, a `vscode` shell) over three new
  `vscode`-free `ContentAdapter` methods — `statFile`, `readFileContent`,
  `writeFileContent` — on the mutating arm added to `src/content/client.ts`
  (`rawBody`/`contentType`/`If-Match`; response `etag`/`lastModified`/`rawBody`).
  Findings 6.1/6.2: the file resource carries `content`/`updateContent`
  relations at `${self}/content`, `PUT` needs `If-Match` (bare ⇒ `428`, stale ⇒
  `412`), and a successful `PUT` returns a fresh `ETag`. The
  `FileSystemProvider` keeps the `ETag` `readFile` opened each resource with and
  hands it to `writeFileContent` as the `If-Match` — **not** a freshly-fetched
  one, which is what `src/compute/fileref.ts`/`files.ts` do but only because
  `PROC PYTHON`'s serial execution (ADR-0015) guarantees nothing else touches a
  session's files; a SAS Content file is editable concurrently, so the guard
  only bites if the tag predates the other edit. A `412`/`428` surfaces to the
  user as a "changed on the server, reopen it" conflict through the returning
  `localiseContentProblem` seam (`src/content/messages.ts`); the cached tag is
  left in place, so a retry without reopening is another conditional `PUT` that
  `412`s the same way rather than a blind overwrite. A `200` advances the
  cached tag to the one the `PUT` returned.
- ☑ **Adversarial pass (2026-09-10) — `unauthorized` was collapsing two
  origins.** `client.ts` synthesises `not-authenticated` both when
  `config.token()` throws (no token ever obtained — the user is signed out for
  that deployment) and when `challengeProblem` reads a bare-challenge 401 the
  deployment actually answered (a dropped `Authorization` header — our bug,
  which `auth/messages.ts` words "please report this", not a sign-in loop). The
  `FileSystemProvider` keyed its sign-in prompt on `problem.problem.code ===
  "not-authenticated"`, so both read as "sign in". Fixed with a `noSession?:
  true` tag on the `unauthorized` `ContentProblem`, set only in `client.ts`'s
  token-catch arm; `contentFileSystem.ts` shows the sign-in prompt for that
  tag and keeps `localiseAuthProblem`'s wording for every other `unauthorized`.
- ☑ **PR #141 review follow-ups (2026-09-10).** Two Codex threads from the
  first pass that the branch had already addressed in code were answered and
  resolved inline (per-URI deployment-root resolution; a stale
  `HEAD`-before-`PUT` mention in a test doc comment, now corrected). One new
  non-blocking Claude finding folded in: `writeFile` now invalidates the
  `opened` guard to `null` when a successful `PUT` returns no `ETag` (a
  stripping proxy / non-`verde` release — finding 6.2 says a `200` always
  carries one), so a later save gets the accurate "no version tag, reopen it"
  refusal instead of sending the consumed tag and drawing a spurious `412`.
- ☑ **PR #141 post-merge review findings — [PR #145](https://github.com/Shai-Alit/sas-py-vscode/pull/145),
  squash `0449caa`, 2026-09-10.** Raised on the merged #141 by the Codex/Claude
  passes; fixed with an adversarial pass before #145 was opened, `npm run
  verify` green (1348 unit + 281 integration passing; coverage unchanged, 94.93
  lines / 95.22 branches / 94.53 functions / 94.93 statements), Codex + Claude
  PR reviews clean. One Major, two Minor:
  - **Major — the `opened` ETag guard was keyed by the `/files/files/{id}`
    href alone**, so the same Files service id opened on two Viya roots shared
    one entry: a `readFile` against root B overwrote the tag root A recorded,
    and the next save on A sent B's tag and drew a spurious `412` the user
    would read as someone else's edit. Now keyed by deployment root **and**
    href together (`resolve()` builds the composite), scoped exactly like the
    per-URI adapter resolution the URI's `r=` already drives. New integration
    test: "keeps the ETag guard per deployment".
  - **Minor — `adapter.ts` `statFile`'s `size: … : 0` fallback** now carries a
    comment that the `0` is a deliberate defensive default for a representation
    that arrives without a numeric `size` (the object-shape check above already
    rejects a non-object body), not a masked parse bug — worded to what finding
    6.1 actually established (a numeric `size` on the one `.py` file resource it
    probed), after the adversarial pass flagged the first wording as broader.
  - **Minor — `contentUriString` now percent-encodes a bare `%`** in the name
    segment, escaped before `#`/`?` so those escapes are not themselves
    double-encoded, so a legal SAS Content name like `100% done.py` round-trips
    through `vscode.Uri.parse`. New unit case in `content-uri.test.ts`. The
    name segment stays cosmetic — identity is entirely in `id=`/`r=`.
- ☑ `workspace.registerFileSystemProvider("sasContent", …)` + the
  `onFileSystem:sasContent` activation event. A tree file leaf
  (`NodePresentation.openable` — an ordinary `file`, never a `dataFlow`) gets a
  `resourceUri` and a `vscode.open` command pointed at its
  `sasContent:/<name>?id=<resourceHref>&r=<deployment root>` URI
  (`src/content/uri.ts`). The deployment root is in the URI, and
  `ContentSession` keeps an adapter per endpoint, so a file opened under one
  profile keeps reading and writing against its own deployment after the user
  switches profiles — a `FileSystemProvider` must service a URI without
  depending on "the active profile".
- ☑ ~~The read-only `TextDocumentContentProvider` `sasContentReadOnly` scheme
  for recycle-bin content~~ — **moved to 6d.** Nothing in 6b views recycled
  content; the scheme belongs with the recycle bin it exists for.
- ☑ ~~Decide the drag-and-drop snippet-insert question~~ — **moved to 6c.**
  Decision (Sean, 2026-09-09): build a Python-shaped equivalent of upstream's
  `filename … filesrvc …;` insert, **gated on a probe** of how Python inside
  `PROC PYTHON` reads a `filesrvc` fileref / a SAS Content file. It shares the
  `DataTransfer` wiring with 6c's existing drag-and-drop move item, so it rides
  there rather than gating open/save.
- ☑ ~~`getParent` / `TreeView.reveal` + a probe to pin finding 101's
  `ancestors` shape~~ — **moved to 6c.** Nothing reveals in an open/save slice;
  the first real caller is "select the item you just created or moved", so the
  `ancestors` probe rides with 6c's probe pass.

☑ **6c — Mutations (create/rename/move/delete).** All three sub-slices merged.
Split into three sub-slices
(Sean, 2026-09-10): **6c-i** create/rename/delete for folders and files from
the tree context menu; **6c-ii** drag-and-drop move (the repo's first
`TreeDragAndDropController`) — the Python-shaped drag-into-editor snippet was
scoped into this slice but is now **deferred to future work** (Sean,
2026-09-10; finding 6.11 — no idiomatic Python equivalent of upstream's
`filename … filesrvc …;` one-liner, and a low-priority nice-to-have);
**6c-iii** `getParent`/`TreeView.reveal` + the finding-101 `ancestors` probe.
**Upload/download to local disk was never in the 6a–6d breakdown.** The
6c-i Runbook entry that first said so (PR #148) attributed pushing it out to
Phase 11 to Sean by name; git blame (`c63feaf`, co-authored by a prior Claude
session) shows that attribution was never confirmed with him, and Sean has
said directly (2026-09-11, at the Phase 6→7/8 housekeeping checkpoint) that
he does not want it deferred that far — it is a feature developers will
expect, not a long-tail parity item. **Scope is an open question, not a
settled deferral** — corrected here rather than left as a false decision
record; see `phase-11.md`'s note for the retracted framing and
`STATUS.md`'s open-items list for where this is tracked until it is actually
scoped.

☑ **Oversized-file read surfaces as a network error (PR #141 review,
2026-09-10).** Done ahead of 6c-i as a standalone `fix/content-oversized-read`
branch (Sean's call, 2026-09-10 — it touches `src/auth/transport.ts`, shared
with compute, so it stays out of the content-mutation diffs). Merged as
[PR #147](https://github.com/Shai-Alit/sas-py-vscode/pull/147), squash
`79e10b0`. `nodeHttpTransport` now rejects an over-cap body with a typed
`ResponseTooLargeError` (carrying the `capBytes`) instead of a plain `Error`;
`src/content/client.ts` catches that and returns a new `content-too-large`
`ContentProblem` (`limitBytes`), which `messages.ts` renders as "This file is
too large to open in the editor (limit 10 MB). Open it in SAS Studio instead."
and `contentFileSystem.ts` maps to a plain `FileSystemError` (retrying will not
help). Compute is unaffected — the error is an `Error` subclass with the same
message, and its rich-output fetch already pre-checks size via
`exceedsCaptureCap`. Adversarial pass before the PR; `npm run verify` green;
Codex + Claude PR reviews clean.

☑ **6c-i — create / rename / delete from the tree context menu.** Merged
2026-09-10 — [PR #148](https://github.com/Shai-Alit/sas-py-vscode/pull/148),
squash `c63feaf`. Findings 6.3–6.9 (both a `verde` LTS 2026.03 and an `innov`
Stable 2026.06 deployment). `npm run verify` green (1395 unit + 287 integration
passing; coverage 95.12 lines / 95.18 branches / 94.76 functions / 95.12
statements). Adversarial pass before the PR raised one Major — `createFile`'s
orphan-rollback `DELETE` forwarded the caller's (cancellable) signal, so a
cancel/timeout that broke the two-call sequence also killed the rollback; now
runs on the client's own timeout with no caller signal, with a test driving an
already-aborted signal. Codex's PR review raised one further Major — the command
runner treated a **post-completion** Cancel click as a cancelled mutation, so a
change that landed left the tree unrefreshed; `run()` now acts on the adapter's
actual `ContentResult` and only suppresses output when the abort fired *during*
the work. Claude's PR review clean (one non-blocking note: the command handlers
have no `.catch`, matching the existing `src/*/commands.ts` convention). All
threads resolved. **6c-ii followed, then 6c-iii; all three merged 2026-09-10.**

- ☑ **Folder create / file create / rename / delete on `ContentAdapter`**
  (`src/content/adapter.ts`, `vscode`-free), each driven by a link the parent
  or item handed back — `createChild` (finding 6.3), `addMember` (6.4),
  `update` (6.5), `deleteResource`/`deleteRecursively`/`delete` (6.8). File
  create is two calls (`POST /files/files?typeDefName=…` then `addMember`) with
  the orphan file resource deleted if the `addMember` fails. Rename sends a
  **minimal `{name}`** body for a folder read directly and the **full member
  representation** with `name` changed for a member — finding 6.7: the full
  folder representation echoed back is `400`/`errorCode 1177` on Stable
  2026.06. Delete empties a folder child-by-child first — finding 6.8:
  `deleteRecursively` still `409`s on a non-empty folder on both cadences — and
  swallows the `404`/`403` on the trailing member-record delete (decision:
  keep upstream's swallow; the member is usually already gone).
- ☑ **JSON request-body arm on `ContentClient`** (`jsonBody` +
  `contentDisposition`, `Accept` now sent on a mutating call too). The write
  path was `rawBody`-only through 6b.
- ☑ **`content-name-rejected` `ContentProblem`** — the `validateNewMemberName`
  / `validateRename` endpoints answer `200` with `{valid:false,error:{…}}`
  (finding 6.6), so a name clash is caught before the mutation and rendered
  with the deployment's own "already exists" sentence and its
  `Suggestion: <name>` alternative.
- ☑ **`getTypeDefinition`** (cached per extension): `.sas` → `programFile`,
  else `GET /types/types?filter=contains('extensions','<ext>')` first item,
  else `file`. Finding 6.9 clears Finding 79's one-cadence caveat — `.py`
  resolves to `file_py` on both cadences — and confirms the create path still
  needs the lookup (omitting `typeDefName` does **not** infer the type from the
  filename; finding 6.4). The inline `typeDefName` on a *read* member
  (finding 99) does not help the *create* path.
- ☑ **Delegate `contextValue`s** in `src/content/presentation.ts` —
  `sasContent:myFolder` (create inside, no rename/delete) and
  `sasContent:delegate` (My Favorites / Recycle Bin — none of the three), so
  the `view/item/context` `when` clauses never offer a rename or delete on
  something that has no representation to rename or delete.
- ☑ **Four flat commands** (`pythonOnViya.createContentFolder` /
  `createContentFile` / `renameContentItem` / `deleteContentItem`) in
  `src/content/contentCommands.ts` — a thin `vscode` shell (input box with a
  local `validateInput`, modal confirm on delete, a cancellable view-progress
  spinner), hidden from the command palette (`menus.commandPalette`,
  `when:false`) because they need a tree item. `SasContentTreeProvider.refresh`
  grew an optional parent argument so a create reloads just that folder.
- ☑ Tests: `content-adapter.test.ts` (+40 — create/rename/delete happy and
  defensive branches, collision, non-empty-folder recursion, orphan rollback
  incl. the already-aborted-signal case, swallowed 404, sub-folder-member
  delete, `getTypeDefinition` cache/shortcut/fallback), `content-client.test.ts`
  (JSON body / `Content-Disposition` / `Accept`), `content-problems.test.ts` +
  `content-presentation.test.ts` + `test/integration/content/`
  (`messages.test.ts`, `explorer.test.ts` — command + menu wiring). New
  fixtures `folder-created` / `member-created` / `types-python` /
  `validate-name-taken`.

☑ **6c-ii — drag-and-drop move.** Merged 2026-09-10 —
[PR #151](https://github.com/Shai-Alit/sas-py-vscode/pull/151), squash
`8e842c7`. Scoped to the move (Sean, 2026-09-10): the drag-into-editor snippet
is **deferred to future work** — finding 6.11 measured that a `filesrvc` fileref
has no OS path the `PROC PYTHON` subprocess can `open()`, so the only
Python-shaped equivalent of upstream's one-line `filename … filesrvc …;` is a
multi-line `SAS.submit(… fcopy …)` blob with a hard-coded server path, and it is
a low-priority nice-to-have. `npm run verify` green (1417 unit + 296 integration
passing; coverage 95.18 lines / 95.25 branches / 94.79 functions / 95.18
statements). Adversarial pass before the PR (a runtime `Array.isArray` check on
the one `any` boundary; the recycled-item guard). Codex PR review clean; the
Claude PR review raised three findings over two rounds — a multi-item drag test
gap (fixed with two mixed-outcome integration tests); `canSelectMany` leaving
the 6c-i Rename/Delete/Create context commands able to act on just the clicked
item of a multi-selection (their `when` clauses now carry `&& !listMultiSelection`
so they hide during a multi-select); and a comment overclaiming the
`Array.isArray` guard (reworded) — all folded in before merge, all threads
resolved.

- ☑ **Drag-and-drop move** — `src/content/contentDragAndDrop.ts`, the repo's
  first `TreeDragAndDropController`. `handleDrag` puts the draggable selection
  (`NodePresentation.draggable`) on a private MIME (checked with `Array.isArray`
  on the way back out — the one `any` boundary); `handleDrop` runs
  `ContentAdapter.moveItem` per item behind a cancellable view-progress spinner,
  then a full-tree refresh (the moved member keeps its `id` — finding 6.10 — so
  expansion state survives). `moveItem` reads the member record then `PUT`s it
  back to its `self` link with `parentFolderUri` changed — one extra `GET`, the
  read-then-write shape `renameItem`'s member branch already uses; no `If-Match`
  (same "a re-parent has no reopen-it recovery" reasoning). Guards in a
  `vscode`-free `src/content/contentMove.ts` (`moveObjection`): dragged item is
  a member, target is an ordinary folder or My Folder (not the synthetic root,
  not the Favorites/Recycle delegates — those are 6d), **neither side is a
  recycled item** (a drag out of the Recycle Bin is a restore — 6d's), not a
  drop onto itself or its own current parent. A folder-into-its-own-descendant
  drop is left to the server's `400` (finding 6.10). The recycled-item check
  reads a synthetic `ContentItem.inRecycleBin` flag that `getChildItems` stamps
  on the Recycle Bin delegate's direct children — `previousParent` cannot stand
  in for it (finding 6.10: every once-moved member carries that link too);
  `presentation.ts` also drops `draggable` for a flagged item so the drag never
  starts. `canSelectMany` on the view for multi-drag; the 6c-i create / rename /
  delete context commands each act on the clicked item only, so their
  `view/item/context` `when` clauses gained `&& !listMultiSelection` — they are
  simply not offered while more than one item is selected (PR #151 review).
  `parentFolderUri` added to `ContentItem` (read for the no-op guard).
  `src/content/contentDragAndDrop.ts` added to `.c8rc.json`'s exclude list (a
  `vscode` shell, like `contentCommands.ts`); `contentMove.ts` is `vscode`-free
  and unit-tested. Tests: `content-move.test.ts` (guard matrix incl.
  recycle-bin), `content-adapter.test.ts` (`moveItem` happy / `link-missing` /
  malformed / passthrough; the recycle-bin child stamp),
  `content-presentation.test.ts` (`draggable`),
  `test/integration/content/dragAndDrop.test.ts` (controller wiring). New
  fixture `member-moved`.
- ☐ ~~Drag-a-file-into-the-editor snippet~~ — **deferred to future work**
  (Sean, 2026-09-10). Finding 6.11: Python under `PROC PYTHON` cannot open a
  `filesrvc` fileref (no OS path; `SAS.sasfnc("pathname", fr)` returns the bare
  filename), and there is no `SAS.*` callback that hands file bytes to Python.
  The one working mechanism is a `SAS.submit` that assigns the fileref and
  `fcopy`s it into the session run directory — which is the `PROC PYTHON`
  subprocess's cwd — for Python to `open()`. It works, but it is a fragile
  multi-line blob, not the idiomatic one-liner upstream inserts, and the
  feature is a low-priority nice-to-have. Revisit if users ask.

☑ **6c-iii — `getParent` / `TreeView.reveal` + the `ancestors` probe.** Done
and merged 2026-09-10 — [PR #154](https://github.com/Shai-Alit/sas-py-vscode/pull/154),
squash `507155e`. `npm run verify` green (1480 unit passing; coverage 95.31 lines /
95.37 branches / 94.98 functions / 95.31 statements). Integration 318 passing
(run with the VS Code env vars stripped — the `ELECTRON_RUN_AS_NODE` launch
quirk, unchanged). Adversarial pass before the PR: **no blocking findings** —
two minor polish items folded in (`revealCreated`'s re-list comment; the
drag-and-drop path now `await`s its `reveal` to match the create path rather
than firing it with `void`). **PR #154 review:** the Claude reviewer found
nothing blocking; the Codex reviewer flagged the two reveal-path fetches
(`getParent`'s `getParentOfItem`, `revealCreated`'s `getChildItems`) as running
without an abort path. Both are already bounded by the client's 15s timeout and
neither has a `CancellationToken` to thread, but each now passes its own
`AbortSignal.timeout(8_000)` — a tighter bound so a slow deployment cannot stack
full-length timeouts behind a best-effort affordance — and the `reveal`-failed
`log.debug` line is now `l10n.t()`-wrapped. Also folded in this clone's
dependency reconcile — `npm install` after `main` fast-forwarded onto Sean's
concurrent Phase 7b merge (React + ag-grid), which the stale `node_modules` was
missing — and a merge of `origin/main` (PR #153, Phase 7 data fixes) that
landed while #154 was in review.

- ☑ **`ContentAdapter.getParentOfItem`** — `GET` the item's `ancestors` link.
  Finding 6.12 pinned the shape: the link advertises
  `type: application/vnd.sas.content.folder.ancestor`, so the client sends the
  matching `Accept` and gets `{ childUri, ancestors: [<folder>…] }` with the
  immediate parent first — **not** the bare array `application/json` yields,
  which also `404`s (`errorCode 11519`) for a folder directly under the
  invisible root. `{ ok: true, value: undefined }` for no `ancestors` link, an
  empty `ancestors: []` (a folder under the SAS Content root), or a `204`
  (unknown `childUri`); `response-malformed` for a `200` with no `ancestors`
  array or a non-folder first entry. Finding 101's `406`/`{}` was the wrong
  `Accept` (`application/vnd.sas.collection+json`) — superseded by 6.12.
- ☑ **`SasContentTreeProvider.getParent`** — top-level nodes (synthetic root,
  delegate folders) return `undefined` without a request; a folder read
  directly (`type: "folder"`) with no ancestors is mapped back to
  `SAS_CONTENT_ROOT` rather than read as top-level; everything else asks the
  adapter, and a failure there is logged like a failed listing and stops the
  walk. **Node identity is unchanged** (still the service id — [ADR-0026], no
  ADR here): a rendered *member* carries its member-record id while an
  `ancestors` entry carries the folder's own id, so `reveal` selects precisely
  only where the two agree — a delegate, a root-listing folder, or a node taken
  straight from a fresh listing — and otherwise just expands the chain, which is
  what `reveal` is for. The re-key-by-resource-URI alternative was weighed and
  rejected (Sean, 2026-09-10) as an invariant change out of proportion to the
  gain.
- ☑ **Reveal wiring.** `contentExplorer.ts` builds a best-effort `reveal`
  (`{ select: true, focus: false, expand: true }`; `.reveal`'s rejection —
  usually the identity gap below — logged at `log.debug` then swallowed) and
  passes it to the 6c-i command deps and the 6c-ii controller. After a create,
  `revealCreated` re-lists the parent and matches the new node by `sameResource`
  (a new `vscode`-free `types.ts` helper — the create response's folder id vs
  the listing's member id disagree, but the underlying `/folders/folders/{id}`
  or `/files/files/{id}` both name agrees), falling back to the raw create
  response; the re-list runs after the cancellable progress has resolved so it
  carries its own `AbortSignal.timeout(8_000)`. After a move, the first moved
  member is revealed directly (its id is stable — finding 6.10). `run()` in
  `contentCommands.ts` became generic and returns its `{ result, aborted }` so
  `createChild` can act on a success without re-deciding what "succeeded" means.
- ☑ Tests: `content-adapter.test.ts` (+7 — `getParentOfItem` link-follow,
  empty-array, `204`, no-link, two `response-malformed` branches, passthrough);
  `content-types.test.ts` (+4 — `sameResource`); `tree.test.ts` (+7 —
  `getParent` for root/delegate/member (with a bounded-request
  assertion)/root-listing-folder/adapter-failure/no-adapter);
  `dragAndDrop.test.ts` (reveal-after-move, incl. the
  first-*successfully*-moved case). New fixture `ancestors-my-folder.json`
  (scrubbed `application/vnd.sas.content.folder.ancestor+json` body); new
  `contentNoBody()` test helper for the `204`.

☑ **6d — Favourites and recycle bin.** Both sub-slices merged. Split into two
sub-slices (Sean,
2026-09-10), mirroring the 6c-i/ii/iii pattern: **6d-i** favourites (add / remove
/ the `isInMyFavorites` marker), **6d-ii** the recycle bin (recycle / restore /
empty-bin / the read-only `sasContentReadOnly` scheme). The read-only probe pass
for both ran 2026-09-10 (findings 6.13–6.15, `verde`-only — the `innov` token had
expired again, the same gap findings 6.11/6.12 hit); Sean approved a scoped
mutating probe against a throwaway `.py` under My Folder, torn down under a
`trap`.

☑ **6d-i — Favourites.** Done and merged 2026-09-11 —
[PR #157](https://github.com/Shai-Alit/sas-py-vscode/pull/157), squash `652f3a8`.
Adversarial pass before the PR (no blocking findings). Codex/Claude PR review
raised five findings over two rounds, all folded in locally (one push each) —
see the "PR #157 review" bullet below; all threads resolved. Reconciled with the
7c-i data-viewer merge (#155) before merge — the only shared file was
`src/wire/viyaError.ts` (an additive `readViyaError` fallback, no content
behaviour change). `npm run verify` green (1531 unit after that merge; coverage
95.44 / 95.36 / 95.10 / 95.44), 331 integration, `npm run check:docs` green.

- ☑ **`ContentAdapter.addToFavorites` / `removeFromFavorites`** (finding 6.13).
  Add is `POST` the My Favorites folder's `addMember` link a
  `{uri, type:"reference", name, contentType}` body — a **reference** member, not
  a `child`. The My Favorites representation is fetched once and memoised (only
  its `addMember` link is read; a failed fetch is not cached). Remove is `DELETE`
  the reference member record at `item.favoriteUri` — **never** its
  `deleteResource` link, which on a reference addresses the underlying file
  (finding 6.13). `contentType` is omitted from the add body for a top-level
  root-listing folder that carries none (unprobed for that one case).
- ☑ **`getChildItems(parent, signal, { markFavorites })`** — a new opt. When set,
  a non-favourites folder expand also `GET`s `@myFavorites/members` (one extra
  small request) and stamps `isInMyFavorites` + `favoriteUri` on the children
  whose underlying resource is referenced there. Best-effort and additive: a
  favourites-service failure leaves the children unmarked rather than blanking
  the listing. The internal callers (`deleteFolder`, `revealCreated`) pass no
  opt and skip it. Expanding **My Favorites itself** marks every child directly
  from its own `delete` link — no second request. Not cached, so a favourite
  added/removed elsewhere shows on the next expand. Finding 6.13 settles
  Finding 80: `memberCount` reads a phantom `1` against an empty collection, so
  the members listing is the only authority. **Known tradeoff** (PR review,
  non-blocking): toggling one favourite triggers a full-tree reload, which
  re-issues the `@myFavorites/members` `GET` once per currently-expanded folder —
  redundant but correct; a short-lived per-refresh cache would remove the
  fan-out, deferred as speculative until measured to matter.
- ☑ **`ContentItem.isInMyFavorites` / `favoriteUri`** (synthetic, stamped by
  `getChildItems`); **`isFavoritesDelegate`** / **`FAVORITE_MEMBER_TYPE`**
  (`"reference"`) in `types.ts`.
- ☑ **`presentation.ts`** — a `favoriteAction: "add" | "remove" | "none"` on
  `NodePresentation`, and **two mutually exclusive state suffixes** on the
  `sasContent:folder` / `sasContent:file` `contextValue`: **`.fav`** for an
  already-favourited item (menu offers Remove, not Add) and **`.recycled`** for
  an item shown inside the Recycle Bin (`ContentItem.inRecycleBin`). This is the
  one place the otherwise-discrete `contextValue` set carries item state, so the
  content `when` clauses in `package.json` moved from `==` to `=~` on
  `$`-anchored patterns (`/^sasContent:(folder|file)(\.fav)?$/`). Because every
  such pattern is anchored, a `.recycled` item matches **none** of them —
  create, rename, delete and add/remove-favourite are all withheld from bin
  content (its own restore / permanent-delete actions are 6d-ii's). **This
  incidentally tightens the 6c-i menu**, which until 6d-i offered rename/delete
  on a Recycle Bin child — PR review finding (Codex, 2 × Major, one root cause:
  a bin child kept a bare `sasContent:folder`/`:file` value, so the new
  add-favourite command showed on it). The `favorite()` command handler also
  early-outs with a message when `item.inRecycleBin === true`, in case it is
  ever invoked programmatically.
- ☑ **Two flat commands** `pythonOnViya.addContentToFavorites` /
  `removeContentFromFavorites` in `contentCommands.ts` — no prompt, no confirm
  (a one-click reversible toggle); a full tree reload after, which re-marks every
  visible row. Hidden from the palette (`commandPalette`, `when:false`); menu
  group `5_favorites`.
- ☑ Tests: `content-adapter.test.ts` (`markFavorites` stamp / lookup-failure /
  opt-in / favourites-delegate branch incl. a `reference` folder staying
  navigable / `self`-link fallback; `addToFavorites` POST body / `contentType`
  omission / **re-fetch-every-call** / link-missing ×2 / `response-malformed` /
  passthrough; `removeFromFavorites` DELETE / link-missing / passthrough),
  `content-presentation.test.ts` (favourite-action matrix; a `.recycled` bin
  item; a `reference` folder/file browsed under My Favorites),
  `content-types.test.ts` (`isFavoritesDelegate` / `FAVORITE_MEMBER_TYPE`;
  `typeNameOf`/`isContainer` for a `reference` member),
  `test/integration/content/explorer.test.ts` (command + menu wiring; the 6c-i
  menu assertion relaxed for the `=~` form; every content `when` regex withholds
  a `.recycled` item; the `favorite()` bin early-out). New fixture
  `favorites-members.json`. `npm run verify` green (1506 unit; coverage 95.38
  lines / 95.29 branches / 95.07 functions / 95.38 statements), 321 integration
  passing; `npm run check:docs` green.
- ☑ **[PR #157](https://github.com/Shai-Alit/sas-py-vscode/pull/157) review —
  four findings folded in before merge.** Codex, round 1 (2 × Major, one root
  cause): a Recycle Bin child kept a bare `sasContent:folder`/`:file`
  `contextValue`, so the new add-favourite command showed on it → `.recycled`
  `contextValue` suffix (above) + an `inRecycleBin` early-out in `favorite()`,
  checked before the session since it is a fact about the clicked item. Round 2:
  **(blocking)** `favoritesFolder()` memoised the My Favorites representation —
  including its per-account `addMember` href — but a `ContentAdapter` is cached
  per *endpoint* and reused across profile switches, so one account's favourites
  could receive another's `addMember` (the 6b `sasContent:` ETag-guard bug
  class) → memoisation dropped, `@myFavorites` re-fetched every call, matching
  `favoriteRecordHrefs`' own policy. **(likely blocking)** `typeNameOf` /
  `isContainer` only special-cased `type: "child"`, so a favourite browsed
  *inside* My Favorites (wire `type: "reference"`, finding 6.13) read as a
  non-navigable leaf — a favourited folder could not expand, a favourited file
  could not open, both got a file icon and `sasContent:file` → `typeNameOf` now
  defers to `contentType` for `"reference"` too. **(minor)** the `favorite()`
  early-out had only indirect coverage → a direct integration check added.
- ☐ ~~Drag a folder/file onto My Favorites~~ — **not in 6d-i or 6d-ii.** A drop
  onto the My Favorites delegate already no-ops (`moveObjection` →
  `target-not-a-folder`); wiring it to `addToFavorites` is upstream parity but
  was never in either 6d slice's punch list. Tracked in
  [`phase-11.md`](phase-11.md) (added at the Phase 6→7/8 housekeeping
  checkpoint, 2026-09-10) rather than left unowned here.

☑ **6d-ii — Recycle bin.** Done and merged 2026-09-11 —
[PR #159](https://github.com/Shai-Alit/sas-py-vscode/pull/159), squash
`c6b7a70`. `npm run verify` green (1549 unit; coverage 95.49
lines / 95.40 branches / 95.18 functions / 95.49 statements), 333 integration
passing (VS Code env vars stripped, the `ELECTRON_RUN_AS_NODE` launch quirk),
`npm run check:docs` green. Probe: findings 6.14/6.15 re-confirmed read-only
against `verde` this session (the `/folders/` root's `recycleBin` + `PATCH`
`RecycleResource` relations, `@myRecycleBin`'s link set, every sampled bin
member carrying `previousParent` + `deleteResource` + `update`); `innov`
(2026.06) is **still single-cadence-unprobed** — the host does not resolve from
this machine even with the refreshed token — so 6d-ii ships on the same
single-cadence footing as 6.11–6.15, mitigated by both primitives it is built on
(`moveItem` finding 6.10, `deleteItem`/`deleteResource` finding 6.8) being
already confirmed on 2026.06.

**Delete is now recycle (documented-invariant change, Sean's call 2026-09-10;
recorded as [ADR-0030](../adr/0030-delete-recycles-content-items.md) at the
Phase 6→7/8 housekeeping checkpoint).**
"Delete" on an ordinary folder/file member moves it to the Recycle Bin with no
confirmation (Restore undoes it) — matching upstream. A permanent delete, behind
a modal, is reached only for an item that cannot be recycled: a top-level folder
read directly (no member record to move) or one already in the bin.
{@link isRecyclableMember} (`type === "child" && !inRecycleBin`) is the split.

- ☑ **`ContentAdapter.recycleItem` / `restoreItem` / `emptyRecycleBin`**
  (`src/content/adapter.ts`). Finding 6.14: recycle and restore are one generic
  move, no dedicated operation — both **reuse `moveItem`**. `recycleItem`
  resolves `@myRecycleBin` fresh (per account, never memoised — the
  `favoritesFolder` reasoning) and moves the member onto the bin's own `self`
  href. `restoreItem` reads the `previousParent` link already on the rendered
  item and moves back to it; `link-missing` (rel `previousParent`) when it is
  absent (Finding 81's rare case). `emptyRecycleBin` resolves `@myRecycleBin`,
  lists its tree-filtered members (a `report`/`job` in the bin is not listed, so
  not purged — matches upstream; clear those in SAS Studio), and runs
  `deleteItem` on each **sequentially, stopping at the first failure** —
  `deleteItem` already empties a recycled folder child-first (finding 6.8:
  `deleteRecursively` still `409`s on a non-folder child, and the probe this
  session confirmed a recycled folder member carries `deleteResource` but **no**
  `deleteRecursively`). No `If-Match` on any of it (finding 6.14).
- ☑ **`isRecyclableMember` / `isRestorable` / `RECYCLE_BIN_DELEGATE` /
  `PREVIOUS_PARENT_REL`** in `types.ts` (`vscode`-free, unit-tested).
- ☑ **`CONTEXT_RECYCLE_BIN` (`sasContent:recycleBin`)** split off the shared
  `sasContent:delegate` in `presentation.ts`, so "Empty Recycle Bin" targets the
  Recycle Bin delegate and nothing else. The `.recycled` `contextValue` suffix
  (added in 6d-i) is what Restore and the permanent-delete `deleteContentItem`
  key on; Rename / Create / favourites stay withheld from it (their anchored
  `=~` patterns already exclude `.recycled`).
- ☑ **Read-only recycle-bin view — no new provider class.** The existing
  `SasContentFileSystemProvider` is registered a **second time** under
  `sasContentReadOnly:` with `isReadonly: true` (`contentExplorer.ts`);
  `contentTree.ts` points a bin file leaf's `vscode.open` at that scheme
  (`contentReadOnlyUriString`, `src/content/uri.ts` — same query, shared
  `parseContentUri`). Deliberate deviation from the punch list's
  "`TextDocumentContentProvider`": a read-only `FileSystemProvider` registration
  gives a real `stat` (size, mtime) and byte-faithful `readFile` for free, the
  editor blocks edits so `writeFile` is unreachable, and it is one line instead
  of a class. Mirrors upstream's *intent*, per this repo's "read for what it
  does, not transcribe".
- ☑ **Commands.** `pythonOnViya.restoreContentItem` ("Restore", `when`
  `/^sasContent:(folder|file)\.recycled$/ && !listMultiSelection`, group
  `7_modify@0`) and `pythonOnViya.emptyRecycleBin` ("Empty Recycle Bin", `when`
  `viewItem == sasContent:recycleBin`), both hidden from the palette.
  `deleteContentItem`'s `when` gained `|\.recycled` so "Delete" also shows on a
  bin item (there it prompts and permanently deletes). `restore()` pre-checks
  `isRestorable` and says so rather than calling the adapter when there is no
  `previousParent`; `emptyBin()` confirms with a modal. Both go through the
  existing `run()` progress/abort/refresh wrapper.
- **Reviewed before the PR (independent-agent pass, 2026-09-10) — no blocking
  findings.** Verified: `isRecycleBinDelegate` ordered before the generic
  `isDelegateFolder` check in `contextValueFor` (`trashFolder` is also in
  `DELEGATE_FOLDER_TYPES`, so the order matters — has its own test);
  `favoriteActionFor` forces `"none"` for anything `inRecycleBin`, so `.fav`/
  `.recycled` can never collide; every new adapter method threads its
  `AbortSignal`, no swallowing catches. **One known-tradeoff flagged, not a
  finding**: `emptyRecycleBin` is sequential, no per-item progress text, no
  batching — cancellable and correct, but a bin with hundreds of members would
  take a couple of minutes. **Ship as-is (Sean, 2026-09-10)** — real bins are
  small (verde's had 17), and it matches the sequential pattern
  `deleteFolder`'s own recursion already uses; revisit only if a real bin size
  makes it a problem.
- **Known minor gap (deliberate):** a `sasContentReadOnly:` tab left open when
  its file is then restored or purged elsewhere is not force-refreshed or
  closed — upstream fires an `onDidChange` for the virtual URI; here the stale
  read-only tab is harmless (the file is reachable fresh from its restored
  location) and closing it automatically is not worth the plumbing. Revisit if
  it annoys anyone.
- ☑ **[PR #159](https://github.com/Shai-Alit/sas-py-vscode/pull/159) review —
  one finding, fixed before merge.** **Likely blocking**: `getChildItems`
  stamped `inRecycleBin` only on the Recycle Bin delegate's *direct* children
  — the doc comment even called descending into a recycled folder "a 6d
  concern" without saying which 6d slice would close it, and this was it. A
  file nested inside a recycled folder came back with `inRecycleBin` unset, so
  it opened through the ordinary editable `sasContent:` scheme (not
  read-only), its context menu offered Rename/Delete/Favourite instead of
  Restore, and "Delete" on it called `recycleItem` again — re-parenting it
  straight onto the bin's own root instead of doing anything sensible with an
  already-recycled item. Fixed: the stamping branch now also fires when
  `parent.inRecycleBin === true`, not only `isRecycleBinDelegate(parent)`, so
  the flag propagates to every depth. New test: "propagates inRecycleBin into
  a recycled folder's own children too". `npm run verify` re-run green (1550
  unit; coverage 95.49/95.44/95.18/95.49 — branch coverage improved), 333
  integration unchanged.
- ☑ Tests: `content-adapter.test.ts` (+13 — `recycleItem` resolve/move,
  never-cached, no-self, bin-resolve failure, malformed, move rejection;
  `restoreItem` previousParent move, `link-missing`, move failure;
  `emptyRecycleBin` folder-child-first + record tidy, empty bin, stop-at-first-
  failure, listing failure, bin-resolve failure), `content-types.test.ts` (+3 —
  `isRecycleBinDelegate` / `isRecyclableMember` / `isRestorable`),
  `content-presentation.test.ts` (Recycle Bin → `CONTEXT_RECYCLE_BIN`),
  `content-uri.test.ts` (`contentReadOnlyUriString`), `tree.test.ts` (recycled
  leaf → `sasContentReadOnly:` scheme), `explorer.test.ts` (rewrote the
  `.recycled`-withholding assertion for the delete/restore split; new 6d-ii
  command + menu wiring test). New fixtures `recycle-bin-members.json`,
  `member-restored.json`.

**Phase 6's first live manual pass — 2026-09-11 (Sean), `docs/dev/manual-test-pass.md`
§15–§16.** Landed inside a Phase 7c-ii fix branch rather than at Phase 6's own
close (no live UI pass had ever run for any of Phase 6 before this — every
prior verification was unit/integration tests, adversarial code-diff review,
or a `viya-api-probe` run against the wire, none of it a person clicking in a
live VS Code window). Reconciled here at the Phase 6→7/8 housekeeping
checkpoint. Every row through "Delete on an ordinary item recycles it
silently" (§15) and all of §16 (favourites, Recycle Bin) passed clean. Two
open items:

- ☑ **Drag-and-drop within the SAS Content tree — root cause found and
  fixed 2026-09-11, in a separate follow-up after this PR merged (finding
  6.16, Probe findings section below).** The investigation immediately
  below is preserved as it was recorded at the time, but two of its own
  conclusions are wrong and are corrected here rather than left standing:
  it is **not** true that "`handleDrop` firing in only one of roughly six
  real attempts" — `handleDrop` fired, and completed its own guard checks,
  on every real attempt. What varied was whether anything *movable* reached
  the `vscode.window.withProgress` call afterward: a self-rejected drop
  (nothing movable) returned early and logged cleanly; every drop with a
  real move to make reached the `withProgress` callback and threw there,
  which is why it looked like "no move, no error" rather than a visible
  failure — the throw landed in the DevTools console, not this extension's
  own output channel, so nothing in the normal diagnostic story below ever
  saw it. And it is **not** true that "root cause remains unknown" — the
  `resourceUri` hypothesis this bullet investigates was a red herring; drag
  *engagement* was never the problem, and neither the file-vs-folder
  pattern nor the mime-format/version/flakiness candidates ruled out below
  were ever the actual cause. See finding 6.16 for the real mechanism (a
  `CancellationToken` argument broken by VS Code's own extension-host RPC
  marshalling) and ADR-0031's second amendment for how this reframes that
  ADR's own question. ADR-0031's `resourceUri` change itself is unaffected
  by any of this — it was never the fix, and is kept on its own narrower,
  already-stated merits (upstream parity, the folder tooltip).

  Confirmed against a
  build rebuilt fresh from `main` (ruling out a stale `.vsix` as the cause).
  Diagnostic logging added to `handleDrag`/`handleDrop` (kept — see that
  file's own doc comment) showed `handleDrag` firing reliably on every
  attempt, and (per the correction above) `handleDrop` firing reliably on
  every attempt too — across several target folders (My Folder, Demo, Guest,
  and nested combinations), the one attempt that produced no error was a
  self-referential drop (a file dropped back onto its own current folder),
  correctly recognised and rejected via `moveObjection`'s `already-there`
  case before reaching the code that threw.

  A throwaway two-view test extension
  (`application/vnd.code.tree.<id>` vs. a private custom mime type, exactly
  mirroring `contentDragAndDrop.ts`'s own approach) isolated the cause by
  elimination: `handleDrop` fired 4-for-4 in the test extension, both mime
  formats, including a drop on a nested child row — ruling out the
  installed `@types/vscode`/VS Code version, general Electron drag
  flakiness, MIME-type-format choice, and nesting depth. A mime-format swap
  on the real controller (matching upstream's own "recommended"
  `application/vnd.code.tree.<treeidlowercase>` convention) was tried live,
  twice, and changed nothing — reverted.

  A further live test then showed the real pattern: `handleDrop` fired
  reliably for every **file** target and almost never for a **folder**
  target. Comparing against `vscode-sas-extension`'s own `ContentDataProvider`
  (confirmed by Sean to drag reliably, live, in this exact environment)
  found the cause — it sets `TreeItem.resourceUri` on every item
  unconditionally; `contentTree.ts` only set one on an openable file leaf,
  never on a folder. **Fixed** ([ADR-0031](../adr/0031-content-folder-resource-uri.md)):
  every item with a resolvable resource href now gets a `resourceUri` — a
  folder's points at a new, inert `sasContentFolder:` scheme
  (`src/content/uri.ts`, never registered with a `FileSystemProvider`, no
  `command` attached) purely for identity. **Separately confirmed, live,
  before this fix was written**: the underlying move capability was never
  broken — a right-click Cut/Paste diagnostic (reusing `ContentAdapter.moveItem` /
  `moveObjection` directly, bypassing VS Code's drag machinery entirely)
  moved a real file three times live (`Demo → tst`, `tst → My Folder`,
  `My Folder → Demo`), all clean, before ADR-0031's fix even existed —
  proof the defect was entirely in how VS Code delivered (or didn't
  deliver) the native drag gesture, never in this project's own adapter or
  wire logic. **Formalised as a permanent right-click alternative
  regardless** ([ADR-0032](../adr/0032-content-cut-paste.md)) — see the 6e
  entry below. `npx tsc --noEmit`, `eslint`, and `npm run verify` all green
  on the fix, but **the live retest (rebuild, reinstall, reload, drag),
  2026-09-11, found the identical failure as before the fix** — same
  symptoms, same lack of pattern by target. The `resourceUri` hypothesis is
  therefore not confirmed as the actual cause (or is at most one factor
  among others); see ADR-0031's amendment. At the time this was written,
  the next step for whoever picked this up was VS Code's own Developer
  Tools console during a live drop, since everything tried so far (mime
  format, `@types/vscode` version, Electron drag flakiness, nesting depth,
  the missing-`resourceUri` hypothesis) had been ruled out or shown
  insufficient. **That is exactly what found it**: a Phase 7 session opened
  DevTools during a live drop and found `ERR
  o.onCancellationRequested is not a function` at `handleDrop` — see finding
  6.16 for the full trace and the fix, applied on
  `fix/content-drag-drop-cancellation-token` after this PR had already
  merged.
- ☐ **(known gap, deferred) The top-level-folder permanent-delete
  confirmation cannot be live-exercised on the available deployment.** The
  Phase 6→7/8 housekeeping checkpoint previously recorded the original
  "no permission on the tested deployment" finding as wrong, reasoning from
  Sean's own admin rights — **that correction was itself mistaken and is
  retracted here.** Sean has since clarified directly: this has nothing to
  do with account privilege. Deleting a folder that sits directly under SAS
  Content is restricted by a Viya deployment-level configuration set at
  install/admin-config time, independent of the requesting user's own
  permissions — an administrator account does not bypass it. The original
  §15 finding was correct; the housekeeping checkpoint's "that reason was
  wrong" note was the actual error, not the finding it was correcting.
  **Deferred, not blocking**: live confirmation needs either a deployment
  configured to allow it or a different test environment, neither available
  now. Unit- and integration-tested (`content-adapter.test.ts`,
  `explorer.test.ts`) — `isRecyclableMember`'s `false` branch and the
  permanent-delete modal it drives are exercised there — so this is a live
  human-in-the-loop confirmation gap only, not an untested code path.

**Drag-and-drop's own ambiguity, and Cut/Paste (Sean, 2026-09-11, said
directly in this session — not the earlier pattern of unconfirmed
attributions elsewhere in this file).** Even if the native gesture is ever
fixed, dragging a tree item onto a folder never tells the user whether it
will move or copy — a real, independent UX gap. Sean's own words: this
should have been ahead of drag-and-drop on the original list. Decided:
formalise Cut/Paste (move only — Copy is a separate, unprobed question, see
`phase-11.md`) as a permanent, shipped feature, not just a diagnostic — see
the 6e entry below and [ADR-0032](../adr/0032-content-cut-paste.md). Now
that drag-and-drop itself remains broken after a real fix attempt,
Cut/Paste is not just the more honest interaction — it's the only one that
actually works.

☑ **6e — right-click Cut/Paste ships (ADR-0032); the folder `resourceUri`
change ships too (ADR-0031) but does not fix drag-and-drop, which stays
broken and is tracked separately.** *(Superseded 2026-09-11, same day, by a
follow-up fix — drag-and-drop's real root cause was found and fixed after
this PR merged; see the dated entry below and finding 6.16.)*
**Merged 2026-09-11** as [PR #162](https://github.com/Shai-Alit/sas-py-vscode/pull/162),
squash `a74f756`. Both landed together at the Phase 6→7/8 housekeeping
checkpoint, discovered while live-testing 6c-ii's drag-and-drop; see the two
entries above for the investigation and its outcome.

- ☑ `src/content/uri.ts` gains `CONTENT_FOLDER_SCHEME` (`sasContentFolder:`)
  and `contentFolderUriString`, alongside the existing `CONTENT_SCHEME` /
  `CONTENT_READONLY_SCHEME` pair — inert, identity-only, never registered
  with a `FileSystemProvider`.
- ☑ `src/content/contentTree.ts`'s `getTreeItem` now gives every item with a
  resolvable resource href a `resourceUri` — an openable file leaf keeps its
  existing `sasContent:` / `sasContentReadOnly:` URI and `vscode.open`
  command unchanged; a folder (or delegate) gets the new
  `sasContentFolder:` identity URI and no command.
- ☑ `src/content/contentDragAndDrop.ts`'s `handleDrag`/`handleDrop` keep the
  per-attempt debug logging added during the investigation (every early
  return now logs why) — a genuine, permanent diagnosability improvement,
  not leftover debugging. The mime-format swap tried and live-tested during
  the investigation was reverted; it changed nothing.
- ☑ `src/content/contentCommands.ts` gains `pythonOnViya.cutContentItem` /
  `pythonOnViya.pasteContentItem` (6e) alongside the existing eight content
  commands. Cut records the clicked item (one at a time, module-level
  state); Paste calls the same `moveObjection` / `ContentAdapter.moveItem`
  `contentDragAndDrop.ts` calls, so there is exactly one implementation of
  "is this move valid" and "how do you do it," reached two ways. An invalid
  paste shows a plain-English reason (`describeMoveObjection`) rather than
  staying silent the way a missed drag does. Menu-gated like every other
  content command: Cut on an ordinary/favourited folder/file (never
  recycled, never during a multi-selection); Paste on a folder-shaped
  target, only once something is actually cut
  (`pythonOnViya.hasCutContentItem`). No visual "what's cut" indicator —
  considered and deferred as polish, not a defect (ADR-0032).
- ☑ `package.json` / `package.nls.json`: two new commands (`command.cutContentItem.title` /
  `command.pasteContentItem.title`), palette-hidden like the rest, two new
  `view/item/context` entries. `docs/reference/commands.md` regenerated
  (`npm run docs:reference`); `l10n/bundle.l10n.json` re-extracted
  (`npm run l10n:extract`).
- ☑ Tests: `content-uri.test.ts` (+1 — `contentFolderUriString`, matching
  the existing `contentReadOnlyUriString` test shape), `tree.test.ts` (+2 —
  a folder gets a `sasContentFolder:` `resourceUri` with no command; a
  folder with no resolvable href or no active deployment stays inert,
  mirroring the existing file-leaf tests), `explorer.test.ts` (+3 — cut
  early-outs on a Recycle Bin item without throwing, matching the
  favourites early-out precedent; registers the two 6e commands and wires
  their menu; both added to the existing "does nothing catastrophic with no
  argument" and `.recycled`-withholding loops rather than duplicating them),
  and a new `cutPaste.test.ts` (+11 — `cut`/`paste` exported and exercised
  directly against a stub `ContentCommandDeps`, the same pattern
  `dragAndDrop.test.ts` uses: the happy path end to end, "nothing has been
  cut yet", each of `moveObjection`'s four paste-reachable rejection
  reasons — `not-a-member` is prevented earlier, at `cut()` time, and tested
  there instead — "no address to move into", the cross-endpoint refusal,
  and a failed move restoring the cut rather than consuming it).
- **No live probe needed.** `ContentAdapter.moveItem`'s wire shape is
  already probed and shipped (finding 6.10, 6c-ii) and unchanged here; the
  `resourceUri` fix is a pure VS Code client-side rendering concern with no
  new wire behaviour. Confirmed against `vscode-sas-extension`'s source
  (`C:\Users\seford\git\GitHub\vscode-sas-extension`, read for what it does,
  not transcribed — matching this project's own standing rule).
- **Adversarial pass run before any push, one real blocking finding and one
  real test-coverage gap, both folded in locally in one pass (no PR opened
  yet, per this project's standing rule).** Blocking: the cut slot was
  module-level with no endpoint scoping and no clear on a profile switch or
  sign-out — cutting on deployment A and pasting after switching to B would
  have run `moveItem` against B's adapter with A's item link. Fixed:
  `ContentCommandDeps` gains `activeEndpoint`; the cut slot now records
  `{ item, endpoint }`; `paste` refuses a cross-endpoint paste by name;
  `clearCutContentItem` (new export) is called from `contentExplorer.ts`'s
  profile-change, session-change, and sign-out handlers. Same pass also
  fixed two related medium findings while touching this code: `paste` now
  clears the slot *before* the move runs rather than after, restoring it
  only on failure — closing both a double-paste race (a second Paste fired
  while the first is still in flight) and a succeeded-then-cancelled race
  (`result.ok && aborted`) that previously left a stale cut armed either
  way. `describeMoveObjection` was rewritten from five sentence fragments
  interpolated into one shared template into five complete, independently
  translatable messages. Minor findings folded in too: `MoveObjection`
  imported by name instead of `NonNullable<ReturnType<typeof moveObjection>>`;
  `cut()` now rejects a non-member item at cut time instead of only
  discovering it at paste time; the drag-and-drop punch-list tick above was
  demoted from ☑ to ☐ (root cause found and fixed in source is not the same
  claim as confirmed live); the "turned out to need" phrasing in
  `contentTree.ts`/`uri.ts` was reworded to match ADR-0031's own careful
  "one concrete, confirmed structural difference, correlational, not
  verified against VS Code's own source"; ADR-0031 gained a Consequences
  note about the auto-derived tooltip a folder's new `resourceUri` produces
  as a side effect; `cutPaste.test.ts` exports and resets module state via
  `afterEach(clearCutContentItem)` so no test leaks a pending cut into the
  next. STATUS.md's Phase 6 row also had a real self-contradiction fixed
  (it opened "all slices merged" while its own ending said 6e was unmerged
  and holding housekeeping open).
- `npm run verify` green (1580 unit passing; coverage 95.57 statements /
  95.51 branches / 95.26 functions / 95.57 lines — `src/content/uri.ts` at
  100/100/100/100); `npm run test:integration` green (368 passing);
  `npm run check:docs` and `npm run check:secrets` both green.
- **Live retest, 2026-09-11 (Sean), against [PR #162](https://github.com/Shai-Alit/sas-py-vscode/pull/162)'s branch:**
  Cut/Paste under its final command names confirmed working (it had already
  been live-tested once under the diagnostic's temporary command names,
  before this PR existed — `Demo → tst`, `tst → My Folder`,
  `My Folder → Demo`, all clean; the rename to
  `pythonOnViya.cutContentItem`/`pasteContentItem` changed nothing
  functionally and this pass confirms it). **Drag-and-drop itself: retested
  and still completely non-functional, identical symptoms to the original
  report** — see the dedicated entry above and ADR-0031's amendment. (This
  was the last confirmed-broken state before the real root cause was found;
  see the dated follow-up entry below and finding 6.16.) **Sean's
  call: this does not block the PR** — Cut/Paste is the real, working
  interaction model, and the drag-and-drop investigation is tracked as a
  follow-up in `phase-11.md` rather than held against this slice. The
  endpoint-scoping fix itself (cutting on one deployment, pasting after a
  profile switch) has not been separately live-exercised — covered by
  `cutPaste.test.ts` but not by a human switching real profiles — noted as
  a gap for whoever next touches multi-profile Cut/Paste, not a blocker.
- **Two further review rounds on the open PR, each one real finding, both
  fixed with a follow-up commit + a regression test, no PR re-opened:**
  automated review of the pushed branch found a genuine race the pre-push
  pass's own clear-before-move fix hadn't covered — `paste()`'s
  failure-restore checked only `cutState === undefined`, so a `cut()` of a
  *different* item while a failing move was still in flight got silently
  overwritten by the stale restore. **Fixed** (commit `716ae27`): the
  restore now runs only when the slot is still empty; a new integration
  test races a real in-flight `cut()` against a rejected move. A second
  review round on that same commit found the fix itself was incomplete —
  `cutState === undefined` also can't distinguish "nothing has touched the
  slot" from "something intentionally cleared it" (`clearCutContentItem`
  from a profile switch or sign-out, firing while the same move is in
  flight), so a late failure could still resurrect a cut an intentional
  clear had just removed. **Fixed** (commit `1563bd3`): `setCutState` now
  bumps a module-level `cutGeneration` counter on every call, including a
  clear; `paste()` captures the generation right after its own clear and
  restores `pending` only if the generation is unchanged, so any
  intervening `cut()` *or* `clearCutContentItem()` — deliberate or not — is
  respected. `npm run verify` green after each fix (lint clean, coverage
  unchanged); `npm run test:integration` green (370 passing after the
  second fix, all 13 Cut/Paste cases). Both threads replied to inline and
  resolved. **Merged 2026-09-11** — no other findings on either automated
  reviewer.

☑ **Drag-and-drop: real root cause found and fixed, 2026-09-11 — a separate
follow-up after 6e merged, from a Phase 7 session working in the
`sas-py-vscode-cowork` clone (that branch never touched `src/content/`, so
this landed cleanly against `main` with no conflict risk).**
[PR #164](https://github.com/Shai-Alit/sas-py-vscode/pull/164) opened
2026-09-11 on `fix/content-drag-drop-cancellation-token`. VS Code's own
DevTools console — the one avenue ADR-0031's own investigation never
reached, per its final "Next, for whoever picks this up" note above — showed
the real failure on a live drop: `ERR o.onCancellationRequested is not a
function` at `contentDragAndDrop.ts`'s `handleDrop`. `handleDrop` had been
firing correctly on every real attempt all along; it threw before doing any
move whenever something was actually movable, which is why every retest
above saw "no progress, no error, no move" instead of a visible failure —
the throw lands in the browser DevTools console, not this extension's own
output channel, so nothing in the diagnostic story above (the debug logging,
the throwaway test extension, the `resourceUri` comparison) was ever in a
position to see it.

Traced to VS Code 1.109 source (read for what it does, matching this
project's own standing rule — not transcribed from training data): `handleDrop`'s
third parameter, the tree view's own `CancellationToken`, crosses the
extension-host RPC boundary in a non-final argument position
(`mainThreadTreeViews.ts`'s `$handleDrop` puts it fifth of eight), so
`rpcProtocol.ts`'s "pop a trailing cancellation token" marshalling — which
only ever inspects the *last* argument — never intercepts it. It is instead
serialized as plain JSON like any other argument, which strips
`MutableToken`'s two prototype-getter properties
(`isCancellationRequested`/`onCancellationRequested` are getters, not own
fields, so `JSON.stringify` drops them); the extension host receives a bare
`{ _isCancelled: false, _emitter: null }` object. Recorded as **finding
6.16** below — this is measured VS Code behaviour, not Viya wire behaviour,
so the usual `viya-api-probe` order doesn't apply; it is instead read
directly from VS Code's own source, the way `vscode-sas-extension` comparisons
elsewhere in this project are.

**Fixed** in `src/content/contentDragAndDrop.ts`'s `handleDrop`: the
`token.onCancellationRequested(...)` subscription is removed outright rather
than guarded, since a guard would leave the tree view's own cancel affordance
silently inert — `progressToken` (built locally in the extension host by
`extHostProgress.ts`, so it never crosses RPC) is the only cancellation
source this code can actually rely on, and it already covers the one
cancellation affordance the user sees (the progress notification's own
Cancel button). `token.isCancellationRequested` stays in the `cancelled()`
poll — harmless (it reads `undefined`, falsy) and correct if VS Code ever
fixes the marshalling. A new regression test
(`test/integration/content/dragAndDrop.test.ts`) drives `handleDrop` with a
token shaped exactly like the real broken one (`{ isCancellationRequested:
undefined }`, no `onCancellationRequested` method at all) and asserts the
move completes rather than throwing. `contentDragAndDrop.ts`'s own doc
comment and the `CONTENT_MIME` comment (which had attributed the cause to
the missing `resourceUri`) are corrected to point at this finding instead.

**Two more claims from the investigation above are corrected in place**
rather than left standing: "`handleDrop` firing in only one of
roughly six real attempts" is wrong — it fired every time, and the one
attempt that produced no error was a self-rejected drop that never reached
the throwing code, not a successful move. "Root cause remains unknown" /
"disproven, root cause unknown" (ADR-0031's amendment) is superseded — the
cause is now known, and it was never about drag engagement or the
file-vs-folder pattern that investigation chased; see ADR-0031's second
amendment. Everything else that investigation ruled out (VS Code version,
Electron drag flakiness, mime-type format, nesting depth) is unaffected and
still correctly ruled out — none of those were ever the cause either.

`phase-11.md`'s tracked follow-up ("Drag-and-drop within the SAS Content
tree remains completely non-functional — root cause unknown") is now closed
— see that file. `npm run verify` green (1580 unit passing, coverage
unchanged at 95.57/95.51/95.26/95.57 — the fix and its regression test both
live in files this project's coverage gate excludes, matching every other
`vscode`-shell file in `src/content/`); `npm run test:integration` green
(371 passing, +1 — the new regression test above); `npm run
check:docs` green. **Adversarial pass handed to the developer before any
push, per this project's standing rule** (this changes source and corrects
a documented invariant, ADR-0031) — **no blocking findings.** The reviewer
independently re-derived the VS Code 1.109 RPC-marshalling mechanism against
that version's own source (`mainThreadTreeViews.ts`, `rpcProtocol.ts`,
`cancellation.ts`, `extHostTreeViews.ts`) rather than taking the write-up's
word for it, confirmed the two "unaffected call sites" claim
(`contentCommands.ts:670`, `run/commands.ts:546` both subscribe to a
host-local `withProgress` token, never marshalled across RPC), confirmed the
regression test reproduces the real broken-token shape without copying the
logic under test, and confirmed the coverage-exclusion claim against
`.c8rc.json`. One non-blocking observation, since resolved (below): the live
Extension Development Host retest was still outstanding at review time.

**Third live pass, 2026-09-11 (Sean), against this fix:** the "(known gap)
Dragging an item onto a folder moves it" row in `manual-test-pass.md` §15,
which failed identically on both the original report and the ADR-0031
`resourceUri` fix attempt, now **passes** — a real move, progress
notification, auto-reveal, all as originally specified, with a clean
DevTools console. Every other §15 row that had been blocked on the base
drag gesture working — multi-item drag, drag onto My Favorites/the Recycle
Bin (no-op), drag onto self/current folder (no-op), and multi-select hiding
the single-item context actions — was retested the same session and also
passes; see `manual-test-pass.md`'s own §15 for the row-by-row account.
Drag-and-drop is now confirmed fixed, not merely fixed in source. The one
remaining §15 gap (the top-level-folder permanent-delete confirmation) is
unrelated to drag-and-drop — a Viya deployment-level configuration, already
recorded as a documented, deferred known gap above — and stays open.

**[PR #164](https://github.com/Shai-Alit/sas-py-vscode/pull/164) opened
2026-09-11.** Automated review found one real issue, fixed on the branch
before merge: the fix as first pushed dropped the `token.onCancellationRequested`
subscription outright rather than gating it, which meant the tree view's own
cancel affordance would stay dead forever even if VS Code fixes the
underlying RPC bug someday — the code had no way to notice and start using a
well-formed token again. **Fixed**: `handleDrop` now checks `typeof
token.onCancellationRequested === "function"` and only subscribes when it is
actually callable, logging once per controller instance (not once per drop)
when it isn't; `progressToken` stays unconditionally subscribed to
regardless, so today's only real cancellation affordance is unaffected
either way. A new regression test confirms a well-formed
`vscode.CancellationTokenSource`'s token still gets subscribed to and still
aborts an in-flight move — the fix degrades conditionally now, rather than
permanently removing a capability a future VS Code fix would otherwise
restore automatically. Also folded in from that same review round: a
long-stale `CHANGELOG.md` line claiming "moving content… [is] a later
release," true when the SAS Content explorer first shipped but wrong since
6e's Cut/Paste and now doubly wrong with drag-and-drop fixed — split into
its own entry. `npm run verify`/`test:integration`/`check:docs` re-run green
after both fixes.

The stale/duplicate copy of §15–§16 this branch's merge into `main` produced
(the same section content inserted at two different points by two diverging
branches, which a 3-way merge does not deduplicate) was found and removed at
this checkpoint — `docs/dev/manual-test-pass.md` now carries one copy of
each, matching what was actually run.

---

## Probe findings

All probes below ran 2026-09-03 against `verde` (Viya 4), read-only
(`GET` only — no mutating probe was run or needed this session), via the
`viya-api-probe` skill. Continuing this project's global finding numbering
from Finding 77 (`phase-5.md`).

**Finding 78 — the four delegate folders resolve exactly as upstream's
client expects, plus one relation upstream never uses.**
`GET /folders/folders/@myFavorites`, `@myRecycleBin`, and `@myFolder` each
returned `200` with `type` (`favoritesFolder`/`trashFolder`/`myFolder`) and
the link set `RestContentAdapter.ts` reads: `self`, `delete`,
`deleteRecursively`, `members`, `addMember`, `up`, `ancestors`,
`createChild`, `validateNewMemberName` — plus `transferExport`/
`transferImportUpdate`/`transferImport` (a folder import/export mechanism
outside this phase's scope; not something upstream's client reads either).
Filtering "My Folder"'s members to `in(contentType,'file','dataFlow')`
returned real files (`test.sas`, `Python.py`, `AzureSaaSUsage.xlsx`,
`baseball_analysis.sas`, …) each carrying `getResource`/`putResource`/
`deleteResource`/`update`/`delete`/`ancestors`/`validateRename` — the exact
set `renameItem`/`deleteItem`/`updateContentOfItem` depend on. **New,
unused-by-upstream relation observed on the Folders service root
(`GET /folders/`):** a `PATCH` `RecycleResource` link,
`/folders/folders/@item?childUri={resourceUri}&parentFolderUri=/folders/folders/@myRecycleBin`.
Upstream's `recycleItem` instead does a `PUT`-based `moveItem` to the
recycle bin's own URI. Not yet tested which is actually simpler or more
correct on Viya 4 — flagged for 6d, not resolved here.

**Finding 79 — this deployment's generic type lookup already resolves
`.py`, with no special case needed.**
`GET /types/types?filter=contains('extensions','py')` returns exactly one
item: `name: "file_py"`, `label: "Python code"`,
`mediaType: "application/x-python"`, `resourceUri: "/files/files"`. The
equivalent query for `sas` returns `programFile` as expected (sanity check
against upstream's hardcoded special case). Since upstream's own
`getTypeDefinition` only special-cases `.sas` and falls back to this generic
lookup for everything else, **the same fallback path already does the right
thing for `.py` here, unmodified**. Confirmed on one cadence only — see 6a's
punch-list item for a second-cadence check before depending on it.

**Finding 80 — a live favorites-count discrepancy, not yet root-caused.**
The `@myFavorites` delegate folder's own representation reports
`memberCount: 1`. An unfiltered `GET` of that folder's `members` endpoint
returned `count: 0, items: []` in the same session. Not yet explained —
candidates include a permissions-filtered reference, a stale cached count, or
a favorited object whose own type is excluded by a default query — and not
asserted as a defect. Flagged for 6d's own probe pass before any UI decision
depends on `memberCount` matching the members collection.

**Finding 81 — restore is not uniformly available across recycled items.**
Of three sampled `@myRecycleBin` members (a folder and two reports), two
carried a `previousParent` link (the relation `restoreItem` requires) and one
did not. Confirms upstream's own `restoreItem` fallback (`return false` when
`previousParent` is absent) is exercised by real, observed deployment state on
Viya 4 — not just defensive code carried over unexamined. Not yet determined
what distinguishes the two cases (age of the recycled item, the type of the
underlying resource, or something else).

**Finding 82 — the SAS-Content root's own items carry no `uri`, only a
`self` link.**
`GET /folders/folders?filter=isNull(parent)&limit=5` (the query the client
constructs for the top-level "SAS Content" pseudo-root) returned items with
`uri: null` and `contentType: null` — only `name`, `type: "folder"`, and
(unprinted here) a `links` array. This confirms `getResourceIdFromItem`'s
fallback to a `self` link, documented upstream only as "Only members have
`uri` attribute," is load-bearing for the very first root the tree renders,
not a defensive branch for an edge case that never occurs.

---

_Findings 97–101 ran 2026-09-09 against `verde` (Viya 4), read-only (`GET`
only), via the `viya-api-probe` skill, to build 6a-ii's fixtures from a
current capture and reconfirm findings 78/82 before depending on them. They
take numbers 97+ because the global sequence had reached Finding 96 by then
(Phase 5→6 housekeeping used 93–94, Phase 7's library probes 83–86 and
95–96)._

**Finding 97 — the delegate folders resolve as finding 78 recorded, and a bad
delegate name is a 400.**
`GET /folders/folders/@myFolder`, `@myFavorites`, `@myRecycleBin` each
returned `200` as `application/vnd.sas.content.folder+json` **with no `Accept`
header needed**, `type` of `myFolder` / `favoritesFolder` / `trashFolder`, and
the link set `self`, `members` (`type: application/vnd.sas.collection`),
`addMember`, `up`, `ancestors`, `createChild`, `validateNewMemberName`,
`delete`, `deleteRecursively`, `transferExport`/`transferImportUpdate`/
`transferImport`. Delegate folders carry **no** `update`, `validateRename` or
`getResource` — those appear on ordinary folders and on member records, not on
a delegate. `GET /folders/folders/@notAThing` → **400**, not 404.

**Finding 98 — the `isNull(parent)` root listing: full folder representations,
`uri` and `contentType` simply absent.**
`GET /folders/folders?filter=isNull(parent)&limit=5` → `200`
`application/vnd.sas.collection+json`, envelope `{ version, accept, start,
limit, count, name, items, links }` with `count` **populated** (14 on this
deployment — not the `null` the generic collection-count warning describes).
Each item is a full folder representation: `type: "folder"`, a `self` link
(`/folders/folders/{id}`) plus `members`, `update`, `validateRename`,
`createChild`, `ancestors`, timestamps, `memberCount`, `iconUri` — but the
`uri` and `contentType` **keys are not present at all** (not `null`). Reading
the address therefore *must* fall back to the `self` link, confirming
finding 82. `and(isNull(parent),in(type,'file','dataFlow','folder',…))` also
returns `200` — the combined filter 6a-ii composes for the root works.

**Finding 99 — folder member listing: `type: "child"` records, kind in
`contentType`, and no `members` link on a folder member.**
`GET /folders/folders/{id}/members?limit=N&filter=in(contentType,'file',
'folder','dataFlow')` → `application/vnd.sas.collection+json`. Every item has
`type: "child"`; `contentType` is `folder` or `file` and is what says whether
the tree can descend. A member's `uri` points at the underlying resource —
`/folders/folders/{id}` for a folder, `/files/files/{id}` for a file — and
`parentFolderUri` is present. A `.py` file member carries `typeDefName:
"file_py"` **inline** (a `.sas` file: `typeDefName: "file"`). Member link set:
`self` (the member record, `/folders/folders/{parent}/members/{memberId}`),
`getResource`/`putResource`/`deleteResource` (the underlying resource),
`update`/`delete` (the member), `up`, `ancestors`, `validateRename`,
`transfer*`; a folder member additionally has `addMember`, `createChild`,
`validateNewMemberName`. **A folder member has no `members` link** — to list
its children, compose `${member.uri}/members` (upstream does the same). The
collection's own links are `self` and `createMember` only; a 38-member folder
came back whole with no `next`, so pagination past `limit` is still unprobed
(6a-ii keeps upstream's `limit=1000000`).

**Finding 100 — `Accept` sensitivity, and the error envelope on a real miss.**
Sending `Accept: application/vnd.sas.error+json` on a folder `GET` → **406
Not Acceptable**, with an envelope listing the types the endpoint *will*
serve. Sending no `Accept`, or `application/json`, returns the default
representation. A genuine miss — `GET /folders/folders/{unknown-guid}` with a
valid `Accept` — → **404** `application/vnd.sas.error+json;charset=utf-8;
version=2`, body `{ version, httpStatusCode: 404, errorCode: 11500, message,
details: ["path: …", "correlator: …"] }` — the finding-17 envelope
`src/wire/viyaError.ts` already reads. So `src/content/client.ts` sends only
the link-derived `Accept` (or none) and reads the error envelope from
whatever body a non-2xx carries, exactly as `src/compute/client.ts` does.

**Finding 101 — `ancestors` shape not pinned; `getParent` deferred to 6c.**
`GET /folders/ancestors?childUri=…` (the `ancestors` relation) answered **406**
under `Accept: application/vnd.sas.collection+json` and, under `Accept:
application/json`, returned an **empty object `{}`** for a file directly under
My Folder — not the array upstream's `getParentOfItem` iterates. Neither 6a-ii
nor 6b implements `getParent` (only `TreeView.reveal` needs it, and nothing
reveals in a browse/open/save flow), so this is left for 6c to pin with its own
probe when `reveal` is actually wired — see the 6b Runbook block.

**Not probed this session, left open:** the Files service's `rawUpload`
`POST` (file creation) — a mutating call, out of scope for a read-only
scoping pass per this project's own probe-safety rule; the folder/file
rename-validation `PUT` endpoints; and the `RecycleResource` `PATCH`
relation Finding 78 turned up. All three are 6a/6c/6d implementation-time
probes, not settled here.

---

### Numbering changed here: `phase.n` from now on

Findings **1–101 keep their flat global numbers** (this file's 78–82 and
97–101 among them — do not renumber them). From 6b onward a new Phase 6
finding is **`6.n`**, counting from 1, and Phase 7's are **`7.n`** — so two
branches working different phases in parallel can never claim the same number.
Cite an earlier finding in whatever form it carries (`finding 82`,
`finding 6.1`). Settled with Sean 2026-09-09; see `CLAUDE.md` and `STATUS.md`.

_Findings 6.1–6.2 ran 2026-09-09 against `verde` (Viya 4) via the
`viya-api-probe` skill, for 6b's open/save path. Read probes (`GET`/`HEAD`)
were run directly; the write probes (`POST` create, `PUT .../content`) ran
against a single throwaway file resource created by `POST /files/files`, never
linked into any folder, and `DELETE`d in the same shell (`GET` after ⇒ `404`).
Sean approved the mutating run._

**Finding 6.1 — a file resource carries its own `content` / `updateContent`
relations; the ETag and Last-Modified are headers, not body.**
`GET /files/files/{id}` (default `Accept`, or `application/vnd.sas.file+json` —
`application/json` also works) → `200`
`application/vnd.sas.file+json;version=1`, with `ETag` (a short quoted opaque
token, e.g. `"mtugx7s6"` — no `W/` prefix) and `Last-Modified` as **response
headers**, never in the JSON. Body fields the adapter reads: `size`,
`creationTimeStamp`, `modifiedTimeStamp`; also present `name`, `encoding`,
`contentType` (`"application/x-python; charset=UTF-8"` for a `.py`),
`typeDefName` (`file_py`). The `links` array carries `self`, `alternate`
(`application/vnd.sas.summary`), `patch`, `update` (metadata `PUT`), `delete`,
**`content`** (`GET` → `/files/files/{id}/content`), **`updateContent`** (`PUT`
→ `/files/files/{id}/content`, `type: */*`), `copyFile`, `create`. So the
tree *member*'s `getResource` (finding 99) points only at the bare resource,
but the resource representation itself blesses `${self}/content` for both read
and write — 6b composes that suffix rather than spend the round trip, the same
trade `${uri}/members` already makes.
`GET /files/files/{id}/content` → `200`, `Content-Type`
`application/x-python;charset=UTF-8`, the **same `ETag`/`Last-Modified`** as the
resource, plus `Content-Disposition: attachment; filename="…"` and
`Content-Length`. **`HEAD` on `…/content`** returns those same three headers
with no body. 6b does not use it — the write path carries the `ETag` from the
`readFile` that filled the editor rather than re-fetch one — but it is noted as
a cheap way for a later slice to check an `ETag` without pulling content.

**Finding 6.2 — `PUT .../content` is a strict optimistic-concurrency endpoint;
content-type is not validated; success returns a fresh ETag.**

| Preconditions on the `PUT` | Result |
|---|---|
| none | **`428` Precondition Required**, `application/vnd.sas.error+json`, `errorCode 42801`, message *"One of the following request header fields is required: `If-Match` or `If-Unmodified-Since`."* |
| `If-Match: "<stale>"` | **`412` Precondition Failed**, `errorCode 0`, message names both the sent value and the resource's real ETag |
| `If-Match: <current>` + `Content-Type: text/plain` (deliberately wrong) | **`200`** — the content type is **not** checked against the registered type; the write took effect |
| `If-Match: <current>` + `Content-Type: application/x-python` | **`200`**, body = the full updated `application/vnd.sas.file+json` representation, **fresh `ETag` + `Last-Modified` in the response headers** |
| `If-Unmodified-Since: <far past>` only, no `If-Match` | **`412`** — honoured as a standalone precondition (matches the `428` message) |

So the FileSystemProvider: `writeFileContent` sends `If-Match` with the `ETag`
the provider recorded when `readFile` served the bytes the editor is showing —
never a freshly-fetched one, or a concurrent edit between open and save would
be silently overwritten. A `200` returns the new `ETag`, which the provider
keeps so a second save needs no re-read; a `412`/`428` is returned unchanged as
`content-rejected` and `localiseContentProblem` turns those statuses into a
"this file changed on the server, reopen it" message. The `Content-Type` sent
is the file's real
media type (echoed from the read) even though it is not enforced. `428` should
not occur while the provider always sends `If-Match`, but is handled for
defence. Creating a file (`POST /files/files?typeDefName=file_py` with
`Content-Disposition` + raw body) returns `201` with the same representation
shape — noted for 6c; the `#rawUpload` fragment upstream uses is not required.

---

_Findings 6.3–6.9 ran 2026-09-10 against **both** `verde` (Viya 4, Long-Term
Support **2026.03**) and `innov` (Viya 4, Stable **2026.06**) via the
`viya-api-probe` skill, for 6c-i's create/rename/delete paths. Read probes
(`GET`) were run directly; the mutating probes (`POST` folder/file create,
`PUT` rename, `DELETE`) ran against a single throwaway `czprobe-<ts>` folder
tree created under **My Folder** and torn down in the same shell under a
`trap`, verified `404` after. Sean approved the mutating run. Two cadences on
purpose: finding 6.9 clears Finding 79's "one cadence only" caveat, and finding
6.7 is a real difference between them._

**Finding 6.3 — folder create is `POST` the `createChild` link with a `{name}`
body; `201`.**
Every real folder — the three delegates (finding 97) and every ordinary folder
— carries a `createChild` link, `POST`, `type
application/vnd.sas.content.folder`, whose href **is exactly**
`/folders/folders?parentFolderUri={that folder's self href}`. So following the
relation and composing the string agree, and there is no ADR-0010 tension in
composing it — but the implementation follows the link. Body `{"name":"<n>"}` →
**`201`** with the full new-folder representation (`self`, `update`, `delete`,
`deleteRecursively`, `members`, `addMember`, `createChild`, `validateRename`
templated, `validateNewMemberName` templated). Identical on both cadences. The
synthetic "SAS Content" pseudo-root has no `createChild` (it has no
representation), so create is offered on delegates and ordinary folders only.

**Finding 6.4 — file create is two calls, and the type is not inferred from the
name.**
`POST /files/files?typeDefName=<typeDefName>` with `Content-Disposition:
filename*=UTF-8''<name>` and an (empty) body → **`201`**
`application/vnd.sas.file+json`, `ETag` in a **response header**, body carrying
`typeDefName`, `contentType`. The `#rawUpload` URL fragment upstream sends is
**not** required. Then `POST {parent}/members` (the `addMember` link, `type
application/vnd.sas.content.folder.member`) with
`{"uri":"<file self href>","type":"CHILD","name":"<name>","contentType":"<typeDefName>"}`
→ **`201`** member record (`type "child"`, `contentType "file"`, `typeDefName`,
`uri` → the file resource). **Omitting `typeDefName`** on the `POST /files/files`
still returns `201` but with `typeDefName: null` and `contentType` taken only
from the request `Content-Type` — so the create path genuinely needs the
`/types/types` lookup (finding 6.9); the inline `typeDefName` a member carries
on *read* (finding 99) is no help here, because there is no member yet. If the
`addMember` fails the file resource is an orphan in the user's Files store —
6c-i deletes it and reports the `addMember` failure.

**Finding 6.5 — rename is `PUT {self}` with a minimal `{name}` body; `200`.**
`PUT` the `update`/`self` href with `{"name":"<newname>"}` → **`200`** with the
updated representation, on both cadences. `If-Match` is **optional** on a folder
(`PUT` with none → `200`); a **stale** `If-Match` → **`412`** (weak-ETag
compare, `verde`). Renaming a file *member* changes the **member record's**
`name` only — the underlying `/files/files/{id}` resource keeps its original
`name` (the tree shows the member name, so this matches the UX, but a "rename"
is not a rename of the file resource). See finding 6.7 for why the body must be
minimal for a folder but is the full representation for a member.

**Finding 6.6 — the name-validation endpoints answer `200` with a body verdict,
not an HTTP error.**
`validateNewMemberName` (`PUT
.../members/@new/name?value={newname}&type={newtype}`, templated) and
`validateRename` (`PUT .../{memberId}/name?value={newname}&type={newtype}`) both
return **HTTP `200`** always. A free name → `{"valid":true,"version":1}`. A
clash → `{"valid":false,"error":{"version":2,"httpStatusCode":409,"errorCode":11552,"message":"An
item named \"x\" of type \"Folder\" already exists in the folder \"y\".","details":["Existing
member: ","/folders/folders/…","Suggestion: x (1)"]},"version":1}`. A folder's
`validateRename` template has `type=folder` already substituted; a file
member's has `{newtype}` templated too (fill with the member's `typeDefName`,
e.g. `file_py`). 6c-i turns a `valid:false` into a `content-name-rejected`
`ContentProblem` carrying `error.message` and the `Suggestion:` alternative.

**Finding 6.7 — cross-cadence difference: a folder rejects its own full
representation on `PUT` on Stable 2026.06.**
`PUT /folders/folders/{id}` with the **full GET'd folder representation** and
just `name` changed → **`200` on `verde` (LTS 2026.03)** but **`400`
`errorCode 1177` "The folder was not valid." on `innov` (Stable 2026.06)**. A
**minimal** body — `{"name":"x"}` or `{"id","name","type"}` — → `200` on
**both**. A file *member* `PUT` accepts the full member representation on both
cadences (not confirmed for a minimal member body). So 6c-i sends a minimal
`{name}` for a folder read directly and the full echoed representation for a
member — no `src/dialects/` branch, because the minimal body is a superset-safe
choice that works everywhere. _Also observed on `innov` only:_ a folder that
has been `PUT`-renamed can no longer be `DELETE`d **or `GET`** by the same
account — `403 "Forbidden / Unauthorized"`, not a race (persists after a wait);
a folder only ever created deletes fine. This looks like an authorization-rule
re-evaluation on modify specific to `innov`'s policy configuration rather than a
Viya-version behaviour, and it is **non-blocking** for 6c-i — a `403` already
maps to the `forbidden` `ContentProblem` ("ask your SAS administrator"). Worth a
follow-up probe if it recurs on another deployment.

**Finding 6.8 — delete: `deleteRecursively` does not recurse past a non-folder
member; the trailing member delete is usually a `404`.**
File: `DELETE /files/files/{id}` → **`204`**, `GET` after → `404`. Folder still
holding a non-folder member: `DELETE {folder}?recursive=true` (the
`deleteRecursively` link) → **`409` `errorCode 11516` "You cannot delete the
folder because it is not empty."** on **both** cadences — the "recursively" is
not literal. So 6c-i deletes a folder's listed children one at a time (upstream
does the same) before deleting the folder; an empty folder `DELETE`s `204`.
After deleting a file resource that was a folder member, the follow-up `DELETE
{folder}/members/{memberId}` → **`404` `errorCode 11501`** (the Folders service
removed the member with the resource). 6c-i **keeps upstream's swallow**: a
`404`/`403` on that trailing call is success, not failure — the delete the user
asked for has happened. (Answers the 6a-ii audit's open question.) A folder
that contains an *unlisted* member type — a report, a job — will still `409` on
the final `DELETE`; that surfaces as `content-rejected` and the user deletes
those in SAS Studio, same as upstream.

**Finding 6.9 — `/types/types` resolves `.py` to `file_py` on both cadences —
Finding 79's caveat cleared.**
`GET /types/types?filter=contains('extensions','py')` → exactly one item,
`name: "file_py"`, `label: "Python code"`, `mediaType: "application/x-python"`,
`resourceUri: "/files/files"`, `defaultContentType: null`, on **both** `verde`
(LTS 2026.03) and `innov` (Stable 2026.06). The `sas` query → `programFile` on
both (sanity check against upstream's hard-coded special case). So upstream's
generic fallback resolves this project's primary extension correctly with no
`.py`-specific special case, on two different Viya 4 cadences a release apart.
The `defaultContentType: "file"` fallback stays in `getTypeDefinition` as a
guard for an older or freshly-installed deployment that has not registered
`file_py`, not a path either probed deployment takes.

---

_Findings 6.10–6.11 ran 2026-09-10 for 6c-ii, via the `viya-api-probe` skill.
Finding 6.10's mutating probes were a throwaway `czmv-<ts>` folder tree under
My Folder (create folders/a file, `PUT`-move, `DELETE`), torn down child-by-child
under a `trap` and verified gone; run against **both** `verde` (Viya 4, LTS
2026.03) and `innov` (Viya 4, Stable 2026.06), matching. Finding 6.11's read was
a `PROC PYTHON` job in a throwaway compute session (created and `DELETE`d in the
same probe, `404` after) and is **`verde`-only** — the `innov` token had expired
at probe time; the follow-up is non-blocking because the feature it was for is
deferred. Sean approved the mutating runs._

**Finding 6.10 — a SAS Content "move" is `PUT` the member record's `update`
link with `parentFolderUri` changed; `200` on both cadences.**
- The `PUT` body must carry `uri` (the underlying `/files/files/{id}` or
  `/folders/folders/{id}`), `type: "child"` and `name` alongside the new
  `parentFolderUri`. Omitting `uri` → `400 errorCode 1177` "Each folder member
  must have a valid URI"; omitting `type` → `400 errorCode 1177` "The member
  type must be \"child\" or \"reference\"." A body of just the reduced
  `ContentItem` fields (`{id,name,type,contentType,typeDefName,uri,
  parentFolderUri}`) is accepted for a **file** member on both cadences;
  echoing the whole GET'd representation with `parentFolderUri` changed is
  accepted for a **file and a folder** member on both cadences — unlike a
  folder read directly (finding 6.7). `moveItem` sends the whole representation
  (one `GET` then `PUT`, the shape `renameItem`'s member branch already uses),
  so one path covers both member kinds without a further probe.
- The member `id` is **stable** across the move; the member `self`/`update`
  href changes (the `/folders/folders/{parent}/` segment updates); the
  underlying `uri` is unchanged. The moved member gains a `previousParent`
  link → its old parent — and it **persists on a subsequent members listing**,
  not just the `PUT` response (probed `verde`: a freshly-created member's
  listing has no `previousParent`; after one move, its re-listed record has
  one). So `previousParent` marks "moved at least once, ever", **not** "in the
  Recycle Bin" — the drag guard cannot use it to spot a recycled item (it would
  then also block re-moving a just-moved file). `getChildItems` stamps a
  synthetic `inRecycleBin` on the Recycle Bin delegate's direct children
  instead. (`verde`'s `@myRecycleBin` had 17 members, all `type: "child"`;
  filtered to the tree's `file`/`folder`/`dataFlow` set, two recycled folders
  with live `update` links — i.e. reachable by drag today without this guard.)
- A **no-op** move (`parentFolderUri` unchanged) → `200`, tolerated; `moveItem`
  is still guarded client-side to skip the request. A **self-move** or a move
  into a **descendant** → `400 errorCode 1177` "A folder cannot be moved or
  copied into itself" — the server guards cycles, so `contentMove.ts`'s
  same-target / ancestor concerns are UX only, not a correctness requirement.
- No `If-Match` on the `PUT` (the endpoint honours one — a stale tag → `412`),
  the same reasoning `renameItem` gives: a lost-update race on a re-parent has
  no "reopen it" recovery.
- Name-collision on a move (the destination already holds that name) is
  **unprobed**; the `PUT`'s own failure surfaces as `content-rejected`,
  matching upstream, which also does not pre-check.
- `innov`-only: `GET` on a torn-down throwaway folder returned `403`, not
  `404` — finding 6.7's known `innov` authorization-reevaluation-on-modify
  quirk, non-blocking.

**Finding 6.11 — Python under `PROC PYTHON` cannot open a `filesrvc` fileref;
the only bridge is `SAS.submit` + `fcopy` into the session run directory.**
This settled the drag-into-editor snippet question and, with Sean, deferred the
snippet (there is no idiomatic Python equivalent of upstream's
`filename … filesrvc …;`).
- The `PROC PYTHON` subprocess's `os.getcwd()` is the compute session **run**
  directory (`/opt/sas/viya/config/var/run/compsrv/default/<sessionId>`) — not
  `WORK`. A relative `open("./name")` on the Python side and a relative
  `filename loc "./name";` on the SAS side resolve to the **same** directory.
- `SAS.sasfnc("pathname", "<fr>")` on an assigned `FILENAME … FILESRVC` fileref
  returns the **bare filename**, not an OS path; `open()` on it fails. No
  `SAS.*` callback reads a file's bytes into Python (checked against the
  callback-method docs).
- The working mechanism: `SAS.submit("filename fr filesrvc folderpath='…'
  filename='…' recfm=n; filename loc './…' recfm=n; data _null_;
  rc=fcopy('fr','loc'); run;")`, then `open("./…","rb")` from Python — `fcopy`
  returned `rc=0` and the bytes matched. `recfm=n` on both filerefs for a
  byte-faithful copy.
- `FILENAME FILESRVC` accepts `folderpath=`+`filename=` (upstream's form) and
  `parenturi=`+`filename=`; `contenturi=` is rejected ("ERROR 23-2: Invalid
  option name").
- **`verde`-only** (LTS 2026.03), one small UTF-8 text file. A second-cadence
  check and binary / large-file behaviour are unprobed — acceptable while the
  snippet stays deferred.

---

_Finding 6.12 ran 2026-09-10 for 6c-iii, via the `viya-api-probe` skill,
read-only (`GET` only) against `verde` (Viya 4, LTS 2026.03). The `innov`
(Stable 2026.06) token in the creds file had expired (`401` "Full
authentication is required") — the same gap finding 6.11 hit — so this is
**single-cadence**. The `/folders/ancestors` operation is a long-standing
Folders v5 primitive and the deployment's answers matched the public OpenAPI
(which is not cadence-specific), so the risk of a 2026.06 difference is low;
re-probe when the `innov` token is refreshed. First checked the documented
shape (SAS Folders v5 OpenAPI, `operationId: getAncestors`) per the probe
order._

**Finding 6.12 — `GET /folders/ancestors?childUri=<uri>`: the response shape
depends on `Accept`, and "no parent" is a `200` under the vendor type but a
`404` under `application/json`.**

The `ancestors` link every folder-read-directly and every member record carries
has `href` `/folders/ancestors?childUri=<underlying resource uri>` — already
fully formed, no template — and advertises
`type: application/vnd.sas.content.folder.ancestor`.

| request `Accept` | `200` body |
|---|---|
| `application/vnd.sas.content.folder.ancestor+json` **or none** (the link's own type ⇒ what `src/content/client.ts` sends) | **object**: `{ childUri, ancestors: [<folder>…], version: 1 }` |
| `application/json` | **bare array**: `[<folder>…]` |
| `application/vnd.sas.collection+json` | **`406`** (finding 101's `406` — wrong `Accept`) |

- **Order** is immediate parent first, up to the top-most *visible* folder. A
  file at `My Folder / A / x.py` → `[A, My Folder, <userFolder>, <userRoot>]`;
  the invisible `/folders/folders` grand-root is **not** included.
- Each ancestor is a **full folder representation** — `id`, `name`, `type`
  (`folder` / `myFolder` / `userFolder` / `userRoot`), `parentFolderUri`,
  `memberCount`, timestamps, and a full `links` array. `uri` and `contentType`
  keys are **absent** (as in the root listing, finding 98), so
  `resourceHrefOf`'s `self`-link fallback applies. A `myFolder` ancestor carries
  the **same `id`** as `GET /folders/folders/@myFolder` returns (so the tree's
  delegate node and this entry are the same node); an ordinary-folder ancestor
  matches the `isNull(parent)` root-listing item's `id`.
- **"No parent" cases:**

  | case | ancestor type (or none) | `application/json` |
  |---|---|---|
  | folder directly under the invisible root | **`200`** `{ ancestors: [], version: 1 }` | **`404`** `application/vnd.sas.error+json`, `errorCode 11519` "was not found as a child in any of the folders" |
  | `childUri` param **omitted** | **`400`** `errorCode 11518` "You must specify the request parameter \"childUri\"" | `400` |
  | `childUri` present but empty, or a well-formed but unknown resource id | **`204 No Content`**, empty body | `204` / `404` |

- **Upstream (`RestContentAdapter.getParentOfItem`) reads `data[0]` off a bare
  array** — it relies on axios's default `application/json`, which on this
  deployment `404`s for a top-level folder (axios would throw). This project
  follows the link with its own advertised type instead and reads
  `body.ancestors[0]`, so a top-level folder is a clean `{ ancestors: [] }`
  rather than an exception.
- **Not probed:** `allowPartialPath=true` behaviour beyond a `200` (an
  access-restricted mid-path folder was not set up); the `POST /ancestors`
  bulk-by-URI variant (`operationId: createBulkAncestors`, a
  `application/vnd.sas.collection+json` of `{childUri, ancestors}` entries) —
  not needed, the tree resolves one item at a time.

---

_Findings 6.13–6.15 ran 2026-09-10 for 6d (favourites + recycle bin), via the
`viya-api-probe` skill, against **`verde` only** (Viya 4, LTS 2026.03) — the
`innov` (Stable 2026.06) token in the creds file had expired (`401`), the same
gap findings 6.11/6.12 hit. Read probes (`GET`) ran directly. The mutating probes
(`POST` favourite, `DELETE` favourite, `PATCH`/`PUT` recycle + restore, leaf
`DELETE`) ran against a single throwaway `.py` resource created under **My
Folder** and torn down in the same shell under a `trap`, verified `404` after and
the Recycle Bin confirmed back to its prior 17 members. Sean approved the
mutating run. The documented shapes were checked first against the SAS Folders v7
OpenAPI (`developer.sas.com`), which is not cadence-specific. **6d-i relies on
6.13; 6.14–6.15 are recorded ahead of 6d-ii, the slice that will rely on them.**_

_**Re-confirmed read-only for 6d-ii, 2026-09-10 (`verde`):** the `/folders/` root
advertises `recycleBin` (`GET` → `@myRecycleBin`) and `RecycleResource` (`PATCH`
`/folders/folders/@item?childUri={resourceUri}&parentFolderUri=/folders/folders/@myRecycleBin`,
`application/vnd.sas.content.folder.member`); `@myRecycleBin` resolves
`type: trashFolder` with `self` / `members` / `addMember` / `deleteRecursively` /
`createChild` / `up` / `ancestors`; every sampled bin member (`type: "child"`)
carries `previousParent` (→ its old `/folders/folders/{id}`), `deleteResource`
(→ the underlying resource), `delete` (→ the member record), `self` and `update`
— and a recycled **folder** member carries `deleteResource` but **not**
`deleteRecursively`, so empty-bin still has to empty a recycled folder
child-first (finding 6.8's pattern). `innov` (2026.06) was **not** reachable this
session even with a refreshed token — the host does not resolve from this machine
— so 6d-ii stays single-cadence like 6.11–6.15, riding on `moveItem` (6.10) and
`deleteResource` (6.8) both being confirmed on 2026.06._

**Finding 6.13 — favourites: add is a `reference` member `POST`, remove is a
`DELETE` of that record; `memberCount` is unreliable (settles Finding 80).**
`POST /folders/folders/@myFavorites/members` (the `addMember` link) with
`{"uri":"<resource uri>","type":"reference","name":"<n>","contentType":"file_py"}`
→ **`201`**, a full member record: `type: "reference"`, `contentType: "file"`
(the service normalises `file_py` → `file`, keeps `typeDefName: "file_py"`),
`uri` → the resource, `parentFolderUri` → the favourites folder. Its link set is
an ordinary member's — `self`, `delete` (the reference record),
`getResource`/`putResource`/**`deleteResource`** (all three the *underlying
file*), `update`, `ancestors`, `validateRename`. `self` and `delete` carry the
**same** href — the `/folders/folders/<favId>/members/<refId>` record — so the
adapter's `delete ?? self` fallback is an equivalent link, not an unprobed
guess. **Removing a favourite must use that record href, never `deleteResource`**
— that would delete the real file. `DELETE` the record href → **`204`**; the
underlying resource is untouched.
- After a real reference exists, the folder's `memberCount` and its members
  collection `count` agree (`1` / `1`). But **`memberCount` reads a phantom `1`
  against an empty members collection** — observed both before the probe and
  after cleanup, under every filter/`recursive`/`includeType` variant. The
  Folders v7 OpenAPI documents `memberCount` as "The number of members in the
  folder" with no caveat — a doc-vs-deployment disagreement. **So the members
  listing is the only authority for favourite state; `memberCount` is never
  keyed on for a UI decision.** This is the root-cause resolution of Finding 80
  (a favorites `memberCount: 1` against `count: 0`).
- A collection-item view of a favourite double-lists the `transferImport` rel
  — harmless, noted only so a `readLinks` change does not "fix" a non-bug.
- **Not probed:** adding a favourite that already exists (a duplicate
  reference); favouriting a top-level root-listing folder (no `contentType` in
  the add body — the code omits it and lets the service infer from `uri`).

**Finding 6.14 — recycle and restore are one generic move; no dedicated
operation; `previousParent` is set on recycle and cleared on restore.**
`PATCH /folders/folders/@item?childUri=<resourceUri>&parentFolderUri=<dest>`,
`Content-Type`/`Accept` `application/vnd.sas.content.folder.member+json`, body
`{}` — **`200`** with the updated member record. Recycle = dest
`/folders/folders/@myRecycleBin`; restore = dest the `previousParent` href.
- **No `If-Match` required** on either — the OpenAPI (`patchMoveFolderItem`)
  documents `If-Match`/`If-Unmodified-Since`; the deployment did not enforce
  them. Doc-vs-deployment.
- The member `id` is stable; its `self`/`update`/`delete` hrefs re-parent to
  `/folders/folders/<binId>/members/<id>`; a **`previousParent`** link →
  original parent appears on recycle. Restore (`PATCH` back to that href) → the
  item is in the original folder, **gone from the bin**, and the record no
  longer carries `previousParent`.
- The **`PUT`-member form** (finding 6.10's `moveItem` — `GET` the record, `PUT`
  it back with `parentFolderUri` set to the bin's **self href**) is fully
  equivalent, `200`, same end state. So 6d-ii can reuse `ContentAdapter.moveItem`
  for recycle (pass the bin self href) rather than a new PATCH arm; the `PATCH`
  form is one call vs the `PUT` form's two.
- **No dedicated recycle/restore operationId exists** in the OpenAPI. The
  `RecycleResource` `PATCH` relation on the Folders root (Finding 78) is exactly
  `patchMoveFolderItem` with `parentFolderUri` pre-bound to `@myRecycleBin` — not
  a distinct primitive.
- Every one of `verde`'s 17 current `@myRecycleBin` members carries
  `previousParent` **and** a live `update` link (2026-09-03's Finding 81 saw 1 of
  3 sampled missing it). The missing-link case is real but rare; upstream's "no
  `previousParent` ⇒ don't offer Restore" fallback stays as defence.

**Finding 6.15 — no empty-recycle-bin primitive; delete a recycled item via its
`deleteResource` link.**
`DELETE <deleteResource href>` (`/files/files/{id}` for a file) → **`204`**, and
the bin member record vanishes with it (finding 6.8's pattern — confirmed by the
probe teardown: `DELETE` the resource, `GET` after `404`, no leftover bin
member). So "empty recycle bin" is: list the bin's members, `DELETE` each one's
`deleteResource` (a folder: `deleteRecursively`/`deleteResource`), one at a time.
`DELETE /folders/folders/@myRecycleBin?recursive=true` was **not** probed (it
would delete Sean's real bin contents) but finding 6.8 measured
`deleteRecursively` `409`ing on any non-folder child, so it cannot be relied on
to empty a mixed bin regardless.

---

_Finding 6.16 is not a `viya-api-probe` finding — it is measured VS Code
client behaviour, read directly from VS Code 1.109 source
(`vscode`/`src/vs/workbench/api/…` and `vscode`/`src/vs/base/common/cancellation.ts`
in the upstream `microsoft/vscode` repository), the same "read the real
source, don't infer" standard this project applies to `vscode-sas-extension`
comparisons elsewhere. It settles the drag-and-drop root cause that
ADR-0031's own investigation (above) went looking for and didn't find, and
that `phase-11.md` had tracked as an open follow-up. Found 2026-09-11 from a
Phase 7 session in the `sas-py-vscode-cowork` clone; fixed in this repo on
`fix/content-drag-drop-cancellation-token`, after 6e (PR #162) had already
merged._

**Finding 6.16 — VS Code 1.109 marshals a non-final `CancellationToken`
argument as JSON, which strips its prototype-getter methods; the SAS Content
tree's `handleDrop` was throwing on every real move attempt as a result.**

`TreeDragAndDropController.handleDrop(target, dataTransfer, token)`'s `token`
is the tree view's own `CancellationToken`, supplied by VS Code across the
extension-host RPC boundary — the same boundary every other `vscode.*` API
call in this project crosses transparently. Two independent VS Code
internals combine to break it for this one call specifically:

- `src/vs/workbench/api/browser/mainThreadTreeViews.ts`'s `$handleDrop` calls
  `this._proxy.$handleDrop(this.treeViewId, request.id, dataTransferDto,
  targetTreeItem?.handle, token, operationUuid, sourceTreeId,
  sourceTreeItemHandles)` — `token` is argument 5 of 8, not the last one.
- `src/vs/workbench/services/extensions/common/rpcProtocol.ts`'s argument
  marshalling only special-cases a `CancellationToken` when it is the
  **last** argument (`if (args.length > 0 &&
  CancellationToken.isCancellationToken(args[args.length - 1]))`) — here
  `args[7]` is `sourceTreeItemHandles` (a `string[]`), so the check misses
  and `token` is serialized as an ordinary argument instead of being handled
  specially.
- `src/vs/base/common/cancellation.ts`'s `MutableToken` stores
  `isCancellationRequested`/`onCancellationRequested` as **getters on the
  prototype**, backed by private fields (`_isCancelled`, `_emitter`).
  `JSON.stringify` only serializes own enumerable properties, so a
  round-tripped token arrives at the extension host as a plain
  `{ "_isCancelled": false, "_emitter": null }` object — no
  `onCancellationRequested` method, and `isCancellationRequested` reads
  `undefined` (falsy, so it never misreports "cancelled", but a caller that
  branches on it explicitly rather than testing truthiness would need to
  know this).
- `src/vs/workbench/api/common/extHostTreeViews.ts` passes that
  already-broken object straight through into
  `this._dndController.handleDrop(target, treeDataTransfer, token)` with no
  validation — the extension author is trusted to have a real
  `CancellationToken`, per the declared type, and normally does.

Net effect: `contentDragAndDrop.ts`'s `handleDrop` called
`token.onCancellationRequested(...)` unconditionally inside its
`vscode.window.withProgress` callback (after every early-return guard, so
`handleDrag`/`handleDrop`'s own debug logging showed nothing wrong) and threw
`TypeError: o.onCancellationRequested is not a function` before any move
ran. Visible only in the DevTools console (`Help: Toggle Developer Tools`),
never in this extension's own `LogOutputChannel` — the throw happens outside
any of this project's own `try`/`catch` blocks, in code VS Code itself
invokes. Nothing in this project's test suite catches it either:
unit/integration tests call `handleDrop` directly with a real
`vscode.CancellationTokenSource().token`, which was never marshalled and
so never loses its prototype getters; `tsc` sees only the declared
`CancellationToken` interface, which the broken object doesn't structurally
violate at the type level for the properties it happens to expose.

- **Two other `onCancellationRequested` call sites in this repo were
  checked and confirmed unaffected**, since they subscribe to tokens that
  never cross this same path: `contentCommands.ts:670` and
  `run/commands.ts:546` both subscribe to a `vscode.window.withProgress`
  callback's own progress token (built locally in the extension host by
  `extHostProgress.ts`, never marshalled across RPC — the same reason
  `contentDragAndDrop.ts`'s `progressToken` subscription is safe);
  `compute/cancellation.ts`'s callers pass through a
  `CancellationTokenSource` this project constructs itself. `handleDrop`'s
  outer `token` is the only `CancellationToken` in this codebase that VS
  Code itself hands over through a non-final RPC argument position.
- **Not fixable from this side beyond not subscribing to the broken
  token.** `token.isCancellationRequested` still reads correctly enough to
  use in a poll (it is falsy either way, so a real cancellation via this
  path is simply never observed — an accepted, documented gap, not a
  silent one); there is no way for an extension to repair a token VS Code
  has already serialized incorrectly. `progressToken` remains the only
  reliable cancellation source for this call, and already backs the only
  cancellation affordance a user sees (the progress notification's own
  Cancel button).
- **Worth an upstream `microsoft/vscode` issue**, not filed as part of this
  fix: either `$handleDrop` should pass `token` last, or
  `mainThreadTreeViews.ts` should marshal it explicitly rather than relying
  on `rpcProtocol.ts`'s positional convention.
