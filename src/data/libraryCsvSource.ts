// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `CsvExportSource` (`./csvExportModel.ts`) for a SAS library table —
 * 7c-iii's export. Split out of `csvExportCommand.ts` in 11d only so the
 * same command can serve a CAS table (`src/cas/casCsvSource.ts`) too.
 *
 * **Every page is the server's own `rowsAsCSV` response relayed untouched
 * (Finding 7.20), unless `guardFormulaInjection` is on.** That default is
 * unchanged from 7c-iii/11d — `exportTableToCsv` (`./csvExportModel.ts`) is
 * still called as-is, with no re-serialization of its own, when the guard
 * (12e, `pythonOnViya.csvExport.guardFormulaInjection`, off by default) is
 * not requested. Only an opted-in export pays the cost this module's own
 * `guard` method describes: parsing each already-quoted page back into
 * fields and re-encoding it, both via `./csvParse.ts`, so a character
 * column's cell can be escaped (`./csvFormulaGuard.ts`) before the page is
 * written. `getColumns` is fetched once, in `open`, and only when the guard
 * is on — the export never pays for column metadata it will not use.
 */

import * as vscode from "vscode";

import { type DataFailure, type LibraryAdapter } from "./adapter";
import {
  exportTableToCsv,
  streamCsvPages,
  CSV_EXPORT_PAGE_SIZE,
  type CsvExportFailure,
  type CsvExportResult,
  type CsvExportSource,
  type CsvSink,
} from "./csvExportModel";
import { escapeCsvFormula, isTextColumnType } from "./csvFormulaGuard";
import { csvField, parseCsvPage } from "./csvParse";
import { localiseDataProblem } from "./messages";
import { describeDataProblem } from "./problems";
import { type Column, type TableDetail, type TableItem } from "./types";

export class LibraryCsvSource implements CsvExportSource {
  readonly name: string;
  readonly logPrefix = vscode.l10n.t("SAS Libraries");
  /** The same 100 MB `CasCsvSource` asks above, so one setting of
   * expectations holds across both export surfaces. Finding 12.12: a
   * 250,000-row, 20-column `WORK` table read about 300 bytes a row and 0.47 s
   * a 500-row page, flat from the first page to the last — so 100 MB is
   * roughly 5 minutes of paging here, the same order as the CAS side's own
   * rationale. The estimate needs `rowCount`, which that probe found
   * populated on a Compute table's representation. */
  readonly confirmAboveBytes = 100 * 1024 * 1024;

  private detail: TableDetail | undefined;
  private columns: readonly Column[] = [];

  constructor(
    private readonly item: TableItem,
    private readonly adapter: LibraryAdapter,
    private readonly guardFormulaInjection = false,
  ) {
    this.name = `${item.libref}.${item.name}`;
  }

  async open(
    signal?: AbortSignal,
  ): Promise<CsvExportResult<{ rowCount: number | undefined }>> {
    const opened = await this.adapter.openTable(this.item, signal);
    if (!opened.ok) return fail(opened);
    this.detail = opened.value;

    if (this.guardFormulaInjection) {
      const columns = await this.adapter.getColumns(opened.value, signal);
      if (!columns.ok) return fail(columns);
      this.columns = columns.value;
    }

    return { ok: true, value: { rowCount: opened.value.rowCount } };
  }

  async sample(
    limit: number,
    signal?: AbortSignal,
  ): Promise<CsvExportResult<string>> {
    const detail = this.detail;
    if (detail === undefined) return notOpenYet();
    const page = await this.adapter.getRowsAsCsv(
      detail,
      { start: 0, limit },
      true,
      undefined,
      signal,
    );
    if (!page.ok) return fail(page);
    return { ok: true, value: this.guard(page.value, true) };
  }

  async stream(
    sink: CsvSink,
    signal?: AbortSignal,
  ): Promise<CsvExportResult<void>> {
    const detail = this.detail;
    if (detail === undefined) return notOpenYet();

    if (!this.guardFormulaInjection) {
      const result = await exportTableToCsv(this.adapter, detail, sink, signal);
      return result.ok ? result : fail(result);
    }

    const result = await streamCsvPages<DataFailure>(
      async (window, includeHeader, pageSignal) => {
        const page = await this.adapter.getRowsAsCsv(
          detail,
          window,
          includeHeader,
          undefined,
          pageSignal,
        );
        if (!page.ok) return page;
        return { ok: true, value: this.guard(page.value, includeHeader) };
      },
      CSV_EXPORT_PAGE_SIZE,
      sink,
      signal,
    );
    return result.ok ? result : fail(result);
  }

  /**
   * Re-parses `csvPageText` (already RFC-4180-quoted, straight off the
   * server) and re-encodes it field by field, escaping a character column's
   * cell when it begins with a formula-triggering character
   * (`./csvFormulaGuard.ts`). `includeHeader` skips the first row — a column
   * name is metadata, not exported row data, matching
   * `../cas/csvFormat.ts`'s own header handling.
   *
   * **A no-op when the guard is off** — `sample` is this method's only
   * caller with no `stream`-style early return of its own to rely on.
   * `this.columns` is empty in that case ({@link open} never populated it),
   * so every field's `isText[index]` below would read `undefined` and fall
   * through to this method's own `?? true` default — guarding everything
   * regardless of the setting, not the intended no-op. This check is what
   * actually keeps the off path byte-for-byte untouched, not just usually
   * so.
   */
  private guard(csvPageText: string, includeHeader: boolean): string {
    // The `""` check is `streamCsvPages`'s (`./csvExportModel.ts`)
    // end-of-table sentinel, returned as-is rather than parsed — relying on
    // Finding 7.20 (`phase-7.md`): the server's line endings are a bare
    // `\n`, so `parseCsvPage` never drops an entire non-empty page down to
    // zero rows on its own. If that ever changed, a page of only dropped
    // characters (e.g. a bare `\r`) would parse to `[]` here and this guard
    // would return `""`, which `streamCsvPages` reads as "past the end of
    // the table" — a silently truncated export, not a crash.
    if (!this.guardFormulaInjection || csvPageText === "") return csvPageText;
    const isText = this.columns.map((column) => isTextColumnType(column.type));

    const lines = parseCsvPage(csvPageText).map((row, rowIndex) => {
      const isHeaderRow = includeHeader && rowIndex === 0;
      return row
        .map((field, index) => {
          const guarded =
            !isHeaderRow && (isText[index] ?? true)
              ? escapeCsvFormula(field)
              : field;
          return csvField(guarded);
        })
        .join(",");
    });
    return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
  }
}

function fail(result: DataFailure): CsvExportFailure {
  return {
    ok: false,
    message: localiseDataProblem(result.problem),
    logDetail: describeDataProblem(result.problem),
  };
}

function notOpenYet(): CsvExportFailure {
  return {
    ok: false,
    message: vscode.l10n.t("The table is not open yet."),
    logDetail: "the table is not open yet",
  };
}
