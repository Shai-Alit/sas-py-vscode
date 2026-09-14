// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Owns the data viewer's `WebviewPanel`s — 7b, ADR-0028.
 *
 * One panel per open table, keyed by {@link TableSource.key}, not a singleton
 * the way `src/run/resultPanel.ts`'s result panel is: browsing two tables
 * side by side is an ordinary thing to want, unlike a run's result, which
 * only ever has one current instance. Opening an already-open table reveals
 * the existing panel rather than creating a second one.
 *
 * This is the second webview this project ships, and the first built with
 * React + `ag-grid-community` rather than hand-rolled DOM — ADR-0028 records
 * why, and what stays the same regardless: the message protocol is a plain,
 * host-authored, buffered handshake (`src/data/dataViewerModel.ts`), the same
 * shape ADR-0021 established, and the CSP is derived fresh for this panel's
 * own threat model rather than copied from that one — see {@link buildHtml}.
 *
 * **8c: generalized to serve a second backend, unchanged in every other
 * respect.** This class used to talk to `LibraryAdapter`/`TableDetail`
 * directly; it now talks only to `./tableSource.ts`'s `TableSource`
 * interface, which `./librarySource.ts`'s `LibraryTableSource` and
 * `../cas/casTableSource.ts`'s `CasTableSource` each implement their own way.
 * **What this class does not decide.** Column and row *data* come from
 * whichever `TableSource` its caller supplies — this class only owns the
 * panel's lifecycle and the message protocol.
 */

import * as vscode from "vscode";

import {
  isReadyMessage,
  isRequestRowsMessage,
  toWireColumns,
  toWireRows,
  type DataViewerHostMessage,
} from "./dataViewerModel";
import { type SourceSortSpec, type TableSource } from "./tableSource";

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
  /** Where a best-effort cleanup failure is logged — never surfaced to the
   * user. `undefined` in a test that has no reason to assert on logging. */
  log?: vscode.LogOutputChannel | undefined;
}

