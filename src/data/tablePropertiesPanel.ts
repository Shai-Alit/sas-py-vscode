// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Owns 7c-ii's table properties/columns viewer — a **fully static** panel,
 * unlike 7b's data viewer (`dataViewerPanel.ts`, ADR-0028) and the run
 * result panel (`resultPanel.ts`, ADR-0021), neither of which this file
 * ports code from beyond the general "one panel per open thing, keyed and
 * revealed the same way" shape.
 *
 * **No host↔webview message loop at all — and no `<script>` either.**
 * Upstream's own `TablePropertiesViewer.ts` fetches once and renders once
 * too, but still ships a small client-side script to toggle between its
 * "Properties" and "Columns" tabs. This panel gets the same two-tab UX with
 * **zero JavaScript**: the tabs are two `<input type="radio">` elements with
 * `<label>`s styled as tab buttons, and the two content panes are shown or
 * hidden by a plain CSS sibling selector keyed off which radio is `:checked`
 * (`buildHtml`'s own doc comment has the exact rule). This means
 * `enableScripts` is `false` — the only one of this project's three webview
 * panels that needs no script execution at all — and there is nothing here
 * for a `"ready"` handshake to coordinate: the panel's whole content is set
 * once, after `LibraryAdapter.openTable`/`getColumns` resolve (or fail), with
 * a "Loading…" placeholder shown in between.
 *
 * **Column and row data.** `openTable`/`getColumns` are the same
 * `src/data/adapter.ts` methods 7b's data viewer already calls — this class
 * adds no adapter surface of its own, only a different renderer for the same
 * `TableDetail`/`Column[]` pair, now that `TableDetail` carries the fuller
 * `TableInfo` field set 7c-ii needs (`src/data/types.ts`, Finding 7.19).
 */

import * as vscode from "vscode";

import { type LibraryAdapter } from "./adapter";
import { localiseDataProblem } from "./messages";
import {
  escapeHtml,
  formatOptionalNumber,
  formatOptionalText,
  formatOptionalTimestamp,
} from "./tablePropertiesModel";
import { type Column, type TableDetail, type TableItem } from "./types";

const VIEW_TYPE = "pythonOnViya.tableProperties";

/** The surface of `vscode.WebviewPanel`/`vscode.Webview` this class actually
 * uses — narrower than `DataWebviewPanel`/`ResultWebviewPanel`, since this
 * panel never receives or posts a message: `webview.html` is set once with
 * the final content (or a "Loading…" placeholder, then the final content),
 * and nothing ever calls back into the extension. No `cspSource` — the CSP
 * is nonce-locked (`panelHead`'s own doc comment), not `cspSource`-scoped,
 * since this panel loads no external resource at all. */
export interface TablePropertiesWebviewPanel extends vscode.Disposable {
  readonly webview: {
    html: string;
  };
  reveal(viewColumn?: vscode.ViewColumn, preserveFocus?: boolean): void;
  onDidDispose(listener: () => void): vscode.Disposable;
}

/** The one port this class would otherwise reach for on the `vscode`
 * namespace directly — same reasoning as `DataViewerPanelDeps.createPanel`. */
export interface TablePropertiesPanelDeps {
  createPanel?: ((title: string) => TablePropertiesWebviewPanel) | undefined;
}

export class TablePropertiesPanelManager implements vscode.Disposable {
  private readonly panels = new Map<string, TablePropertiesPanel>();

  constructor(private readonly deps: TablePropertiesPanelDeps = {}) {}

  /** Opens `table`'s properties, using `adapter` (already bound to the
   * active profile) for the one `openTable`/`getColumns` fetch this panel
   * ever makes. Reveals the existing panel, without any new request, if this
   * table's properties are already open.
   *
   * Returns a promise that resolves once that fetch has settled
   * (successfully or not) — for the same reason `DataViewerPanelManager.open`
   * does: a command handler does not need it, but an integration test driving
   * this class directly does. */
  async open(table: TableItem, adapter: LibraryAdapter): Promise<void> {
    // Scoped by profile, not just libref.name — the identical cross-profile
    // leak `DataViewerPanelManager.open` guards against (its own doc
    // comment): two profiles can hold live sessions at once
    // (`ComputeSessionManager.live`), and a table name like SASHELP.CLASS
    // exists under virtually every deployment.
    const key = `${adapter.profileId}\n${table.libref}.${table.name}`;
    const existing = this.panels.get(key);
    if (existing !== undefined) {
      existing.reveal();
      return;
    }

    const title = vscode.l10n.t(
      "Properties: {0}",
      `${table.libref}.${table.name}`,
    );
    const panel = new TablePropertiesPanel(
      table,
      adapter,
      this.deps.createPanel?.(title) ?? createRealPanel(title),
      () => this.panels.delete(key),
    );
    this.panels.set(key, panel);
    await panel.start();
  }

  dispose(): void {
    for (const panel of this.panels.values()) panel.dispose();
    this.panels.clear();
  }
}

/** One open table's own properties panel. Not exported: the manager above is
 * the module's whole public surface, matching `OpenTablePanel`'s own
 * "nothing outside needs the panel object itself" shape. */
class TablePropertiesPanel implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[] = [];
  /** Aborted on dispose, and checked by {@link render} before it ever touches
   * `this.panel.webview.html` — a user can close this panel while
   * `openTable`/`getColumns` is still in flight, and there is no reason to
   * render into a panel that no longer exists. */
  private readonly controller = new AbortController();
  private disposed = false;

  constructor(
    private readonly table: TableItem,
    private readonly adapter: LibraryAdapter,
    private readonly panel: TablePropertiesWebviewPanel,
    private readonly onDisposed: () => void,
  ) {}

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Active, false);
  }

  async start(): Promise<void> {
    this.panel.webview.html = buildLoadingHtml(this.table);

    this.subscriptions.push(
      this.panel.onDidDispose(() => {
        this.disposed = true;
        this.controller.abort();
        for (const subscription of this.subscriptions) subscription.dispose();
        this.subscriptions.length = 0;
        this.onDisposed();
      }),
    );

    // PR review, 2026-09-11 (Codex, Major): `openTable`/`getColumns` are
    // total for every failure they anticipate (a `DataResult`, never a
    // rejection) — *except* the one narrow path `dataExplorer.ts`'s own
    // command handler already documents: `ComputeClient.send` rethrows
    // whatever `resolveHref` throws that is not a `ForeignLinkError`. Before
    // this `try` existed, that rejection propagated straight out of
    // `start()` with the panel left stuck on "Loading…" forever — the
    // command handler's own `.catch` still logged it, but nothing ever told
    // the user. Rendering a failure here, then rethrowing, keeps both: the
    // panel degrades to a real message, and the caller's own log entry still
    // fires unchanged.
    try {
      const opened = await this.adapter.openTable(
        this.table,
        this.controller.signal,
      );
      if (!opened.ok) {
        this.render(
          buildFailureHtml(this.table, localiseDataProblem(opened.problem)),
        );
        return;
      }

      const columns = await this.adapter.getColumns(
        opened.value,
        this.controller.signal,
      );
      if (!columns.ok) {
        this.render(
          buildFailureHtml(this.table, localiseDataProblem(columns.problem)),
        );
        return;
      }

      this.render(buildPropertiesHtml(this.table, opened.value, columns.value));
    } catch (error) {
      this.render(
        buildFailureHtml(
          this.table,
          localiseDataProblem({
            code: "compute",
            problem: { code: "compute-unreachable", detail: messageOf(error) },
          }),
        ),
      );
      throw error;
    }
  }

  /** Writes `html` to the panel's webview — unless the panel has been
   * disposed since the fetch that produced `html` was started, in which case
   * there is nothing left to write into. A fresh call each time (rather than
   * one inline `if (this.disposed) return;` reused across all three render
   * sites in {@link start}) deliberately: `this.disposed` is flipped by a
   * callback registered elsewhere (`onDidDispose`, in `start`), not by
   * anything in this method's own control flow, and TypeScript's control-flow
   * narrowing does not know that — reusing one guard across multiple `await`
   * points let it narrow `this.disposed` to a compile-time `false` after the
   * first check, which is wrong at runtime (the callback can still run during
   * the next `await`) and which `@typescript-eslint/no-unnecessary-condition`
   * caught as a real, if surprising, finding. */
  private render(html: string): void {
    if (this.disposed) return;
    this.panel.webview.html = html;
  }

  dispose(): void {
    this.panel.dispose();
  }
}

