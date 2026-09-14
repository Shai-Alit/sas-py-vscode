// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `TableSource` (`../data/tableSource.ts`) for a CAS table (8c) —
 * `docs/phases/phase-8.md`'s Findings 8.11/8.12.
 *
 * **Deliberately thin, unlike `../data/librarySource.ts`'s
 * `LibraryTableSource`.** A CAS table's sort and filter are both plain query
 * parameters on every `CasAdapter.getRows` call, sent together, with no
 * server-side view of any kind — there is nothing here to cache, reuse, or
 * discard between calls, which is exactly the asymmetry
 * `../data/tableSource.ts`'s own doc comment describes. `close` is a no-op
 * for the same reason.
 */

import * as vscode from "vscode";

import { type CasAdapter } from "./adapter";
import { localiseCasProblem } from "./messages";
import { type CasProblem, describeCasProblem } from "./problems";
import { type CasTableDetail, type CasTableItem } from "./types";
import {
  type SourceColumn,
  type SourceRowsPage,
  type SourceRowWindow,
  type SourceSortSpec,
  type TableSource,
  type TableSourceResult,
} from "../data/tableSource";

export class CasTableSource implements TableSource {
  readonly key: string;
  readonly title: string;
  readonly logPrefix = "CAS";

  private detail: CasTableDetail | undefined;

  constructor(
    private readonly adapter: CasAdapter,
    private readonly table: CasTableItem,
  ) {
    // `\n`-joined against the endpoint, mirroring `LibraryTableSource`'s own
    // `${profileId}\n...` key: a server/caslib/table name triple is not
    // guaranteed unique *across two deployments* that happen to expose the
    // same names, so the endpoint must be part of the dedup key too, or
    // switching profiles could reveal a panel still bound to the previous
    // deployment's `CasAdapter` — a cross-deployment data leak. Qualified by
    // server as well, mirroring `casTree.ts`'s own node id: a caslib/table
    // name pair is not guaranteed unique across two CAS servers on the same
    // deployment either, even though this project has only ever observed
    // one.
    this.key = `cas:${adapter.endpoint}\n${table.serverName}.${table.caslibName}.${table.name}`;
    this.title = `${table.caslibName}.${table.name}`;
  }

  async open(
    signal?: AbortSignal,
  ): Promise<TableSourceResult<{ rowCount: number | undefined }>> {
    const opened = await this.adapter.openTable(this.table, signal);
    if (!opened.ok) return fail(opened);
    this.detail = opened.value;
    // Not `opened.value.rowCount`: that field is carried over from the
    // *listing* entry `openTable` was handed, which reads `0` for a table
    // that was unloaded at the moment this panel's caller listed it — stale
    // by the time this table is actually open. `undefined` here is the same
    // documented "no upfront total" signal `ag-grid`'s own `IDatasource`
    // reads (7b's own Runbook entry) — the grid learns the real count from
    // the first `getRows` reply instead, which Finding 8.12 confirms always
    // carries one.
    return { ok: true, value: { rowCount: undefined } };
  }

  async getColumns(
    signal?: AbortSignal,
  ): Promise<TableSourceResult<readonly SourceColumn[]>> {
    const table = this.detail;
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
    const table = this.detail;
    if (table === undefined) return notOpenYet();

    const result = await this.adapter.getRows(
      table,
      window,
      sort,
      filter,
      signal,
    );
    if (!result.ok) return fail(result);
    return { ok: true, value: result.value };
  }

  close(): Promise<void> {
    // No server-side view of any kind to discard — see this module's own
    // doc comment. No `async` keyword: nothing here to await.
    return Promise.resolve();
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
  problem: CasProblem;
}): TableSourceResult<T> {
  return {
    ok: false,
    message: localiseCasProblem(result.problem),
    logDetail: describeCasProblem(result.problem),
  };
}
