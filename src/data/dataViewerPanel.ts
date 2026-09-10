// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Owns the data viewer's `WebviewPanel`s — 7b, ADR-0028.
 *
 * One panel per open table, keyed by `libref.name`, not a singleton the way
 * `src/run/resultPanel.ts`'s result panel is: browsing two tables side by
 * side is an ordinary thing to want, unlike a run's result, which only ever
 * has one current instance. Opening an already-open table reveals the
 * existing panel rather than creating a second one.
 *
 * This is the second webview this project ships, and the first built with
 * React + `ag-grid-community` rather than hand-rolled DOM — ADR-0028 records
 * why, and what stays the same regardless: the message protocol is a plain,
 * host-authored, buffered handshake (`src/data/dataViewerModel.ts`), the same
 * shape ADR-0021 established, and the CSP is derived fresh for this panel's
 * own threat model rather than copied from that one — see {@link buildHtml}.
 *
 * **What this class does not decide.** Column and row *data* come from
 * `src/data/adapter.ts` (`openTable`/`getColumns`/`getRows`) — this class
 * only owns the panel's lifecycle and the message protocol; the caller
 * supplies an already profile-bound `LibraryAdapter`, the same way
 * `dataExplorer.ts`'s own `currentAdapter()` closure builds one for the
 * tree, so this class never has to resolve a profile or a session itself.
 */

import * as vscode from "vscode";

import { type LibraryAdapter } from "./adapter";
import {
  isReadyMessage,
  isRequestRowsMessage,
  toWireColumns,
  toWireRows,
  type DataViewerHostMessage,
} from "./dataViewerModel";
import { describeDataProblem } from "./problems";
import { type TableDetail, type TableItem } from "./types";

const VIEW_TYPE = "pythonOnViya.dataViewer";

/** The surface of `vscode.WebviewPanel`/`vscode.Webview` this class actually
 * uses — narrowed the same way `ResultWebviewPanel` narrows it, so a test
 * double need only implement what this class calls. A real
 * `vscode.WebviewPanel` satisfies this structurally. */
export interface DataWebviewPanel extends vscode.Disposable {
  readonly webview: {
    html: string;
    readonly cspSource: string;
    asWebviewUri(localResource: vscode.Uri): vscode.Uri;
    postMessage(message: unknown): Thenable<boolean>;
    onDidReceiveMessage(
      listener: (message: unknown) => void,
    ): vscode.Disposable;
  };
  reveal(viewColumn?: vscode.ViewColumn, preserveFocus?: boolean): void;
  onDidDispose(listener: () => void): vscode.Disposable;
}

/** The one port this class would otherwise reach for on the `vscode`
 * namespace directly — same reasoning as `ResultPanelDeps.createPanel`: a
 * test cannot drive a real webview's document through message events
 * reliably, so panel creation is injectable and defaults to the real thing. */
export interface DataViewerPanelDeps {
  createPanel?: ((title: string) => DataWebviewPanel) | undefined;
}