/** The message of a thrown value, and nothing else it might be carrying — the
 * same small helper `compute/client.ts`/`content/client.ts`/`dialects/probe.ts`/
 * `dataViewerPanel.ts` each carry their own copy of. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function createRealPanel(title: string): TablePropertiesWebviewPanel {
  return vscode.window.createWebviewPanel(
    VIEW_TYPE,
    title,
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
    // No `enableScripts` — this panel's own tab-toggle is pure CSS (see the
    // module doc comment and `buildHtml`'s own comment), so the default
    // (scripts disabled) is exactly right, not an oversight. No
    // `localResourceRoots` either: nothing here loads a bundled asset.
    { retainContextWhenHidden: false },
  );
}

/** The CSP and HTML shell shared by every render this panel ever performs —
 * loading, failure, and the final properties view all share one `<head>`.
 *
 * ```
 * default-src 'none';
 * style-src 'nonce-{nonce}';
 * ```
 *
 * **No `script-src` at all** — `default-src 'none'` already forbids a script
 * with no directive naming one, and there is no `<script>` tag anywhere in
 * this panel's output, unlike the other two panels this project ships.
 *
 * **`style-src` is nonce-locked, not `'unsafe-inline'`.** An earlier version
 * of this comment argued `'unsafe-inline'` was safe here because every
 * dynamic value is `escapeHtml`-escaped before it reaches the page — true,
 * but PR review on this slice (2026-09-11) correctly pointed out that
 * relying solely on this file's own escaping discipline is weaker than not
 * needing the exception at all. Unlike `dataViewerPanel.ts` (which genuinely
 * needs `'unsafe-inline'`: `ag-grid`'s own runtime sets `style="…"`
 * *attributes* on arbitrary elements it renders, and a CSP nonce cannot
 * cover an attribute, only a `<style>`/`<script>` element that carries the
 * matching nonce), this panel has exactly one `<style>` *element* and zero
 * inline `style="…"` attributes anywhere in its generated markup — so a
 * nonce on that one element, the same mechanism `resultPanel.ts`/
 * `dataViewerPanel.ts` already use for their own `<script>` tag, removes the
 * exception entirely rather than merely justifying it.
 */
