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

*Slices, refined from `PRODUCTION_PLAN.md`'s original one-line sketch:*

- **6a — Adapter + read-only tree.** *Medium/Large* — the structural lift
  above (first tree view, first view container, first `ContentAdapter`
  implementation, the `links.ts` promotion decision) lands here even though
  the wire calls themselves (Findings 78, 82) are already confirmed working.
- **6b — Open/save via `FileSystemProvider`.** *Medium* — `readFile`/
  `writeFile`/`stat` plus the ETag round trip 6a's adapter already exposes;
  the drag-and-drop "insert a snippet referencing this file" behavior
  (`getFileStatement`) has no Python equivalent (a `filename … filesrvc …;`
  statement is SAS syntax) and needs its own small decision — drop it, or
  find what a Python analogue would even mean — rather than a silent gap.
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

☐ **6a — `ContentAdapter` + read-only tree.**

- ☐ Read `RestContentAdapter.ts` in full for what it does (not what it is) —
  the Viya-REST/SAS-Content half only, per the "no adapter factory" decision
  above. Audit rather than transcribe, per this project's own ported-code
  rule; note anything that looks like an upstream defect the way Phase 1's
  `auth.ts`/`AuthProvider.ts` audits did.
- ☐ Settle the `links.ts` promotion question (see Plan) before writing
  content-side wire code against either copy of it.
- ☐ Build `ContentItem`/`ContentAdapter`/`ContentModel`(if kept)/
  `ContentDataProvider` under a new `src/content/` module, paralleling
  `src/compute/`/`src/auth/` in shape.
- ☐ Add the `viewsContainers`/`activitybar`/`views` contributions to
  `package.json` — this repo's first. Command ids follow the existing flat
  `pythonOnViya.<verb>` convention, not upstream's `SAS.content.<verb>`
  grouping.
- ☐ A second live probe of `/types/types?filter=contains('extensions','py')`
  against a different Viya 4 cadence than `verde`'s, to check Finding 79's
  "confirmed on one cadence" caveat before depending on `file_py` existing
  everywhere.
- ☐ `test/helpers/recorded-content.ts` + `test/fixtures/content/`, built
  from Findings 78/82's scrubbed shapes.

☐ **6b — Open/save via `FileSystemProvider`.**

- ☐ `readFile`/`writeFile`/`stat` against the adapter's `getContentOfUri`/
  `updateContentOfItem`/ETag pattern.
- ☐ Decide the drag-and-drop snippet-insert question (Plan, above) —
  drop the feature, or design a Python-shaped equivalent — rather than
  leaving it an implicit gap.
- ☐ `workspace.registerFileSystemProvider` + the read-only
  `TextDocumentContentProvider` scheme for recycle-bin content, mirroring
  upstream's `sasContentReadOnly` pattern.

☐ **6c — Mutations (create/rename/move/delete).**

- ☐ Folder create/rename/delete; file create/rename/delete/move —
  confirmed-live link relations from Finding 78 (`createChild`, `update`,
  `deleteResource`, `deleteRecursively`, `validateRename`,
  `validateNewMemberName`).
- ☐ Decide the upload/download scope question (Plan, above): in 6c, or
  deferred to Phase 11.
- ☐ Drag-and-drop move/create-from-local-file, mirroring
  `handleContentItemDrop`/`handleFolderDrop`/`uploadUrisToTarget` in shape.

☐ **6d — Favourites and recycle bin.**

- ☐ Add/remove favourites via the `@myFavorites` delegate folder's
  `addMember`/`delete` links.
- ☐ Recycle/restore via move-to-`@myRecycleBin` (matching upstream's
  `moveItem`-based `recycleItem`) — **and** a probe of the `RecycleResource`
  `PATCH` relation Finding 78 turned up on the Folders service root, which
  upstream's own client never uses. Worth checking whether it is a simpler,
  more direct recycle primitive than the move-based one before committing
  to porting the move-based approach unexamined.
- ☐ Follow-up probe for Finding 80 (favorites member-count/collection
  mismatch) before trusting `memberCount` for any UI decision.
- ☐ Follow-up probe for Finding 81 (inconsistent `previousParent`) to
  confirm upstream's own "no link ⇒ can't restore, don't offer the command"
  handling is the right behaviour here too, rather than a masked defect.
- ☐ Empty-recycle-bin command.

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

**Not probed this session, left open:** the Files service's `rawUpload`
`POST` (file creation) — a mutating call, out of scope for a read-only
scoping pass per this project's own probe-safety rule; the folder/file
rename-validation `PUT` endpoints; and the `RecycleResource` `PATCH`
relation Finding 78 turned up. All three are 6a/6c/6d implementation-time
probes, not settled here.
