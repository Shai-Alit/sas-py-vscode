// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `CsvExportSource` (`../data/csvExportModel.ts`) for a CAS table (11d) —
 * `pythonOnViya.exportCasTableToCsv`.
 *
 * Reads the same JSON pages `CasAdapter.getRows` gives the data viewer and
 * formats them itself (`./csvFormat.ts`), rather than relaying the server's
 * own `text/csv` the way `LibraryCsvSource` does — Finding 11.5: the CAS CSV
 * arrives with every numeric space-padded and every missing numeric a bare
 * `.`, so it is not a usable CSV as delivered.
 *
 * `guardFormulaInjection` (12e, off by default) is threaded straight through
 * to every `formatCsvPage` call — cheap here since this class already builds
 * every cell itself rather than relaying server bytes.
 */

import * as vscode from "vscode";

import { type CasAdapter } from "./adapter";
import { formatCsvPage, pageRowsFor } from "./csvFormat";
import { localiseCasProblem } from "./messages";
import { type CasProblem, describeCasProblem } from "./problems";
import {
  type CasColumnItem,
  type CasTableDetail,
  type CasTableItem,
} from "./types";
import {
  streamCsvPages,
  type CsvExportFailure,
  type CsvExportResult,
  type CsvExportSource,
  type CsvSink,
} from "../data/csvExportModel";

export class CasCsvSource implements CsvExportSource {
  readonly name: string;
  readonly logPrefix = vscode.l10n.t("CAS");
  /** Finding 11.6: a 555,856-row, 76-column table is roughly 500 MB as CSV and
   * takes on the order of one to two seconds per 500-row page — many minutes
   * to an hour — while a table of a few thousand rows is a few MB and seconds.
   * 100 MB (about 100 pages of a wide table) is where a person should be asked
   * first rather than discover the cost from a progress bar. */
  readonly confirmAboveBytes = 100 * 1024 * 1024;

  private detail: CasTableDetail | undefined;
  private columns: readonly CasColumnItem[] = [];

  constructor(
    private readonly adapter: CasAdapter,
    private readonly table: CasTableItem,
    private readonly guardFormulaInjection = false,
  ) {
    this.name = `${table.caslibName}.${table.name}`;
  }

  async open(
    signal?: AbortSignal,
  ): Promise<CsvExportResult<{ rowCount: number | undefined }>> {
    const opened = await this.adapter.openTable(this.table, signal);
    if (!opened.ok) return fail(opened.problem);
    const columns = await this.adapter.getColumns(opened.value, signal);
    if (!columns.ok) return fail(columns.problem);
    this.detail = opened.value;
    this.columns = columns.value;

    // The listing's own `rowCount` reads `0` for a table that was unloaded
    // when it was listed (Finding 8.3) — the first `rows` reply's `count` is
    // the live total (Finding 8.12).
    const probe = await this.adapter.getRows(
      opened.value,
      { start: 0, limit: 1 },
      [],
      "",
      signal,
    );
    if (!probe.ok) return fail(probe.problem);
    return { ok: true, value: { rowCount: probe.value.count } };
  }

  async sample(
    limit: number,
    signal?: AbortSignal,
  ): Promise<CsvExportResult<string>> {
    return await this.readPage({ start: 0, limit }, true, signal);
  }

  async stream(
    sink: CsvSink,
    signal?: AbortSignal,
  ): Promise<CsvExportResult<void>> {
    return await streamCsvPages(
      (window, first, pageSignal) => this.readPage(window, first, pageSignal),
      pageRowsFor(this.columns.length),
      sink,
      signal,
    );
  }

  private async readPage(
    window: { readonly start: number; readonly limit: number },
    includeHeader: boolean,
    signal: AbortSignal | undefined,
  ): Promise<CsvExportResult<string>> {
    const detail = this.detail;
    if (detail === undefined) {
      return {
        ok: false,
        message: vscode.l10n.t("The table is not open yet."),
        logDetail: "the table is not open yet",
      };
    }
    const page = await this.adapter.getRows(detail, window, [], "", signal);
    if (!page.ok) return fail(page.problem);
    return {
      ok: true,
      value: formatCsvPage(
        this.columns,
        page.value.rows,
        includeHeader,
        this.guardFormulaInjection,
      ),
    };
  }
}

function fail(problem: CasProblem): CsvExportFailure {
  return {
    ok: false,
    message: localiseCasProblem(problem),
    logDetail: describeCasProblem(problem),
  };
}