function panelHead(): string {
  const nonce = crypto.randomUUID();
  const csp = ["default-src 'none';", `style-src 'nonce-${nonce}';`].join(" ");

  const lang = /^[a-z]{2,3}(-[a-z0-9]+)*$/i.test(vscode.env.language)
    ? vscode.env.language
    : "en";

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style nonce="${nonce}">
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background-color: var(--vscode-editor-background);
    padding: 4px 12px;
  }
  .python-on-viya-table-properties-tab-input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .python-on-viya-table-properties-tabs {
    border-bottom: 1px solid var(--vscode-panel-border);
    margin-bottom: 8px;
  }
  .python-on-viya-table-properties-tabs label {
    display: inline-block;
    padding: 4px 12px;
    cursor: pointer;
    border-bottom: 2px solid transparent;
  }
  /* Adjacent-sibling, not general: this is the label immediately after its
     own radio, which is the one that radio's own checked state should style —
     see this file's own doc comment on why the tab toggle needs no script. */
  #python-on-viya-tab-properties:checked + label,
  #python-on-viya-tab-columns:checked + label {
    border-bottom-color: var(--vscode-focusBorder);
  }
  .python-on-viya-table-properties-pane { display: none; }
  #python-on-viya-tab-properties:checked ~ #python-on-viya-pane-properties,
  #python-on-viya-tab-columns:checked ~ #python-on-viya-pane-columns {
    display: block;
  }
  .python-on-viya-table-properties-section-title {
    font-weight: 600;
    margin: 12px 0 4px;
  }
  table.python-on-viya-table-properties-table {
    border-collapse: collapse;
    width: 100%;
  }
  table.python-on-viya-table-properties-table td,
  table.python-on-viya-table-properties-table th {
    border: 1px solid var(--vscode-panel-border);
    padding: 2px 8px;
    text-align: left;
  }
  table.python-on-viya-table-properties-table td.python-on-viya-table-properties-label {
    font-weight: 600;
    white-space: nowrap;
  }
  .python-on-viya-table-properties-failure {
    color: var(--vscode-errorForeground);
  }
</style>
</head>`;
}

/** Shown the instant the panel opens, before `openTable`/`getColumns` have
 * resolved — replaced in place once they do (success or failure). */
function buildLoadingHtml(table: TableItem): string {
  return `${panelHead()}
<body>
<h1>${escapeHtml(`${table.libref}.${table.name}`)}</h1>
<p>${escapeHtml(vscode.l10n.t("Loading…"))}</p>
</body>
</html>`;
}

/** Shown when `openTable` or `getColumns` fails — `message` is already
 * localised (`localiseDataProblem`), the same panel-facing text
 * `dataViewerPanel.ts`'s own `FailureMessage` carries for the identical pair
 * of calls. */
function buildFailureHtml(table: TableItem, message: string): string {
  return `${panelHead()}
