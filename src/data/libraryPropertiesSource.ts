// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `PropertiesSource` (`./propertiesSource.ts`) for a SAS library table —
 * 7c-ii's own field set, moved here unchanged from `tablePropertiesPanel.ts`
 * when 11d generalised the panel (the "General"/"Size"/"Technical" grouping
 * matches upstream's own `TablePropertiesViewer.ts`).
 */

import * as vscode from "vscode";

import { type LibraryAdapter } from "./adapter";
import { localiseDataProblem } from "./messages";
import { describeDataProblem } from "./problems";
import { type PropertiesSource, type PropertiesView } from "./propertiesSource";
import { formatOptionalNumber, formatTimestamp } from "./tablePropertiesModel";
import { type TableSourceResult } from "./tableSource";
import { type TableItem } from "./types";

export class LibraryPropertiesSource implements PropertiesSource {
  readonly key: string;
  readonly title: string;
  readonly heading: string;

  constructor(
    private readonly table: TableItem,
    private readonly adapter: LibraryAdapter,
  ) {
    // Scoped by profile, not just libref.name — the identical cross-profile
    // leak `DataViewerPanelManager.open` guards against: two profiles can hold
    // live sessions at once, and a table name like SASHELP.CLASS exists under
    // virtually every deployment.
    this.key = `${adapter.profileId}\n${table.libref}.${table.name}`;
    this.heading = `${table.libref}.${table.name}`;
    this.title = vscode.l10n.t("Properties: {0}", this.heading);
  }

  async load(signal?: AbortSignal): Promise<TableSourceResult<PropertiesView>> {
    const opened = await this.adapter.openTable(this.table, signal);
    if (!opened.ok) {
      return {
        ok: false,
        message: localiseDataProblem(opened.problem),
        logDetail: describeDataProblem(opened.problem),
      };
    }
    const columns = await this.adapter.getColumns(opened.value, signal);
    if (!columns.ok) {
      return {
        ok: false,
        message: localiseDataProblem(columns.problem),
        logDetail: describeDataProblem(columns.problem),
      };
    }

    const detail = opened.value;
    const text = (value: string | undefined): string => value ?? "";
    const time = (value: string | undefined): string =>
      value === undefined ? "" : formatTimestamp(value);

    return {
      ok: true,
      value: {
        sections: [
          {
            title: vscode.l10n.t("General Information"),
            rows: [
              { label: vscode.l10n.t("Name"), value: detail.name },
              { label: vscode.l10n.t("Library"), value: detail.libref },
              { label: vscode.l10n.t("Type"), value: text(detail.type) },
              { label: vscode.l10n.t("Label"), value: text(detail.label) },
              { label: vscode.l10n.t("Engine"), value: text(detail.engine) },
              {
                label: vscode.l10n.t("Extended Type"),
                value: text(detail.extendedType),
              },
            ],
          },
          {
            title: vscode.l10n.t("Size Information"),
            rows: [
              {
                label: vscode.l10n.t("Row Count"),
                value: formatOptionalNumber(detail.rowCount),
              },
              {
                label: vscode.l10n.t("Column Count"),
                value: formatOptionalNumber(detail.columnCount),
              },
              {
                label: vscode.l10n.t("Logical Record Count"),
                value: formatOptionalNumber(detail.logicalRecordCount),
              },
              {
                label: vscode.l10n.t("Physical Record Count"),
                value: formatOptionalNumber(detail.physicalRecordCount),
              },
              {
                label: vscode.l10n.t("Record Length"),
                value: formatOptionalNumber(detail.recordLength),
              },
            ],
          },
          {
            title: vscode.l10n.t("Technical Information"),
            rows: [
              {
                label: vscode.l10n.t("Created"),
                value: time(detail.creationTimeStamp),
              },
              {
                label: vscode.l10n.t("Modified"),
                value: time(detail.modifiedTimeStamp),
              },
              {
                label: vscode.l10n.t("Compression Routine"),
                value: text(detail.compressionRoutine),
              },
              {
                label: vscode.l10n.t("Encoding"),
                value: text(detail.encoding),
              },
              {
                label: vscode.l10n.t("Bookmark Length"),
                value: formatOptionalNumber(detail.bookmarkLength),
              },
            ],
          },
        ],
        columns: {
          headers: [
            "#",
            vscode.l10n.t("Name"),
            vscode.l10n.t("Type"),
            vscode.l10n.t("Length"),
            vscode.l10n.t("Format"),
            vscode.l10n.t("Informat"),
            vscode.l10n.t("Label"),
          ],
          rows: columns.value.map((column, index) => [
            String(index + 1),
            column.name,
            column.type,
            formatOptionalNumber(column.length),
            text(column.format),
            text(column.informat),
            text(column.label),
          ]),
        },
      },
    };
  }
}
