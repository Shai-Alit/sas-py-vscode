// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `CsvExportSource` (`./csvExportModel.ts`) for a SAS library table —
 * 7c-iii's export, unchanged in behaviour: every page is the server's own
 * `rowsAsCSV` response relayed untouched (Finding 7.20). Split out of
 * `csvExportCommand.ts` in 11d only so the same command can serve a CAS table
 * (`src/cas/casCsvSource.ts`) too.
 */

import * as vscode from "vscode";

import { type DataFailure, type LibraryAdapter } from "./adapter";
import {
  exportTableToCsv,
  type CsvExportFailure,
  type CsvExportResult,
  type CsvExportSource,
  type CsvSink,
} from "./csvExportModel";
import { localiseDataProblem } from "./messages";
import { describeDataProblem } from "./problems";
import { type TableDetail, type TableItem } from "./types";

export class LibraryCsvSource implements CsvExportSource {
  readonly name: string;
  readonly logPrefix = "SAS Libraries";

  private detail: TableDetail | undefined;

  constructor(
    private readonly item: TableItem,
    private readonly adapter: LibraryAdapter,
  ) {
    this.name = `${item.libref}.${item.name}`;
  }

  async open(
    signal?: AbortSignal,
  ): Promise<CsvExportResult<{ rowCount: number | undefined }>> {
    const opened = await this.adapter.openTable(this.item, signal);
    if (!opened.ok) return fail(opened);
    this.detail = opened.value;
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
    return page.ok ? page : fail(page);
  }

  async stream(
    sink: CsvSink,
    signal?: AbortSignal,
  ): Promise<CsvExportResult<void>> {
    const detail = this.detail;
    if (detail === undefined) return notOpenYet();
    const result = await exportTableToCsv(this.adapter, detail, sink, signal);
    return result.ok ? result : fail(result);
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