<body>
<h1>${escapeHtml(`${table.libref}.${table.name}`)}</h1>
<p class="python-on-viya-table-properties-failure">${escapeHtml(message)}</p>
</body>
</html>`;
}

/** The panel's real content: a "Properties" tab (three sections of
 * `TableDetail`'s own field set — matching `TablePropertiesViewer.ts`'s own
 * "General"/"Size"/"Technical" grouping) and a "Columns" tab (one row per
 * `Column`, its full field set). Every field is optional; an absent one
 * renders as an empty cell, via `tablePropertiesModel.ts`'s own
 * `formatOptional*` helpers, rather than this function branching on each one
 * itself. */
function buildPropertiesHtml(
  table: TableItem,
  detail: TableDetail,
  columns: readonly Column[],
): string {
  const row = (label: string, value: string): string => `
    <tr>
      <td class="python-on-viya-table-properties-label">${escapeHtml(label)}</td>
      <td>${value}</td>
    </tr>`;

  const generalRows = [
    row(vscode.l10n.t("Name"), escapeHtml(detail.name)),
    row(vscode.l10n.t("Library"), escapeHtml(detail.libref)),
    row(vscode.l10n.t("Type"), formatOptionalText(detail.type)),
    row(vscode.l10n.t("Label"), formatOptionalText(detail.label)),
    row(vscode.l10n.t("Engine"), formatOptionalText(detail.engine)),
    row(
      vscode.l10n.t("Extended Type"),
      formatOptionalText(detail.extendedType),
    ),
  ].join("");

  const sizeRows = [
    row(vscode.l10n.t("Row Count"), formatOptionalNumber(detail.rowCount)),
    row(
      vscode.l10n.t("Column Count"),
      formatOptionalNumber(detail.columnCount),
    ),
    row(
      vscode.l10n.t("Logical Record Count"),
      formatOptionalNumber(detail.logicalRecordCount),
    ),
    row(
      vscode.l10n.t("Physical Record Count"),
      formatOptionalNumber(detail.physicalRecordCount),
    ),
    row(
      vscode.l10n.t("Record Length"),
      formatOptionalNumber(detail.recordLength),
    ),
  ].join("");

  const technicalRows = [
    row(
      vscode.l10n.t("Created"),
      formatOptionalTimestamp(detail.creationTimeStamp),
    ),
    row(
      vscode.l10n.t("Modified"),
      formatOptionalTimestamp(detail.modifiedTimeStamp),
    ),
    row(
      vscode.l10n.t("Compression Routine"),
      formatOptionalText(detail.compressionRoutine),
    ),
    row(vscode.l10n.t("Encoding"), formatOptionalText(detail.encoding)),
    row(
      vscode.l10n.t("Bookmark Length"),
      formatOptionalNumber(detail.bookmarkLength),
    ),
  ].join("");

  const columnRows = columns
    .map(
      (column, index) => `
    <tr>
      <td>${String(index + 1)}</td>
      <td>${escapeHtml(column.name)}</td>
      <td>${escapeHtml(column.type)}</td>
      <td>${formatOptionalNumber(column.length)}</td>
      <td>${formatOptionalText(column.format)}</td>
      <td>${formatOptionalText(column.informat)}</td>
      <td>${formatOptionalText(column.label)}</td>
    </tr>`,
    )
    .join("");

  return `${panelHead()}
<body>
<h1>${escapeHtml(`${table.libref}.${table.name}`)}</h1>
<div class="python-on-viya-table-properties-tabs">
<input type="radio" name="python-on-viya-table-properties-tab" id="python-on-viya-tab-properties" class="python-on-viya-table-properties-tab-input" checked>
<label for="python-on-viya-tab-properties">${escapeHtml(vscode.l10n.t("Properties"))}</label>
<input type="radio" name="python-on-viya-table-properties-tab" id="python-on-viya-tab-columns" class="python-on-viya-table-properties-tab-input">
<label for="python-on-viya-tab-columns">${escapeHtml(vscode.l10n.t("Columns"))}</label>
</div>
<div id="python-on-viya-pane-properties" class="python-on-viya-table-properties-pane">
<div class="python-on-viya-table-properties-section-title">${escapeHtml(vscode.l10n.t("General Information"))}</div>
<table class="python-on-viya-table-properties-table"><tbody>${generalRows}</tbody></table>
<div class="python-on-viya-table-properties-section-title">${escapeHtml(vscode.l10n.t("Size Information"))}</div>
<table class="python-on-viya-table-properties-table"><tbody>${sizeRows}</tbody></table>
<div class="python-on-viya-table-properties-section-title">${escapeHtml(vscode.l10n.t("Technical Information"))}</div>
<table class="python-on-viya-table-properties-table"><tbody>${technicalRows}</tbody></table>
</div>
<div id="python-on-viya-pane-columns" class="python-on-viya-table-properties-pane">
<table class="python-on-viya-table-properties-table">
<thead><tr>
<th>#</th>
<th>${escapeHtml(vscode.l10n.t("Name"))}</th>
<th>${escapeHtml(vscode.l10n.t("Type"))}</th>
<th>${escapeHtml(vscode.l10n.t("Length"))}</th>
<th>${escapeHtml(vscode.l10n.t("Format"))}</th>
<th>${escapeHtml(vscode.l10n.t("Informat"))}</th>
<th>${escapeHtml(vscode.l10n.t("Label"))}</th>
</tr></thead>
<tbody>${columnRows}</tbody>
</table>
</div>
</body>
</html>`;
}
