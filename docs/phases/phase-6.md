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
  `writeFile`/`stat` plus the ETag round trip (findings 6.1/6.2). **Done**,
  merged as `phase-6b-open-save`, scoped to the open/save core — see the
  Runbook block for the three items moved out. The drag-and-drop "insert a
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

☑ **6b — Open/save via `FileSystemProvider`.** Merged as `phase-6b-open-save`.
Scoped down at slice start (Sean, 2026-09-09) to the open/save core; three
items moved to the slices that give them a reason to exist — see the struck
lines below.

- ☑ `readFile`/`writeFile`/`stat` via a new `sasContent:` `FileSystemProvider`
  (`src/content/contentFileSystem.ts`, a `vscode` shell) over three new
  `vscode`-free `ContentAdapter` methods — `statFile`, `readFileContent`,
  `writeFileContent` — on the mutating arm added to `src/content/client.ts`
  (`rawBody`/`contentType`/`If-Match`; response `etag`/`lastModified`/`rawBody`).
  Findings 6.1/6.2: the file resource carries `content`/`updateContent`
  relations at `${self}/content`, `PUT` needs `If-Match` (bare ⇒ `428`, stale ⇒
  `412`), and a successful `PUT` returns a fresh `ETag`. `writeFileContent`
  re-reads the ETag with a `HEAD` immediately before the `PUT` — the same
  "re-read before mutate" choice `src/compute/fileref.ts`/`files.ts` make — and
  a `412`/`428` surfaces to the user as a "changed on the server, reopen it"
  conflict through the returning `localiseContentProblem` seam
  (`src/content/messages.ts`).
- ☑ `workspace.registerFileSystemProvider("sasContent", …)` + the
  `onFileSystem:sasContent` activation event. A tree file leaf
  (`NodePresentation.openable` — an ordinary `file`, never a `dataFlow`) gets a
  `resourceUri` and a `vscode.open` command pointed at its
  `sasContent:/<name>?id=<resourceHref>` URI (`src/content/uri.ts`).
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

☐ **6c — Mutations (create/rename/move/delete).**

- ☐ Folder create/rename/delete; file create/rename/delete/move —
  confirmed-live link relations from Finding 78 (`createChild`, `update`,
  `deleteResource`, `deleteRecursively`, `validateRename`,
  `validateNewMemberName`).
- ☐ **The `/types/types?filter=contains('extensions','py')` probe, moved here
  from 6a.** Create-file (`getTypeDefinition`) is the only path that reads it.
  Probe against a Viya 4 cadence other than `verde`'s to check Finding 79's
  one-cadence caveat, **and** check whether the inline `typeDefName` a `.py`
  member already carries on read (finding 99) removes the need for the lookup
  on the create path too. Upstream's `deleteResource` also swallows a
  `404`/`403` from its follow-up member-delete — decide whether to keep that
  or surface it (6a-ii's audit flagged it).
- ☐ Decide the upload/download scope question (Plan, above): in 6c, or
  deferred to Phase 11.
- ☐ Drag-and-drop move/create-from-local-file, mirroring
  `handleContentItemDrop`/`handleFolderDrop`/`uploadUrisToTarget` in shape.
- ☐ **Drag-a-file-into-the-editor snippet (moved from 6b).** Python-shaped
  equivalent of upstream's `getFileStatement` (`filename … filesrvc …;`).
  **Probe first:** how does Python running under `PROC PYTHON` read a
  `filesrvc` fileref / a SAS Content file — a resolvable path in the Python
  process, or bytes handed across the `SAS` bridge? No unprobed guess goes in
  the snippet template. Shares the `DataTransfer` wiring with the move item
  above.
- ☐ **`getParent` / `TreeView.reveal` + the finding-101 `ancestors` probe
  (moved from 6b).** The first caller is "reveal the item just created or
  moved". `GET /folders/ancestors?childUri=…` returned `406` under the
  collection media type and `{}` under `application/json` in finding 101 —
  pin the real shape here before iterating it the way upstream's
  `getParentOfItem` does.

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
- ☐ **The read-only `sasContentReadOnly` `TextDocumentContentProvider` scheme
  (moved from 6b).** Lets a recycled file's content open read-only, mirroring
  upstream's `sasContentReadOnly` pattern — it only has a caller once the
  recycle bin is browsable.

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
with no body — which is what 6b's `writeFileContent` uses for its pre-write
ETag re-read, so a large file is not pulled back just to read a header.

**Finding 6.2 — `PUT .../content` is a strict optimistic-concurrency endpoint;
content-type is not validated; success returns a fresh ETag.**

| Preconditions on the `PUT` | Result |
|---|---|
| none | **`428` Precondition Required**, `application/vnd.sas.error+json`, `errorCode 42801`, message *"One of the following request header fields is required: `If-Match` or `If-Unmodified-Since`."* |
| `If-Match: "<stale>"` | **`412` Precondition Failed**, `errorCode 0`, message names both the sent value and the resource's real ETag |
| `If-Match: <current>` + `Content-Type: text/plain` (deliberately wrong) | **`200`** — the content type is **not** checked against the registered type; the write took effect |
| `If-Match: <current>` + `Content-Type: application/x-python` | **`200`**, body = the full updated `application/vnd.sas.file+json` representation, **fresh `ETag` + `Last-Modified` in the response headers** |
| `If-Unmodified-Since: <far past>` only, no `If-Match` | **`412`** — honoured as a standalone precondition (matches the `428` message) |

So the FileSystemProvider: `writeFileContent` sends `If-Match` with a
freshly-`HEAD`-read ETag; a `200` means the save is done and no follow-up `GET`
is needed; a `412`/`428` is returned unchanged as `content-rejected` and
`localiseContentProblem` turns status `412`/`428` into a "this file changed on
the server, reopen it" message. The `Content-Type` sent is the file's real
media type (echoed from the read) even though it is not enforced. `428` should
not occur while the provider always sends `If-Match`, but is handled for
defence. Creating a file (`POST /files/files?typeDefName=file_py` with
`Content-Disposition` + raw body) returns `201` with the same representation
shape — noted for 6c; the `#rawUpload` fragment upstream uses is not required.