export class DataViewerPanelManager implements vscode.Disposable {
  private readonly panels = new Map<string, OpenTablePanel>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly deps: DataViewerPanelDeps = {},
  ) {}

  /** Opens `table` in a data viewer panel, using `adapter` (already bound to
   * the active profile, per this class's own doc comment) for every
   * column/row request the panel makes for as long as it stays open.
   * Reveals the existing panel, without any new request, if this table is
   * already open.
   *
   * Returns a promise that resolves once the initial `openTable`/`getColumns`
   * load has settled (successfully or not) — `dataExplorer.ts`'s own command
   * handler does not await it (a command handler firing a panel open is
   * fire-and-forget, the same shape `provider.refresh()` already is there),
   * but an integration test driving this class directly needs a point to
   * await before it can observe what the panel posted. */
  async open(table: TableItem, adapter: LibraryAdapter): Promise<void> {
    const key = `${table.libref}.${table.name}`;
    const existing = this.panels.get(key);
    if (existing !== undefined) {
      existing.reveal();
      return;
    }

    const title = `${table.libref}.${table.name}`;
    const panel = new OpenTablePanel(
      table,
      adapter,
      this.deps.createPanel?.(title) ??
        createRealPanel(this.extensionUri, title),
      this.extensionUri,
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

/** One open table's own panel — its message protocol, its in-flight row
 * requests, and its ready/backlog handshake. Not exported: the manager above
 * is the module's whole public surface, matching `ResultPanel`'s own
 * "nothing outside needs the panel object itself" shape. */
class OpenTablePanel implements vscode.Disposable {
  private ready = false;
  /** Only the panel's *opening* state is replayed on a fresh `"ready"` — the
   * last `init` or `failure` message. A `rows`/`rowsError` reply is never
   * buffered: it answers one specific `requestRows` call the webview's own
   * in-memory grid made, and a reload (the only reason `"ready"` fires more
   * than once — ADR-0021's reasoning for `retainContextWhenHidden: false`
   * applies unchanged here) discards that grid instance along with whatever
   * request it was waiting on. The freshly mounted grid asks again once it
   * is ready; there is nothing stale to replay to it. */
  private lastOpeningMessage: DataViewerHostMessage | undefined;
  /** Set once {@link loadTable} resolves the table's rich detail — carries
   * the `rows` link every `requestRows` reply needs. `undefined` until then,
   * and every row request that somehow arrives before it is set answers with
   * `rowsError` rather than throwing (see {@link handleRequestRows}). */
  private tableDetail: TableDetail | undefined;
  private readonly subscriptions: vscode.Disposable[] = [];
  /** Aborted on dispose — caught in review: none of this class's three
   * adapter calls carried a `signal` before now, even though `openTable`/
   * `getColumns`/`getRows` all accept one. Closing the panel mid-load did not
   * abort the in-flight compute request, so it ran to completion (or its own
   * ~30s timeout) regardless — wasted work against a live session, not a
   * hang, but worth cutting short rather than leaving to run unobserved. */
  private readonly controller = new AbortController();

  constructor(
    private readonly table: TableItem,
    private readonly adapter: LibraryAdapter,
    private readonly panel: DataWebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly onDisposed: () => void,
  ) {}

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Active, false);
  }

  async start(): Promise<void> {
    this.panel.webview.html = buildHtml(
      this.panel.webview,
      this.table,
      this.extensionUri,
    );

    this.subscriptions.push(
      this.panel.webview.onDidReceiveMessage((message) => {
        if (isReadyMessage(message)) {
          this.ready = true;
          if (this.lastOpeningMessage !== undefined) {
            void this.panel.webview.postMessage(this.lastOpeningMessage);
          }
          return;
        }
        if (isRequestRowsMessage(message)) {
          void this.handleRequestRows(
            message.requestId,
            message.start,
            message.limit,
          );
        }
      }),
      this.panel.onDidDispose(() => {
        this.controller.abort();
        for (const subscription of this.subscriptions) subscription.dispose();
        this.subscriptions.length = 0;
        this.onDisposed();
      }),
    );

    await this.loadTable();
  }

  dispose(): void {
    this.panel.dispose();
  }

  /** Resolves the table's columns and known row count once, up front — the
   * grid's own row data is fetched separately, one window at a time, once
   * this has told the webview what columns exist (`InitMessage`). */
  private async loadTable(): Promise<void> {
    const opened = await this.adapter.openTable(
      this.table,
      this.controller.signal,
    );
    if (!opened.ok) {
      this.emitOpening({
        type: "failure",
        message: describeDataProblem(opened.problem),
      });
      return;
    }

    const columns = await this.adapter.getColumns(
      opened.value,
      this.controller.signal,
    );
    if (!columns.ok) {
      this.emitOpening({
        type: "failure",
        message: describeDataProblem(columns.problem),
      });
      return;
    }

    // Kept for the row requests this panel makes for the rest of its life —
    // `openTable`'s own `TableDetail` is what carries the `rows` link
    // `getRows` needs, and there is exactly one per open panel.
    this.tableDetail = opened.value;

    this.emitOpening({
      type: "init",
      columns: toWireColumns(columns.value),
      rowCount: opened.value.rowCount,
    });
  }

  private async handleRequestRows(
    requestId: string,
    start: number,
    limit: number,
  ): Promise<void> {
    const table = this.tableDetail;
    if (table === undefined) {
      // Should not happen — the webview only starts requesting rows once it
      // has received `init`, which is only sent after `tableDetail` is set —
      // but a message boundary is not a type system, and answering with a
      // clear error is cheaper than an unhandled rejection if some future
      // change ever lets this race.
      this.post({
        type: "rowsError",
        requestId,
        message: "the table is not open yet",
      });
      return;
    }

    const result = await this.adapter.getRows(
      table,
      { start, limit },
      this.controller.signal,
    );
    if (!result.ok) {
      this.post({
        type: "rowsError",
        requestId,
        message: describeDataProblem(result.problem),
      });
      return;
    }

    this.post({
      type: "rows",
      requestId,
      start,
      rows: toWireRows(result.value.rows),
      count: result.value.count,
    });
  }

  /** Sends a message that also becomes this panel's "opening state" —
   * replayed on the next `"ready"`, since only one `init`/`failure` is ever
   * meaningful at a time. */
  private emitOpening(message: DataViewerHostMessage): void {
    this.lastOpeningMessage = message;
    this.post(message);
  }

  /** Sends a message immediately if the webview has already sent its
   * `"ready"` handshake, drops it otherwise. The only message this can drop
   * is an opening message raced against the very first `"ready"`, and the
   * replay in {@link start}'s message handler is what covers exactly that
   * case — a dropped `rows`/`rowsError` reply is not reachable, because a
   * `requestRows` message can only arrive after `"ready"` already fired
   * (the webview cannot mount a grid to request rows from before it has
   * received `init`, which is itself never sent before `"ready"`). */
  private post(message: DataViewerHostMessage): void {
    if (!this.ready) return;
    void this.panel.webview.postMessage(message);
  }
}