export class DataViewerPanelManager implements vscode.Disposable {
  private readonly panels = new Map<string, OpenTablePanel>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly deps: DataViewerPanelDeps = {},
  ) {}

  /** Opens `source`'s table in a data viewer panel. Reveals the existing
   * panel, without any new request, if a table with the same
   * {@link TableSource.key} is already open.
   *
   * Returns a promise that resolves once the initial `open`/`getColumns` load
   * has settled (successfully or not) — a command handler firing a panel open
   * is fire-and-forget and does not await it, but an integration test driving
   * this class directly needs a point to await before it can observe what the
   * panel posted. */
  async open(source: TableSource): Promise<void> {
    const existing = this.panels.get(source.key);
    if (existing !== undefined) {
      existing.reveal();
      return;
    }

    const panel = new OpenTablePanel(
      source,
      this.deps.createPanel?.(source.title) ??
        createRealPanel(this.extensionUri, source.title),
      this.extensionUri,
      () => this.panels.delete(source.key),
      this.deps.log,
    );
    this.panels.set(source.key, panel);
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
   * is ready; there is nothing stale to replay to it.
   *
   * **An `"init"` message's own `initialSort`/`initialFilter` are never
   * replayed verbatim from this stored copy** — {@link openingMessageFor}
   * always overwrites them with `activeSort`/`activeFilter` as they stand
   * *at replay time*, not as they stood when the table was first opened
   * (`manual-test-pass.md` §12's own finding). */
  private lastOpeningMessage: DataViewerHostMessage | undefined;
  private tableIsOpen = false;
  /** The sort/filter this panel most recently asked {@link source} for — set
   * the instant a `requestRows` message arrives, before the (possibly slow)
   * {@link TableSource.getRows} call it triggers resolves. This is what lets
   * {@link handleRequestRows} tell a stale reply (answering a sort/filter
   * state a *later* request has already superseded) from a current one,
   * without this class needing to know anything about how — or whether — its
   * `source` caches or reuses anything between calls. */
  private activeSort: readonly SourceSortSpec[] = [];
  private activeFilter = "";
  private readonly subscriptions: vscode.Disposable[] = [];
  /** Aborted on dispose, so closing the panel mid-load does not leave an
   * in-flight request running unobserved against a live session. */
  private readonly controller = new AbortController();

  constructor(
    private readonly source: TableSource,
    private readonly panel: DataWebviewPanel,
    private readonly extensionUri: vscode.Uri,
    private readonly onDisposed: () => void,
    private readonly log?: vscode.LogOutputChannel,
  ) {}

  reveal(): void {
    this.panel.reveal(vscode.ViewColumn.Active, false);
  }

  async start(): Promise<void> {
    this.panel.webview.html = buildHtml(this.panel.webview, this.extensionUri);

    this.subscriptions.push(
      this.panel.webview.onDidReceiveMessage((message) => {
        if (isReadyMessage(message)) {
          this.ready = true;
          if (this.lastOpeningMessage !== undefined) {
            void this.panel.webview.postMessage(
              this.openingMessageFor(this.lastOpeningMessage),
            );
          }
          return;
        }
        if (isRequestRowsMessage(message)) {
          void this.handleRequestRows(
            message.requestId,
            message.start,
            message.limit,
            message.sort,
            message.filter,
          );
        }
      }),
      this.panel.onDidDispose(() => {
        this.controller.abort();
        for (const subscription of this.subscriptions) subscription.dispose();
        this.subscriptions.length = 0;
        this.onDisposed();
        // No signal: the controller above is already aborted by this point,
        // and reusing its signal here would abort this very cleanup call.
        void this.source.close().catch((error: unknown) => {
          this.log?.warn(
            vscode.l10n.t(
              '{0}: cleanup for "{1}" failed ({2})',
              this.source.logPrefix,
              this.source.title,
              error instanceof Error ? error.message : "unknown error",
            ),
          );
        });
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
    const opened = await this.source.open(this.controller.signal);
    if (!opened.ok) {
      this.emitOpening({ type: "failure", message: opened.message });
      return;
    }

    const columns = await this.source.getColumns(this.controller.signal);
    if (!columns.ok) {
      this.emitOpening({ type: "failure", message: columns.message });
      return;
    }

    this.tableIsOpen = true;

    this.emitOpening({
      type: "init",
      columns: toWireColumns(columns.value),
      rowCount: opened.value.rowCount,
      filterPlaceholder: vscode.l10n.t(
        "Filter rows (SAS WHERE clause) — press Enter to apply",
      ),
      // Overwritten by `openingMessageFor` on every actual send — a table
      // has no active sort or filter the moment it is first opened, so `[]`/
      // `""` is already correct here, but the real values this field must
      // carry on a *later* replay live in `activeSort`/`activeFilter`, not
      // in this one-time literal.
      initialSort: [],
      initialFilter: "",
    });
  }

  private async handleRequestRows(
    requestId: string,
    start: number,
    limit: number,
    sort: readonly SourceSortSpec[],
    filter: string,
  ): Promise<void> {
    if (!this.tableIsOpen) {
      // Should not happen — the webview only starts requesting rows once it
      // has received `init`, which is only sent after the table is open —
      // but a message boundary is not a type system, and answering with a
      // clear error is cheaper than an unhandled rejection if some future
      // change ever lets this race.
      this.post({
        type: "rowsError",
        requestId,
        message: vscode.l10n.t("The table is not open yet."),
      });
      return;
    }

    // Set *before* awaiting `getRows`, not after — this is what lets a
    // second, faster-resolving request from a later sort/filter change mark
    // an earlier, still-in-flight request's own eventual reply as stale (see
    // this class's own `activeSort`/`activeFilter` doc comment).
    this.activeSort = sort;
    this.activeFilter = filter;

    const result = await this.source.getRows(
      { start, limit },
      sort,
      filter,
      this.controller.signal,
    );

    if (!sortEquals(this.activeSort, sort) || this.activeFilter !== filter) {
      // Caught by PR review, 2026-09-10 (7b/7c): a stale request still gets a
      // reply — a `rowsError`, not silence. `dataViewerEntry.tsx`'s own
      // `pendingRowRequests` map is keyed by `requestId` and only ever
      // cleared when a `rows`/`rowsError` reply for that exact id arrives; a
      // silently dropped reply leaves that entry pending forever.
      this.post({
        type: "rowsError",
        requestId,
        message: vscode.l10n.t(
          "This request was superseded by a later sort or filter change.",
        ),
      });
      return;
    }

    if (!result.ok) {
      this.log?.warn(
        vscode.l10n.t(
          '{0}: a row request over "{1}" failed ({2})',
          this.source.logPrefix,
          this.source.title,
          result.logDetail,
        ),
      );
      this.post({
        type: "rowsError",
        requestId,
        message: result.message,
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
    this.post(this.openingMessageFor(message));
  }

  /** An `"init"` message, with `initialSort`/`initialFilter` refreshed to
   * this panel's *current* `activeSort`/`activeFilter` — see {@link
   * lastOpeningMessage}'s own doc comment for why a frozen copy of those two
   * fields is wrong the moment either one has changed since the table was
   * opened. Every other message type (`"failure"`) passes through unchanged,
   * since neither carries a sort or a filter to begin with. */
  private openingMessageFor(
    message: DataViewerHostMessage,
  ): DataViewerHostMessage {
    if (message.type !== "init") return message;
    return {
      ...message,
      initialSort: this.activeSort,
      initialFilter: this.activeFilter,
    };
  }

  /** Sends a message immediately if the webview has already sent its
   * `"ready"` handshake, drops it otherwise. The only message this can drop
   * is an opening message raced against the very first `"ready"`, and the
   * replay in {@link start}'s message handler is what covers exactly that
   * case — a dropped `rows`/`rowsError` reply is not reachable, because a
   * `requestRows` message can only arrive after `"ready"` already fired. */
  private post(message: DataViewerHostMessage): void {
    if (!this.ready) return;
    void this.panel.webview.postMessage(message);
  }
}

/** Whether two sort specs name the same columns in the same order with the
 * same direction — {@link OpenTablePanel}'s own "has the sort actually
 * changed" check. The same small helper `./librarySource.ts`'s
 * `LibraryTableSource` carries its own copy of, for its own, unrelated
 * reason (deciding whether to reuse a server-side view). */
function sortEquals(
  a: readonly SourceSortSpec[],
  b: readonly SourceSortSpec[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every((spec, index) => {
    const other = b[index];
    return other?.key === spec.key && other.direction === spec.direction;
  });
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
 * font-src {cspSource} data:;
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
 * `img-src` would need to allow.
 *
 * **`font-src {cspSource} data:;`** — `ag-theme-alpine.css` (the bundled
 * theme `dataViewerEntry.tsx` imports) declares its own icon font via
 * `@font-face` with a base64 `woff2` payload, blocked by `default-src 'none'`
 * with no `font-src` to fall back on otherwise (confirmed against a real
 * panel, 2026-09-10).
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
 * script is, and covered by `style-src {cspSource}` already declared above.
 */
function buildHtml(
  webview: DataWebviewPanel["webview"],
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
    `font-src ${webview.cspSource} data:;`,
  ].join(" ");

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
    background-color: var(--vscode-editor-background);
  }
  /* Real review finding, 2026-09-10: an unstyled <input> renders with the
     browser's own default control chrome — a bright white box regardless of
     VS Code's active theme. Matches this project's other user-facing text
     (--vscode-foreground/--vscode-editor-background above), using the same
     VS Code webview theming variables an ordinary input is documented to use. */
  .python-on-viya-data-viewer-filter {
    background-color: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent);
  }
  .python-on-viya-data-viewer-filter::placeholder {
    color: var(--vscode-input-placeholderForeground);
  }
  .python-on-viya-data-viewer-filter:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  /* Finding 7.18 (phase-7.md) confirmed an invalid filter answers with a
     real, actionable SAS parser message, not a generic failure — but
     dataViewerEntry.tsx's own datasource was dropping it on the floor,
     leaving a blank grid with nothing to tell the user why
     (manual-test-pass.md §12). Same VS Code input-validation variables
     every other extension's inline error text uses, matching the filter
     box's own --vscode-input-* theming immediately above. */
  .python-on-viya-data-viewer-rows-error {
    background-color: var(--vscode-inputValidation-errorBackground);
    border: 1px solid var(--vscode-inputValidation-errorBorder);
    color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground));
    padding: 2px 6px;
  }
</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
}
