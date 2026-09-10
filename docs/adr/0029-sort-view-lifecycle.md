# ADR-0029 — A server-side sort view is created once per (sort, filter) state and reused across pagination, not recreated per page

- **Status:** Accepted
- **Date:** 2026-09-10
- **Decides:** how 7c-i's server-side column sort is implemented against the
  Compute `DataAccessApi`'s `createView` mechanism — specifically, the
  lifetime of the temporary view a sort creates, when a filter travels with
  it, and how cleanup is guaranteed rather than merely attempted
- **Constrained by:** [ADR-0027](0027-library-adapter-shape.md) (`LibraryAdapter`
  is a session-scoped consumer of `ComputeSessionManager`, one concrete class,
  refuse-not-queue on a busy session), [ADR-0028](0028-data-viewer-is-react-and-ag-grid.md)
  (the data viewer is React + ag-grid-community, server-side sort via
  `createView` already named as this slice's own mechanism), Findings
  7.15–7.18 (`docs/phases/phase-7.md`), live-probed against `verde` ahead of
  this slice's own code
- **Executed in:** 7c-i (`docs/phases/phase-7.md`'s Runbook), the same
  session as the probes this record cites

## Context

Phase 7's own Plan section named the open questions before any code existed:
upstream's `RestLibraryAdapter.getSortedRows` (`vscode-sas-extension`)
implements sort by creating a server-side view (`POST .../views` with a
`sortBy` body), reading rows from it, then deleting it — and the Plan section
flagged, without yet confirming, that upstream's own delete is not wrapped in
a `try`/`finally`, so a throwing read leaves the view orphaned in the session
for good. It also left open how a filter (`where=`) interacts with a sort,
and whether the create/delete pair happens once or on every row-window fetch.

Findings 7.15–7.18, probed live against `verde` ahead of writing this slice's
code, answered all three questions with real wire behaviour, not
documentation:

- **`where=` is silently ignored on a created view's own `rows` read**
  (Finding 7.16) — a filter that should apply while a sort is active must be
  baked into the same `createView` request body that sets `sortBy`
  (`ViewRequest.where`, confirmed on the wire), not appended as a query
  parameter afterward the way it works on a real table.
- **`count` disappears once either a filter or a view is involved** (Finding
  7.17), even on the base table — not merely sometimes absent the way other
  Compute collections behave, but absent on every filtered or view-backed
  read this phase probed.
- **Upstream's own `getSortedRows` creates and deletes a fresh view for
  *every single row-window fetch*, including a plain scroll** — confirmed by
  reading that method directly (not merely inferred): the create/read/delete
  sequence runs inside the same function `getRows` calls whenever a sort is
  active, with no caching of the view across calls, and the delete has no
  `try`/`finally` around it, so a throwing read really does orphan the view
  with no recovery.

## Decision

### One view per distinct (sort, filter) pairing, reused across every page fetch, not recreated per scroll

`LibraryAdapter.applySort(table, sort, filter, signal)` creates a view and
returns it; `dataViewerPanel.ts`'s `OpenTablePanel.ensureReadTarget` keeps it
in `activeView`/`activeSort`/`activeFilter` and reuses it for every
subsequent `requestRows` while that exact pairing stays current, only
creating a new one when the sort or the filter actually changes. This is a
deliberate departure from upstream's own per-fetch churn, not an
accidental one: a scroll-triggered page fetch is common (an infinite-row-model
grid issues one for every visible block), and turning each into its own
`createView`/`deleteTable` round trip multiplies mutating calls against the
live session for no benefit — the view's own content does not change between
page fetches of the same sort/filter.

### A filter travels inside the same `createView` call as `sortBy`, never as a separate `where=` on the view's own rows

Finding 7.16 makes this the only shape that actually works, not a style
preference: `getRows`'s own `filter` parameter is documented to apply `where=`
only against a real table, and `ensureReadTarget` never passes a filter
alongside a view-backed read target — it is already baked into the view at
creation time. A filter change while a sort is active recreates the view
(delete the old, create the new with both fields), rather than attempting to
mutate an existing view's own filter.

### Cleanup is guaranteed on every exit path, not merely attempted on the happy one

Every place `activeView` can become stale — a new sort, a changed filter, sort
turned off, or the panel disposing — calls `discardView`/an equivalent
best-effort delete, deliberately **not** wrapped around the *read* the way
upstream's naive `try` would have been if it had one; instead, deletion is a
property of every state transition and of disposal, independent of whether
any particular row read that used the view succeeded or threw. A delete
failure is logged (`DataViewerPanelDeps.log`), never retried or surfaced to
the user — an orphaned view is bounded by the session's own lifetime, the
same fallback safety net upstream's un-cleaned-up view already relies on
(Finding 7.15), just reached far less often here because cleanup is actually
attempted on every path rather than never on a throw.

### `ensureReadTarget` is serialised per panel

`OpenTablePanel` is the first place in this project's data-viewer code with
mutable state a concurrent adapter call could race — an infinite-row-model
grid can have more than one `requestRows` in flight during a fast scroll.
Two concurrent calls both deciding "the (sort, filter) pairing changed"
would, without serialisation, each create their own view and the second
would silently overwrite the first in `activeView`, orphaning it outside the
ordinary supersede-or-dispose cleanup path. `ensureReadTarget` chains onto a
private `Promise` field so only one body runs at a time per panel — cheap,
and closes a real leak rather than an acknowledged one.

### `count`'s absence under sort/filter is a grid-side heuristic, not an adapter-side guess

Following Finding 7.17 rather than assuming `RowsPage.count` behaves the same
regardless of what produced the read, `dataViewerEntry.tsx`'s own
`lastRowFor` falls back to upstream's own "fewer rows came back than the page
size ⇒ this is the last page" rule exactly when `count` is absent — the same
heuristic Finding 7.10 found this project's *base* case did not need, now
genuinely needed once 7c-i's own sort/filter is active.

## Alternatives considered

**Match upstream exactly: create and delete a view on every row-window
fetch.** Rejected — Finding 7.15 confirms this is what upstream's own code
does, and it is not free: every scroll-triggered page under a sort becomes
two mutating Compute calls (`createView`, `deleteTable`) in addition to the
row read itself, against a session whose `DataAccessApi` reads already block
behind a running job (Finding 7.3). Reusing one view for the sort/filter
state's whole lifetime removes that multiplication with no loss of
correctness.

**Bake a filter into the base table's `where=` and layer sort on top via a
second mechanism.** Not viable — Finding 7.16 measured directly that `where=`
does nothing on a view's own rows read, so there is no "layer on top"
mechanism to reach for; the filter has to be part of the same `createView`
call whenever a sort is also active.

**Wrap only the read in `try`/`finally` around a single `createView`/`getRows`/`deleteTable`
sequence, matching upstream's shape but fixing its one bug.** Considered and
rejected in favour of the reuse-across-pagination design above: fixing only
the missing `finally` would still leave the multiplied-mutating-calls problem
this ADR's first Decision point addresses, for no benefit over reuse.

## Consequences

**What this unlocks:** 7c-i's sort and filter both build on `LibraryAdapter.applySort`/
`deleteView` and `OpenTablePanel.ensureReadTarget` exactly as described above
— no further adapter-level design work is needed for either.

**What this does not settle:** whether a *second* concurrent `DataAccessApi`
call from a different panel (not this one) queues or blocks the same way a
running job does (Finding 7.3's own open question, unrelated to this ADR);
CSV export's own mechanism (7c-iii, Finding 7.15's `rowsAsCSV` link finding);
and table properties' own static viewer (7c-ii) — neither touches
`applySort`/`deleteView` at all.

**A second-deployment (`Innov`) cross-check of Findings 7.15–7.18 is still
open**, not blocking (see those findings' own "not probed" note) — worth
running if 7c-ii or 7c-iii's own implementation session has time, the same
way 7a's own second-deployment probe happened opportunistically rather than
gating 7a's own merge.