function createRealPanel(
  extensionUri: vscode.Uri,
  title: string,
): DataWebviewPanel {
  return vscode.window.createWebviewPanel(
    VIEW_TYPE,
    title,
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
    {
      enableScripts: true,
      // Same reasoning as the result panel (ADR-0021): `false` is what
      // guarantees a hide/show cycle reloads the webview's document, which
      // is what makes replaying `lastOpeningMessage` on every `"ready"`
      // correct rather than a source of stale content.
      retainContextWhenHidden: false,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, "dist", "webview"),
      ],
    },
  );
}

/**
 * The panel's own HTML shell and Content-Security-Policy — derived fresh for
 * this panel, per ADR-0028, not copied from `resultPanel.ts`'s policy.
 *
 * ```
 * default-src 'none';
 * style-src {cspSource} 'unsafe-inline';
 * script-src 'nonce-{nonce}';
 * ```
 *
 * **`script-src 'nonce-{nonce}'`, never `'unsafe-inline'`** — unchanged from
 * the result panel: the one script tag this extension emits carries the
 * nonce, nothing else does, and `enableScripts: true` only ever runs code
 * this extension bundled itself.
 *
 * **`style-src` allows `'unsafe-inline'`, for a narrower reason than
 * ADR-0021's.** That panel needed it because pandas' own generated HTML
 * carries inline styles this extension does not control. This panel carries
 * no user-generated HTML at all — every cell is a typed SAS value rendered
 * by this extension's own column definitions, not markup a user's Python
 * produced — so the risk ADR-0021 reasoned about (an untrusted payload
 * restyling the panel) does not apply here. The exception is needed for a
 * different, narrower reason instead: `ag-grid-community`'s own runtime sets
 * inline `style` attributes on row/column elements to position them
 * (virtualization moves rows by translating their computed offset, not by
 * reordering DOM nodes), which is how every consumer of this library runs it
 * and is not itself a payload this extension does not control.
 *
 * **No `img-src` is declared.** Unlike the result panel (which embeds
 * `image/png` output as `data:` URIs), nothing in this panel loads an image —
 * `default-src 'none'` already closes it, and ag-grid's own icon set is
 * inline SVG delivered through its bundled CSS as `style-src`-governed
 * content, not through `<img>` or a CSS `background-image` a stricter
 * `img-src` would need to allow. **Not yet visually confirmed** against a
 * real running panel — if ag-grid's icons render as missing/broken once this
 * is checked by hand, that is this comment's own prediction being wrong, and
 * the fix is adding a narrow `img-src {cspSource} data:;` the same way the
 * result panel already carries one, not loosening `default-src`.
 *
 * **A `<link rel="stylesheet">`, not just the inline `<style>` block.**
 * `src/webview/dataViewerEntry.tsx` imports `ag-grid-community`'s own two
 * stylesheets directly (`theme="legacy"` — ADR-0028's own reasoning for why
 * this file matches the exact mechanical shape the upstream SAS extension's
 * proven-working `36.0.2` usage carries, rather than the newer Theming API).
 * esbuild's own CSS-bundling behaviour (`esbuild.mjs`'s `dataViewerContext`)
 * emits that as a companion `dist/webview/dataViewer.css`, same basename as
 * the script it sits beside — never inlined into the `.js` output, so it
 * needs its own tag here, resolved through `asWebviewUri` the same way the
 * script is, and covered by `style-src {cspSource}` already declared above
 * (a `<link>` from the extension's own `localResourceRoots` is exactly what
 * that source expression allows). `.vscodeignore` was checked directly for
 * this: `dist/**` carries no exclusion, so this file ships in the packaged
 * `.vsix` unchanged.
 */
function buildHtml(
  webview: DataWebviewPanel["webview"],
  table: TableItem,
  extensionUri: vscode.Uri,
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "dataViewer.js"),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webview", "dataViewer.css"),
  );
  const nonce = crypto.randomUUID();
  const csp = [
    "default-src 'none';",
    `style-src ${webview.cspSource} 'unsafe-inline';`,
    `script-src 'nonce-${nonce}';`,
  ].join(" ");

  const title = `${table.libref}.${table.name}`;

  // Same validated read `resultPanel.ts` uses: filtered to the BCP-47 shape
  // `env.language` documents ("en", "pt-br", …), "en" as the fallback for
  // anything else — a VS Code-supplied value is still not a reason to skip
  // validating its shape before it lands in an HTML attribute.
  const lang = /^[a-z]{2,3}(-[a-z0-9]+)*$/i.test(vscode.env.language)
    ? vscode.env.language
    : "en";

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${styleUri.toString()}">
<style>
  html, body, #root { height: 100%; margin: 0; }
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
  }
</style>
</head>
<body>
<div id="root" data-title="${escapeHtmlAttribute(title)}"></div>
<script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
