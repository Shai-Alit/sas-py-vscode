// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The row/column vocabulary `dataViewerPanel.ts`'s webview panel reads
 * through, independent of which Viya service actually supplies the data.
 *
 * **This module must never import `vscode`.**
 *
 * 7b/7c built `DataViewerPanelManager`/`OpenTablePanel` directly against
 * `LibraryAdapter`/`TableDetail`. 8c needs the identical grid for CAS tables
 * (`docs/phases/phase-8.md`), whose row-fetch is materially simpler —
 * `src/cas/adapter.ts`'s `getRows` takes sort/filter as plain query
 * parameters on every request (Finding 8.12); there is no
 * `createView`/`deleteView` dance the way a Compute session table has
 * (Finding 7.16). Rather than force CAS through Library's view-creation
 * machinery, or fork a second, near-duplicate panel, {@link TableSource} is
 * what `OpenTablePanel` now depends on: `src/data/librarySource.ts`'s
 * `LibraryTableSource` keeps every bit of that view-management complexity to
 * itself, and `src/cas/casTableSource.ts`'s `CasTableSource` is a thin,
 * direct pass-through — `OpenTablePanel` itself never knows which one it is
 * talking to.
 *
 * A `TableSource` is bound to exactly one already-identified table for its
 * whole lifetime — `DataViewerPanelManager.open` takes an already-constructed
 * one, the same per-open-table granularity `OpenTablePanel`'s own internal
 * state held before this refactor.
 */

/** A column reduced to what the grid's own column definitions need — see
 * `dataViewerModel.ts`'s `toWireColumns`, the only reader. Both
 * `src/data/types.ts`'s `Column` and `src/cas/types.ts`'s `CasColumnItem`
 * satisfy this structurally; neither needs to import from here to do so. */
export interface SourceColumn {
  readonly name: string;
  readonly label?: string | undefined;
  readonly type: string;
}

/** One row of table data, positionally matching column order — see
 * `dataViewerModel.ts`'s `toWireRows`. `src/data/types.ts`'s `RowItem` and
 * `src/cas/types.ts`'s `CasRowItem` both satisfy this structurally. */
export interface SourceRow {
  readonly cells: readonly unknown[];
}

/** One window of row data, as {@link TableSource.getRows} returns it. */
export interface SourceRowsPage {
  readonly rows: readonly SourceRow[];
  readonly count: number | undefined;
}

/** The window of rows {@link TableSource.getRows} requests — zero-based
 * `start`/`limit`, the same shape every backend's own `RowWindow` gives. */
export interface SourceRowWindow {
  readonly start: number;
  readonly limit: number;
}

/** One column to sort by, and the direction. Structurally identical to
 * `src/data/types.ts`'s `SortSpec` and `src/cas/types.ts`'s `CasSortSpec` —
 * each backend turns this into whatever its own wire protocol needs
 * (a `createView` request body's array entry for Library; a
 * `sortBy=key:direction` query fragment for CAS), entirely inside its own
 * {@link TableSource} implementation. */
export interface SourceSortSpec {
  readonly key: string;
  readonly direction: "ascending" | "descending";
}

/** A failed `TableSource` call. Carries **two** English strings, not one —
 * matching every other Viya-facing failure this project surfaces to a user
 * (`src/data/messages.ts`'s own doc comment explains why): `message` is a
 * complete, localised sentence for the webview itself; `logDetail` is the
 * lower-case, untranslated fragment `OpenTablePanel` writes to the output
 * channel, matching `describeDataProblem`/`describeCasProblem`'s own
 * convention. Producing both is each concrete `TableSource`'s own
 * responsibility — `OpenTablePanel` never sees a backend-specific `Problem`
 * type at all, which is the point of this interface. */
export type TableSourceResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly message: string;
      readonly logDetail: string;
    };

/**
 * What `OpenTablePanel` needs from a table's own backend, already bound to
 * one specific, already-identified table.
 */
export interface TableSource {
  /** Unique across every open panel — `DataViewerPanelManager`'s own
   * dedup/reveal key (e.g. `${profileId}\nWORK.CLASS`, or a CAS table's own
   * qualified name). */
  readonly key: string;
  /** The panel's own title. */
  readonly title: string;
  /** Named in every log line `OpenTablePanel` writes for this table — "SAS
   * Libraries" or "CAS", matching the tree each backend's own failures are
   * already logged under. */
  readonly logPrefix: string;

  /** Resolves whatever this table needs opened before its columns or rows
   * can be read — called once, before the first {@link getColumns}. */
  open(
    signal?: AbortSignal,
  ): Promise<TableSourceResult<{ readonly rowCount: number | undefined }>>;

  /** This table's column definitions — called once, right after {@link open}
   * succeeds. */
  getColumns(
    signal?: AbortSignal,
  ): Promise<TableSourceResult<readonly SourceColumn[]>>;

  /** One window of row data for the given sort/filter state. Called again for
   * every scroll, sort change, and filter change the grid makes — how (or
   * whether) a sort/filter state is cached or reused across calls is entirely
   * this method's own concern, invisible to the caller. */
  getRows(
    window: SourceRowWindow,
    sort: readonly SourceSortSpec[],
    filter: string,
    signal?: AbortSignal,
  ): Promise<TableSourceResult<SourceRowsPage>>;

  /** Best-effort cleanup when the panel closes — Library discards any
   * server-side view still open; CAS has nothing to discard. Never throws;
   * a failure here is this method's own concern to log, not the panel's. */
  close(signal?: AbortSignal): Promise<void>;
}
