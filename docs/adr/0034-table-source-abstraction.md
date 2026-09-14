# ADR-0034 — The data viewer panel is generalized behind a `TableSource` interface, not forked or forced through `LibraryAdapter`'s view machinery

- **Status:** Accepted
- **Date:** 2026-09-13
- **Decides:** how `DataViewerPanelManager`/`OpenTablePanel`
  (`src/data/dataViewerPanel.ts`, ADR-0028), built in Phase 7 directly against
  `LibraryAdapter`, gains a second backend for 8c ("CAS tables in the data
  viewer") — one shared panel behind a narrow interface, a forked
  near-duplicate panel, or routing CAS reads through `LibraryAdapter`'s own
  view-creation machinery
- **Constrained by:** [ADR-0028](0028-data-viewer-is-react-and-ag-grid.md)
  (the panel this ADR generalizes), [ADR-0029](0029-sort-view-lifecycle.md)
  (the view-creation/reuse/discard logic this ADR moves, unchanged, out of the
  panel and into `LibraryTableSource`), [ADR-0033](0033-cas-adapter-shape.md)
  (`CasAdapter`'s own shape, and Finding 8.12's "no session, no view" result
  this ADR's Decision depends on)
- **Executed in:** slice 8c

## Context

7b/7c built `DataViewerPanelManager`/`OpenTablePanel` directly against
`LibraryAdapter`/`TableDetail` — the panel itself knew how to call
`openTable`/`getColumns`/`getRows`/`applySort`/`deleteView`, and carried
`LibraryAdapter`'s own view-creation/reuse/discard state (`activeView`/
`activeSort`/`activeFilter`, ADR-0029) as its own fields.

8c needs the identical grid for a CAS table, and Findings 8.11–8.13
(`docs/phases/phase-8.md`) settled the design question before any code: a CAS
table's row data lives at the end of a `casManagement` → Data Tables API →
`rowSets` relation chain, not in `casManagement` itself, and its sort/filter
mechanism is materially simpler than a Compute session table's — `sortBy`/
`where=` both travel as plain, independent query parameters on every
`CasAdapter.getRows` call (Finding 8.12), with no `createView`/`deleteTable`
dance of any kind. That asymmetry is exactly what made forcing CAS through
`LibraryAdapter`'s own view machinery the wrong shape: there is no session, no
view, and nothing to cache, reuse, or discard between calls on the CAS side.

## Decision

`OpenTablePanel` now depends on a small interface, `TableSource`
(`src/data/tableSource.ts`) — `open`/`getColumns`/`getRows`/`close`, plus a
`key` (panel dedup/reveal), a `title`, and a `logPrefix` — rather than on
`LibraryAdapter` directly:

- **`src/data/librarySource.ts`'s `LibraryTableSource`** carries 7c's own
  view-creation/reuse/discard logic (ADR-0029) moved verbatim out of
  `OpenTablePanel`, with no behaviour change — `ensureReadTarget`/
  `ensureReadTargetLocked`/`discardView` and their serialisation are now this
  class's own private state instead of the panel's.
- **`src/cas/casTableSource.ts`'s `CasTableSource`** is a thin, direct
  pass-through: `getRows` hands `sort`/`filter` straight to
  `CasAdapter.getRows` as the plain query parameters Finding 8.12 confirmed
  they are, and `close` is a no-op — there is no server-side view of any kind
  to discard.
- **`OpenTablePanel` itself now knows nothing about either backend.** It
  tracks only the (sort, filter) pair a reply should be checked against for
  staleness — moved from view-creation-timing to request-receipt-timing
  without changing the race behaviour the existing Library-backed tests
  already pinned — and `dataViewerModel.ts`'s wire protocol
  (`toWireColumns`/`toWireRows`) reads `TableSource`'s own structural
  `SourceColumn`/`SourceRow` shapes rather than `src/data/types.ts`'s concrete
  ones, so it needs no CAS-specific branch either.
- **A `TableSource` is bound to exactly one already-identified table for its
  whole lifetime** — `DataViewerPanelManager.open` takes an
  already-constructed one, the same per-open-table granularity
  `OpenTablePanel`'s own internal state held before this refactor.
- **The dedup `key` is each `TableSource`'s own responsibility, and must be
  scoped by deployment.** `LibraryTableSource` already keyed on
  `${profileId}\nlibref.table`; `CasTableSource` mirrors that shape
  (`${endpoint}\nserver.caslib.table`, `CasAdapter.endpoint` added for exactly
  this) rather than keying on server/caslib/table names alone — otherwise
  switching to a different profile or endpoint that happens to expose the same
  names would reveal a panel still bound to the previous deployment's adapter.

## Alternatives considered

- **Fork a second, near-duplicate panel for CAS.** Rejected: `OpenTablePanel`'s
  webview wiring, CSP/HTML shell, dispose handling, and stale-reply-still-gets-
  answered concurrency guarantee are all backend-independent: duplicating the
  whole class to change only the row-fetch would mean fixing every future bug
  in that shared machinery twice, with no compensating benefit.
- **Force CAS through `LibraryAdapter`'s own view-creation machinery**
  (`createView`/`deleteTable` around every CAS read). Rejected: Finding 8.12
  established CAS needs no view at all — sort and filter already travel
  together as independent query parameters on every request. Routing CAS
  through a mechanism built to work around a Compute-session-specific
  limitation (Finding 7.16: `where=` is silently ignored on a created view's
  own `rows` read) would add a request round trip and state CAS never needs,
  purely to reuse `LibraryAdapter`'s own shape.
- **Key `CasTableSource` on server/caslib/table names alone, without the
  endpoint.** Considered during 8c's own implementation and rejected once
  reviewed: a name triple is not guaranteed unique *across two deployments*,
  so a same-named table on a different profile's endpoint would reveal the
  wrong deployment's panel — a data leak, not just a UX glitch. `CasAdapter`
  now carries its own `endpoint`, and the key folds it in, mirroring
  `LibraryAdapter.profileId`.

## Consequences

- `src/data/dataViewerPanel.ts` gains a second backend with no new branch on
  "which service is this" anywhere in the panel itself; a third backend would
  cost one more `TableSource` implementation, not a change to
  `DataViewerPanelManager`/`OpenTablePanel`.
- `src/data/librarySource.ts` and `src/cas/casTableSource.ts` both import
  `vscode` and stay at the integration test tier (added to `.c8rc.json`'s
  exclude list, per `check-coverage-scope.mjs`'s own gate); `src/data/tableSource.ts`
  is types-only and compiles to an empty file, excluded alongside them.
- A `TableSource`'s `key` is now load-bearing for cross-deployment isolation,
  not just panel-reveal convenience — any future `TableSource` implementation
  must fold in whatever identifies "this deployment" the same way, or risk
  the same leak this ADR's Alternatives section describes.
