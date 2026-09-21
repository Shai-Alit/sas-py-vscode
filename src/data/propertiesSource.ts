// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * What `tablePropertiesPanel.ts`'s static viewer needs from a table's own
 * backend, independent of which Viya service supplies it — the same idea, one
 * level up, as `./tableSource.ts` is for the data viewer's rows (11d: the
 * panel serves a CAS table as well as a SAS library table, F2).
 *
 * **This module must never import `vscode`.**
 *
 * A source hands the panel finished, localised, **plain** text — never HTML.
 * The panel escapes every value exactly once, so a backend's own free text (a
 * column label a data steward typed) can never reach the page unescaped
 * however a source builds it.
 */

import { type TableSourceResult } from "./tableSource";

/** One "label: value" line of a properties section. */
export interface PropertiesRow {
  readonly label: string;
  readonly value: string;
}

/** A titled group of {@link PropertiesRow}s — "General Information", … */
export interface PropertiesSection {
  readonly title: string;
  readonly rows: readonly PropertiesRow[];
}

/** The "Columns" tab's grid: a header row, then one array of cells per column
 * (already including any leading `#` index cell). */
export interface PropertiesGrid {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** Everything the panel renders once a source has loaded. */
export interface PropertiesView {
  readonly sections: readonly PropertiesSection[];
  readonly columns: PropertiesGrid;
}

/** One table's properties, already identified. */
export interface PropertiesSource {
  /** Unique across every open properties panel — the manager's dedup key. */
  readonly key: string;
  /** The panel's tab title. */
  readonly title: string;
  /** The `<h1>` of every render — the table's qualified name. */
  readonly heading: string;
  /** Fetches and shapes the view. A rejection (rather than a failed result) is
   * an unanticipated failure the panel renders and then rethrows. */
  load(signal?: AbortSignal): Promise<TableSourceResult<PropertiesView>>;
}
