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
import { LibraryPropertiesSource } from "./libraryPropertiesSource";
import { type PropertiesSource, type PropertiesView } from "./propertiesSource";
import { escapeHtml } from "./tablePropertiesModel";
import { type TableItem } from "./types";

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

  /** Opens a SAS library table's properties — see {@link openSource}. */
  async open(table: TableItem, adapter: LibraryAdapter): Promise<void> {
    await this.openSource(new LibraryPropertiesSource(table, adapter));
  }

  /** Opens `source`'s properties, for the one fetch this panel ever makes.
   * Reveals the existing panel, without any new request, if this table's
   * properties are already open (`source.key` — profile/endpoint-scoped by
   * each source, so two deployments' same-named tables never share a panel).
   *
   * Returns a promise that resolves once that fetch has settled
   * (successfully or not) — for the same reason `DataViewerPanelManager.open`
   * does: a command handler does not need it, but an integration test driving
   * this class directly does. */
  async openSource(source: PropertiesSource): Promise<void> {
    const existing = this.panels.get(source.key);
    if (existing !== undefined) {
      existing.reveal();
      return;
    }

    const panel = new TablePropertiesPanel(
      source,
      this.deps.createPanel?.(source.title) ?? createRealPanel(source.title),
      () => this.panels.delete(source.key),
    );
    this.panels.set(source.key, panel);
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
    private readonly source: PropertiesSource,
    private readonly panel: TablePropertiesWebviewPanel,
    private readonly onDisposed: () => void,
  ) {}

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Active, false);
  }

  async start(): Promise<void> {
    this.panel.webview.html = buildLoadingHtml(this.source.heading);

    this.subscriptions.push(
      this.panel.onDidDispose(() => {
        this.disposed = true;
        this.controller.abort();
        for (const subscription of this.subscriptions) subscription.dispose();
        this.subscriptions.length = 0;
        this.onDisposed();
      }),
    );

    // PR review, 2026-09-11 (Codex, Major): a source's `load` is total for
    // every failure it anticipates (a failed result, never a rejection) —
    // *except* the one narrow path `dataExplorer.ts`'s own command handler
    // already documents: `ComputeClient.send` rethrows whatever `resolveHref`
    // throws that is not a `ForeignLinkError`. Before this `try` existed,
    // that rejection propagated straight out of `start()` with the panel left
    // stuck on "Loading…" forever — the command handler's own `.catch` still
    // logged it, but nothing ever told the user. Rendering a failure here,
    // then rethrowing, keeps both: the panel degrades to a real message, and
    // the caller's own log entry still fires unchanged.
    try {
      const loaded = await this.source.load(this.controller.signal);
      this.render(
        loaded.ok
          ? buildPropertiesHtml(this.source.heading, loaded.value)
          : buildFailureHtml(this.source.heading, loaded.message),
      );
    } catch (error) {
      this.render(
        buildFailureHtml(
          this.source.heading,
          vscode.l10n.t(
            "Could not load the table properties ({0}).",
            messageOf(error),
          ),
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
  .python-on-viya-table-properties-tab-label {
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
  .python-on-viya-table-properties-tabs-underline {
    border-bottom: 1px solid var(--vscode-panel-border);
    margin-bottom: 8px;
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

/** Shown the instant the panel opens, before the source has loaded — replaced in place once they do (success or failure). */
function buildLoadingHtml(heading: string): string {
  return `${panelHead()}
<body>
<h1>${escapeHtml(heading)}</h1>
<p>${escapeHtml(vscode.l10n.t("Loading…"))}</p>
</body>
</html>`;
}

/** Shown when a source's load fails — `message` is already localised by the
 * source, the same panel-facing text `dataViewerPanel.ts`'s own
 * `FailureMessage` carries for the identical pair of calls. */
function buildFailureHtml(heading: string, message: string): string {
  return `${panelHead()}
<body>
<h1>${escapeHtml(heading)}</h1>
<p class="python-on-viya-table-properties-failure">${escapeHtml(message)}</p>
</body>
</html>`;
}

/** The panel's real content: a "Properties" tab (one titled table per
 * {@link PropertiesView} section) and a "Columns" tab (the view's own grid).
 * Every value is plain text from the source and is HTML-escaped here, once.
 *
 * **The two radio inputs are not wrapped in a container** — they, their
 * `<label>`s, and both `#python-on-viya-pane-*` divs are all direct children
 * of `<body>`. Manual test pass §13 (2026-09-10, Sean) found both panes
 * rendering blank: an earlier version wrapped the inputs and labels in their
 * own `<div>`, and `panelHead()`'s `:checked ~ #python-on-viya-pane-*` general
 * sibling selector only matches elements sharing the *same parent* as the
 * checked input — nesting the input one level deeper than the panes it is
 * meant to reveal meant that selector never matched anything, so the
 * `display: none` default never lifted. The `<label>`s still need to
 * immediately follow their own `<input>` for the adjacent-sibling `:checked +
 * label` rule right below, so the flat order here is Properties input,
 * Properties label, Columns input, Columns label, then a separate
 * `.python-on-viya-table-properties-tabs-underline` div standing in for the
 * old wrapper's visual bottom border (which cannot come back as a wrapper
 * without reintroducing the same bug). */
function buildPropertiesHtml(heading: string, view: PropertiesView): string {
  const sectionHtml = view.sections
    .map((section) => {
      const rows = section.rows
        .map(
          (row) => `
    <tr>
      <td class="python-on-viya-table-properties-label">${escapeHtml(row.label)}</td>
      <td>${escapeHtml(row.value)}</td>
    </tr>`,
        )
        .join("");
      return `<div class="python-on-viya-table-properties-section-title">${escapeHtml(section.title)}</div>
<table class="python-on-viya-table-properties-table"><tbody>${rows}</tbody></table>`;
    })
    .join("\n");

  const headerHtml = view.columns.headers
    .map((header) => `<th>${escapeHtml(header)}</th>`)
    .join("\n");
  const columnRows = view.columns.rows
    .map(
      (cells) => `
    <tr>
      ${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("\n      ")}
    </tr>`,
    )
    .join("");

  return `${panelHead()}
<body>
<h1>${escapeHtml(heading)}</h1>
<input type="radio" name="python-on-viya-table-properties-tab" id="python-on-viya-tab-properties" class="python-on-viya-table-properties-tab-input" checked>
<label for="python-on-viya-tab-properties" class="python-on-viya-table-properties-tab-label">${escapeHtml(vscode.l10n.t("Properties"))}</label>
<input type="radio" name="python-on-viya-table-properties-tab" id="python-on-viya-tab-columns" class="python-on-viya-table-properties-tab-input">
<label for="python-on-viya-tab-columns" class="python-on-viya-table-properties-tab-label">${escapeHtml(vscode.l10n.t("Columns"))}</label>
<div class="python-on-viya-table-properties-tabs-underline"></div>
<div id="python-on-viya-pane-properties" class="python-on-viya-table-properties-pane">
${sectionHtml}
</div>
<div id="python-on-viya-pane-columns" class="python-on-viya-table-properties-pane">
<table class="python-on-viya-table-properties-table">
<thead><tr>
${headerHtml}
</tr></thead>
<tbody>${columnRows}</tbody>
</table>
</div>
</body>
</html>`;
}
