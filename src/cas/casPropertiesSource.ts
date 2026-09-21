// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `PropertiesSource` (`../data/propertiesSource.ts`) for a CAS table
 * (11d, F2) — `pythonOnViya.showCasTableProperties`.
 *
 * Reads the table's own `casManagement` representation
 * (`CasAdapter.getTableProperties`) plus the column listing 8a's tree already
 * reads (`getColumns`), so it needs no `dataTable`/`rowSets` hop at all.
 * Fields this deployment's CAS does not report (`engine`, `format`,
 * `informat`, record lengths — Finding 11.5) are simply not rows; nothing here
 * invents a value for a SAS-library-only concept.
 */

import * as vscode from "vscode";

import { type CasAdapter } from "./adapter";
import { localiseCasProblem } from "./messages";
import { type CasProblem, describeCasProblem } from "./problems";
import { type CasTableItem } from "./types";
import {
  type PropertiesSource,
  type PropertiesView,
} from "../data/propertiesSource";
import {
  formatOptionalNumber,
  formatTimestamp,
} from "../data/tablePropertiesModel";
import { type TableSourceResult } from "../data/tableSource";

export class CasPropertiesSource implements PropertiesSource {
  readonly key: string;
  readonly title: string;
  readonly heading: string;

  constructor(
    private readonly adapter: CasAdapter,
    private readonly table: CasTableItem,
  ) {
    // Endpoint-keyed for the same reason `CasTableSource.key` is: two
    // deployments can expose identical server/caslib/table names.
    this.key = `cas-properties:${adapter.endpoint}\n${table.serverName}.${table.caslibName}.${table.name}`;
    this.heading = `${table.caslibName}.${table.name}`;
    this.title = vscode.l10n.t("Properties: {0}", this.heading);
  }

  async load(signal?: AbortSignal): Promise<TableSourceResult<PropertiesView>> {
    const properties = await this.adapter.getTableProperties(
      this.table,
      signal,
    );
    if (!properties.ok) return fail(properties.problem);
    // `getTableProperties` has loaded the table by now, but `this.table` is
    // the pre-load listing entry, whose stale `state` would make `getColumns`
    // issue a second, redundant load. Stamp it loaded, as `openTable` does for
    // the same reason.
    const columns = await this.adapter.getColumns(
      { ...this.table, state: "loaded" },
      signal,
    );
    if (!columns.ok) return fail(columns.problem);

    const p = properties.value;
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
              { label: vscode.l10n.t("Name"), value: p.name },
              { label: vscode.l10n.t("Caslib"), value: p.caslibName },
              { label: vscode.l10n.t("Server"), value: p.serverName },
              { label: vscode.l10n.t("State"), value: text(p.state) },
              { label: vscode.l10n.t("Scope"), value: text(p.scope) },
              { label: vscode.l10n.t("Created By"), value: text(p.createdBy) },
            ],
          },
          {
            title: vscode.l10n.t("Size Information"),
            rows: [
              {
                label: vscode.l10n.t("Row Count"),
                value: formatOptionalNumber(p.rowCount),
              },
              {
                label: vscode.l10n.t("Column Count"),
                value: formatOptionalNumber(p.columnCount),
              },
            ],
          },
          {
            title: vscode.l10n.t("Technical Information"),
            rows: [
              { label: vscode.l10n.t("Created"), value: time(p.created) },
              {
                label: vscode.l10n.t("Modified"),
                value: time(p.lastModified),
              },
              {
                label: vscode.l10n.t("Last Accessed"),
                value: time(p.lastAccessed),
              },
              { label: vscode.l10n.t("Encoding"), value: text(p.encoding) },
              {
                label: vscode.l10n.t("Character Set"),
                value: text(p.characterSet),
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
            vscode.l10n.t("Label"),
          ],
          rows: columns.value.map((column, index) => [
            String(index + 1),
            column.name,
            column.type,
            formatOptionalNumber(column.rawLength),
            text(column.label),
          ]),
        },
      },
    };
  }
}

function fail(problem: CasProblem): TableSourceResult<never> {
  return {
    ok: false,
    message: localiseCasProblem(problem),
    logDetail: describeCasProblem(problem),
  };
}
