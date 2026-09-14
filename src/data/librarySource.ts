// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `TableSource` (`./tableSource.ts`) for a Compute session's own library
 * tables — everything `dataViewerPanel.ts`'s `OpenTablePanel` used to do
 * directly against `LibraryAdapter`, before 8c needed the same panel for a
 * second, simpler backend (`src/cas/casTableSource.ts`).
 *
 * **All of 7c's own view-creation complexity lives here now, and nowhere
 * else.** `LibraryAdapter.getRows`'s own `filter` restriction (Finding 7.16: a
 * `where=` is silently ignored on an already-created view's own `rows` read)
 * means a sort and a filter cannot simply travel as independent query
 * parameters the way `CasTableSource` sends both together — a sort-with-
 * filter combination must be requested as one `createView` call, reused
 * across every page fetch while the (sort, filter) pairing stays current, and
 * discarded when it changes. `ensureReadTarget`/`ensureReadTargetLocked`/
 * `discardView` below are that logic, moved verbatim out of the old
 * `OpenTablePanel` (`dataViewerPanel.ts`'s own git history has the original),
 * with no behaviour change — only `OpenTablePanel` itself no longer needs to
 * know any of it exists.
 */

import * as vscode from "vscode";

import { type DataResult, type LibraryAdapter } from "./adapter";
import { localiseDataProblem } from "./messages";
import { type DataProblem, describeDataProblem } from "./problems";
import {
  type Column,
  type SortSpec,
  type TableDetail,
  type TableItem,
} from "./types";
import {
  type SourceRowsPage,
  type SourceRowWindow,
  type SourceSortSpec,
  type TableSource,
  type TableSourceResult,
} from "./tableSource";

export class LibraryTableSource implements TableSource {
  readonly key: string;
  readonly title: string;
  readonly logPrefix = "SAS Libraries";

  private tableDetail: TableDetail | undefined;
  /** The server-side view backing the *current* sort/filter state — reused
   * across every `getRows` call while `activeSort`/`activeFilter` stay
   * unchanged; `undefined` when no sort is active (a plain or filtered-only
   * read goes straight against `tableDetail`). See {@link ensureReadTarget}. */
  private activeView: TableDetail | undefined;
  private activeSort: readonly SortSpec[] = [];
  private activeFilter: string | undefined;
  /** Serialises {@link ensureReadTarget}'s own body — a fast scroll can have
   * more than one `getRows` call in flight at once, and without this, two
   * concurrent calls deciding *together* that the (sort, filter) pairing
   * changed would each create their own view, the second silently
   * overwriting {@link activeView} and orphaning the first. `.catch()` on the
   * stored chain keeps one rejected call from poisoning every later one. */
  private ensureReadTargetChain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly adapter: LibraryAdapter,
    private readonly table: TableItem,
    private readonly log?: vscode.LogOutputChannel,
  ) {
    // `\n`-joined because neither a profile id nor `libref.name` can contain
    // one, so the two parts can never collide across the join — the same key
    // shape `DataViewerPanelManager.open` used to build inline.
    this.key = `${adapter.profileId}\n${table.libref}.${table.name}`;
    this.title = `${table.libref}.${table.name}`;
  }

  async open(
    signal?: AbortSignal,
  ): Promise<TableSourceResult<{ rowCount: number | undefined }>> {
    const opened = await this.adapter.openTable(this.table, signal);
    if (!opened.ok) return fail(opened);
    this.tableDetail = opened.value;
    return { ok: true, value: { rowCount: opened.value.rowCount } };
  }

  async getColumns(
    signal?: AbortSignal,
  ): Promise<TableSourceResult<readonly Column[]>> {
    const table = this.tableDetail;
    if (table === undefined) return notOpenYet();

    const result = await this.adapter.getColumns(table, signal);
    if (!result.ok) return fail(result);
    return { ok: true, value: result.value };
  }

  async getRows(
    window: SourceRowWindow,
    sort: readonly SourceSortSpec[],
    filter: string,
    signal?: AbortSignal,
  ): Promise<TableSourceResult<SourceRowsPage>> {
    const table = this.tableDetail;
    if (table === undefined) return notOpenYet();

    const target = await this.ensureReadTarget(sort, filter, signal);
    if (!target.ok) return fail(target);

    // A filter is applied via `where=` only against the base table — never
    // against `target.value` when it is a sort-view, which already has any
    // active filter baked into its own `createView` body (Finding 7.16:
    // `where=` is silently ignored on a view's own rows read).
    const result = await this.adapter.getRows(
      target.value,
      window,
      sort.length === 0 ? filter : undefined,
      signal,
    );
    if (!result.ok) return fail(result);
    return { ok: true, value: result.value };
  }

  async close(signal?: AbortSignal): Promise<void> {
    await this.discardView(signal);
  }

  /**
   * The table (no sort active) or the sort-view (sort active) the next
   * {@link getRows} call should read from — creating, reusing, or discarding
   * a view as `sort`/`filter` change.
   *
   * **A view is recreated whenever the (sort, filter) pairing changes, and
   * reused across every page fetch while it stays the same** — one
   * create/delete round trip per distinct sort/filter state, not one per
   * scroll-triggered page the way upstream's own `getSortedRows` does
   * (`LibraryAdapter.applySort`'s own doc comment). Serialised via {@link
   * ensureReadTargetChain} — see that field's own doc comment.
   */
  private ensureReadTarget(
    sort: readonly SortSpec[],
    filter: string,
    signal: AbortSignal | undefined,
  ): Promise<DataResult<TableDetail>> {
    const next = this.ensureReadTargetChain
      .then(() => this.ensureReadTargetLocked(sort, filter, signal))
      .catch((error: unknown): DataResult<TableDetail> => ({
        ok: false,
        reason: `an unexpected error while preparing to read: ${messageOf(error)}`,
        problem: {
          code: "compute",
          problem: { code: "compute-unreachable", detail: messageOf(error) },
        },
      }));
    this.ensureReadTargetChain = next;
    return next;
  }

  private async ensureReadTargetLocked(
    sort: readonly SortSpec[],
    filter: string,
    signal: AbortSignal | undefined,
  ): Promise<DataResult<TableDetail>> {
    const table = this.tableDetail;
    if (table === undefined) {
      return {
        ok: false,
        reason: "the table is not open yet",
        problem: { code: "not-connected" },
      };
    }

    if (sort.length === 0) {
      if (this.activeView !== undefined) await this.discardView(signal);
      this.activeSort = sort;
      this.activeFilter = filter;
      return { ok: true, value: table };
    }

    if (
      this.activeView !== undefined &&
      sortEquals(this.activeSort, sort) &&
      this.activeFilter === filter
    ) {
      return { ok: true, value: this.activeView };
    }

    if (this.activeView !== undefined) await this.discardView(signal);

    const created = await this.adapter.applySort(
      table,
      sort,
      filter === "" ? undefined : filter,
      signal,
    );
    if (!created.ok) return created;

    this.activeView = created.value;
    this.activeSort = sort;
    this.activeFilter = filter;
    return created;
  }

  /** Deletes the current view, if there is one, and clears this source's own
   * record of it regardless of whether the delete actually succeeded — a
   * failed delete is logged, not retried or propagated. */
  private async discardView(signal: AbortSignal | undefined): Promise<void> {
    const view = this.activeView;
    this.activeView = undefined;
    this.activeSort = [];
    this.activeFilter = undefined;
    if (view === undefined) return;

    const deleted = await this.adapter.deleteView(view, signal);
    if (!deleted.ok) {
      this.log?.warn(
        vscode.l10n.t(
          'SAS Libraries: could not delete a sort/filter view over "{0}" ({1}) — it will be orphaned until the session ends',
          this.title,
          describeDataProblem(deleted.problem),
        ),
      );
    }
  }
}

function notOpenYet<T>(): TableSourceResult<T> {
  return {
    ok: false,
    message: vscode.l10n.t("The table is not open yet."),
    logDetail: "the table is not open yet",
  };
}

function fail<T>(result: {
  ok: false;
  problem: DataProblem;
}): TableSourceResult<T> {
  return {
    ok: false,
    message: localiseDataProblem(result.problem),
    logDetail: describeDataProblem(result.problem),
  };
}

/** Whether two sort specs name the same columns in the same order with the
 * same direction — the same ordinary array equality
 * `dataViewerPanel.ts` used to carry a copy of. */
function sortEquals(a: readonly SortSpec[], b: readonly SortSpec[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((spec, index) => {
    const other = b[index];
    return other?.key === spec.key && other.direction === spec.direction;
  });
}

/** The message of a thrown value, and nothing else it might be carrying. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
