// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Owns the data viewer's `WebviewPanel`s — 7b, ADR-0028.
 *
 * One panel per open table, keyed by profile id and `libref.name` together,
 * not a singleton the way `src/run/resultPanel.ts`'s result panel is:
 * browsing two tables side by side is an ordinary thing to want, unlike a
 * run's result, which only ever has one current instance. Opening an
 * already-open table reveals the existing panel rather than creating a
 * second one — the profile id is part of the key so that two profiles with
 * live sessions at once (`ComputeSessionManager.live` supports exactly this)
 * each get their own panel for a same-named table instead of one silently
 * revealing the other's, still bound to its original adapter.
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

import { type DataResult, type LibraryAdapter } from "./adapter";
import {
  isReadyMessage,
  isRequestRowsMessage,
  toWireColumns,
  toWireRows,
  type DataViewerHostMessage,
} from "./dataViewerModel";
import { localiseDataProblem } from "./messages";
import { describeDataProblem } from "./problems";
import { type SortSpec, type TableDetail, type TableItem } from "./types";

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
  /** Where a best-effort view cleanup failure is logged (`discardView`'s own
   * doc comment) — never surfaced to the user, since a view this project
   * failed to delete is orphaned only until the session itself ends, not a
   * correctness problem for anything still open. `undefined` in a test that
   * has no reason to assert on logging. */
  log?: vscode.LogOutputChannel | undefined;
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
    // Scoped by profile, not just libref.name: `ComputeSessionManager.live`
    // (src/compute/sessionManager.ts) explicitly supports two profiles
    // holding sessions at once, and a table name like SASHELP.CLASS exists
    // under virtually every deployment. Without the profile in the key,
    // switching profiles and reopening a same-named table would reveal the
    // other profile's panel — still bound to its own adapter — instead of
    // opening a fresh one; the same class of cross-deployment leak the 6b
    // review caught and fixed for the sasContent: FileSystemProvider's ETag
    // guard (keyed by href alone, now deployment root + href). `\n`-joined
    // because neither a profile id nor `libref.name` can contain one, so the
    // two parts can never collide across the join.
    const key = `${adapter.profileId}\n${table.libref}.${table.name}`;
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
      this.deps.log,
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
   * is ready; there is nothing stale to replay to it.
   *
   * **An `"init"` message's own `initialSort`/`initialFilter` are never
   * replayed verbatim from this stored copy** — {@link openingMessageFor}
   * always overwrites them with `activeSort`/`activeFilter` as they stand
   * *at replay time*, not as they stood when the table was first opened.
   * Sean's own manual test (`manual-test-pass.md` §12) found that a bare
   * replay of this frozen message lost an active sort or filter on every
   * hide/show: the freshly mounted grid has no sort or filter of its own to
   * seed the datasource with, so its very first `requestRows` reads as
   * `sort: []`, `filter: ""` — which {@link ensureReadTargetLocked}'s own
   * `sort.length === 0` branch reads as the user having cleared both,
   * discarding a still-wanted server-side view rather than merely losing a
   * UI indicator. */
  private lastOpeningMessage: DataViewerHostMessage | undefined;
  /** Set once {@link loadTable} resolves the table's rich detail — carries
   * the `rows` link every `requestRows` reply needs. `undefined` until then,
   * and every row request that somehow arrives before it is set answers with
   * `rowsError` rather than throwing (see {@link handleRequestRows}). */
  private tableDetail: TableDetail | undefined;
  /** The server-side view backing the *current* sort/filter state — `applySort`'s
   * own return value, reused across every `requestRows` while `activeSort`/
   * `activeFilter` stay unchanged; `undefined` when no sort is active (a plain
   * or filtered-only read goes straight against `tableDetail`). See {@link
   * ensureReadTarget}. */
  private activeView: TableDetail | undefined;
  private activeSort: readonly SortSpec[] = [];
  private activeFilter: string | undefined;
  /** Serialises {@link ensureReadTarget}'s own body — a fast scroll can have
   * more than one `requestRows` in flight at once, and without this, two
   * concurrent calls deciding *together* that the (sort, filter) pairing
   * changed would each create their own view, the second silently
   * overwriting {@link activeView} and orphaning the first rather than
   * either one being deleted through the ordinary supersede-or-dispose path.
   * `.catch()` on the stored chain keeps one rejected call from poisoning
   * every later one. */
  private ensureReadTargetChain: Promise<unknown> = Promise.resolve();
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
        // What if dispose lands while an `applySort` this session started is
        // still in flight, rather than one already resolved? `staleView` here
        // is only ever what `activeView` already held *before* this tick —
        // an in-flight `createView` cannot have set it yet. Reviewed
        // adversarially before this PR: is a leak still possible if that
        // call resolves *after* this handler runs? No — `applySort` passes
        // `this.controller.signal`, aborted two lines below, through to
        // `client.send`; `src/compute/client.ts`'s own `AbortSignal.any`
        // wiring (tested in `compute-client.test.ts`) turns an aborted
        // in-flight request into a rejected transport call, which
        // `sendRequest`'s `catch` turns into an ordinary `{ok:false}`
        // failure — never a late success. `ensureReadTargetLocked` bails out
        // on that failure (`if (!created.ok) return created;`) before ever
        // reaching `this.activeView = created.value`, so there is nothing
        // for a *second* dispose-time cleanup to catch. This reasoning rests
        // on the transport's existing abort guarantee, already covered
        // generically, not on anything new this file would need its own test
        // for.
        //
        // Captured before `controller.abort()`, and deleted with **no**
        // signal of its own — reusing `this.controller.signal` here would
        // abort the very cleanup call this is trying to make, since that is
        // the controller being aborted on this same tick.
        const staleView = this.activeView;
        this.activeView = undefined;
        this.controller.abort();
        for (const subscription of this.subscriptions) subscription.dispose();
        this.subscriptions.length = 0;
        this.onDisposed();
        if (staleView !== undefined) {
          void this.adapter.deleteView(staleView).then((result) => {
            if (!result.ok) {
              this.log?.warn(
                `python-on-viya: could not delete a sort/filter view over "${staleView.libref}.${staleView.name}" on panel dispose (${describeDataProblem(result.problem)}) — it will be orphaned until the session ends`,
              );
            }
          });
        }
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
        message: localiseDataProblem(opened.problem),
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
        message: localiseDataProblem(columns.problem),
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
    sort: readonly SortSpec[],
    filter: string,
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
        message: vscode.l10n.t("The table is not open yet."),
      });
      return;
    }

    const target = await this.ensureReadTarget(sort, filter);
    if (!target.ok) {
      // Findings 7.16/7.18 (docs/phases/phase-7.md): this is the path an
      // invalid `sortBy`/`where=` combination fails on when a sort is
      // active — `createView` rejects the whole body up front. Logged, not
      // just posted to the webview: Sean's own manual test (§12) found a
      // failed filter left nothing in the log at all to confirm anything had
      // even been attempted.
      this.log?.warn(
        `python-on-viya: could not prepare a sort/filter read over "${table.libref}.${table.name}" (${describeDataProblem(target.problem)})`,
      );
      this.post({
        type: "rowsError",
        requestId,
        message: localiseDataProblem(target.problem),
      });
      return;
    }

    // A filter is applied via `where=` only against the base table — never
    // against `target.value` when it is a sort-view, which already has any
    // active filter baked into its own `createView` body (Finding 7.16:
    // `where=` is silently ignored on a view's own rows read).
    const result = await this.adapter.getRows(
      target.value,
      { start, limit },
      sort.length === 0 ? filter : undefined,
      this.controller.signal,
    );

    // Reviewed adversarially before this PR: `ensureReadTarget` serialises
    // *view creation*, but this `getRows` call, once dispatched, is not
    // itself serialised against a *later* request's own sort/filter change.
    // A fast pair of scroll/sort/filter changes can have this exact call
    // still in flight against a view a later `ensureReadTarget` has already
    // superseded (recreated or discarded) by the time it resolves — reading
    // a since-deleted view answers 404, and the request this reply would
    // answer is one ag-grid itself has already moved past (a superseded
    // datasource, not merely a superseded row window). Rather than surface
    // that as a confusing error for a request nothing is waiting on
    // meaningfully anymore, drop the reply once `sort`/`filter` no longer
    // match this panel's *current* state — a genuinely current request's
    // own `sort`/`filter` still match at this point, so ordinary paging
    // (which never changes either) is unaffected.
    if (!sortEquals(this.activeSort, sort) || this.activeFilter !== filter) {
      return;
    }

    if (!result.ok) {
      // Finding 7.18 (docs/phases/phase-7.md): a filter-only invalid
      // `where=` fails here, against the base table's own rows read, rather
      // than at `ensureReadTarget` above (no view is created for a
      // filter-with-no-sort — see that method's own doc comment). Logged for
      // the same reason as the `target.ok` branch above.
      this.log?.warn(
        `python-on-viya: a row request over "${table.libref}.${table.name}" failed (${describeDataProblem(result.problem)})`,
      );
      this.post({
        type: "rowsError",
        requestId,
        message: localiseDataProblem(result.problem),
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

  /**
   * The table (no sort active) or the sort-view (sort active) the next
   * {@link handleRequestRows} call should read from — creating, reusing, or
   * discarding a view as `sort`/`filter` change.
   *
   * **A view is recreated whenever the (sort, filter) pairing changes, and
   * reused across every page fetch while it stays the same** — one
   * create/delete round trip per distinct sort/filter state, not one per
   * scroll-triggered page the way upstream's own `getSortedRows` does
   * (`applySort`'s own doc comment). Serialised via {@link
   * ensureReadTargetChain} — see that field's own doc comment.
   */
  private ensureReadTarget(
    sort: readonly SortSpec[],
    filter: string,
  ): Promise<DataResult<TableDetail>> {
    // `.catch()` twice, deliberately, not once: the assignment to
    // `ensureReadTargetChain` protects every *later* call from a poisoned
    // chain, but on its own leaves the promise `handleRequestRows` itself
    // awaits still rejecting on a throw. Nothing in this codebase's adapter
    // layer actually throws today (`DataResult` is total, per this
    // project's own convention) — this is latent hardening, not a reachable
    // gap — but `handleRequestRows`'s own fire-and-forget `void` call would
    // otherwise turn a future regression into a silent unhandled rejection
    // instead of an ordinary `rowsError` reply.
    const next = this.ensureReadTargetChain
      .then(() => this.ensureReadTargetLocked(sort, filter))
      .catch((error: unknown): DataResult<TableDetail> => ({
        ok: false,
        reason: `an unexpected error while preparing to read: ${messageOf(error)}`,
        problem: {
          code: "compute",
          problem: { code: "compute-unreachable", detail: messageOf(error) },
        },
      }));
    this.ensureReadTargetChain = next;
    return next;
  }

  private async ensureReadTargetLocked(
    sort: readonly SortSpec[],
    filter: string,
  ): Promise<DataResult<TableDetail>> {
    const table = this.tableDetail;
    if (table === undefined) {
      // Guarded by the same check `handleRequestRows` already made before
      // calling this — kept here too so this method has no implicit
      // dependency on call order to stay total.
      return {
        ok: false,
        reason: "the table is not open yet",
        problem: { code: "not-connected" },
      };
    }

    if (sort.length === 0) {
      if (this.activeView !== undefined) await this.discardView();
      // `discardView` resets `activeFilter` to `undefined` unconditionally —
      // correct for *its* callers (a superseded view has no current filter
      // at all), but this call site's own current filter is `filter`, active
      // against the base table now, not absent. Set it explicitly so
      // `handleRequestRows`'s own staleness check (comparing against
      // `activeSort`/`activeFilter`) has a real, current value to compare a
      // plain filtered-no-sort request against, rather than treating every
      // such request as stale forever.
      this.activeSort = sort;
      this.activeFilter = filter;
      return { ok: true, value: table };
    }

    if (
      this.activeView !== undefined &&
      sortEquals(this.activeSort, sort) &&
      this.activeFilter === filter
    ) {
      return { ok: true, value: this.activeView };
    }

    if (this.activeView !== undefined) await this.discardView();

    const created = await this.adapter.applySort(
      table,
      sort,
      filter === "" ? undefined : filter,
      this.controller.signal,
    );
    if (!created.ok) return created;

    this.activeView = created.value;
    this.activeSort = sort;
    this.activeFilter = filter;
    return created;
  }

  /** Deletes the current view, if there is one, and clears this panel's own
   * record of it regardless of whether the delete actually succeeded — a
   * failed delete here is logged, not retried or propagated (see {@link
   * DataViewerPanelDeps.log}'s own doc comment). */
  private async discardView(): Promise<void> {
    const view = this.activeView;
    this.activeView = undefined;
    this.activeSort = [];
    this.activeFilter = undefined;
    if (view === undefined) return;

    const deleted = await this.adapter.deleteView(view, this.controller.signal);
    if (!deleted.ok) {
      this.log?.warn(
        `python-on-viya: could not delete a superseded sort/filter view over "${view.libref}.${view.name}" (${describeDataProblem(deleted.problem)}) — it will be orphaned until the session ends`,
      );
    }
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
      initialFilter: this.activeFilter ?? "",
    };
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

/** Whether two sort specs name the same columns in the same order with the
 * same direction — {@link OpenTablePanel.ensureReadTarget}'s own "has the
 * sort actually changed" check, ordinary array equality rather than a set
 * comparison since a column-order change (drag-reordering a multi-sort) is
 * itself a real change a view must be recreated for. */
function sortEquals(a: readonly SortSpec[], b: readonly SortSpec[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((spec, index) => {
    const other = b[index];
    return other?.key === spec.key && other.direction === spec.direction;
  });
}

/** The message of a thrown value, and nothing else it might be carrying — the
 * same small helper `compute/client.ts`/`content/client.ts`/`dialects/probe.ts`
 * each carry their own copy of. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
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
 * `img-src` would need to allow. **Not yet visually confirmed** against a
 * real running panel — if ag-grid's icons render as missing/broken once this
 * is checked by hand, that is this comment's own prediction being wrong, and
 * the fix is adding a narrow `img-src {cspSource} data:;` the same way the
 * result panel already carries one, not loosening `default-src`.
 *
 * **`font-src {cspSource} data:;` — added 2026-09-10, real and confirmed, not
 * predicted.** This comment's own `img-src` prediction above was half right:
 * something CSP-adjacent did need attention once a real panel was checked,
 * but the actual break was a font, not an image. `ag-theme-alpine.css` (the
 * bundled theme `dataViewerEntry.tsx` imports) declares its own icon font via
 * `@font-face` with a base64 `woff2` payload, and a real console export
 * showed it being blocked (`"default-src 'none'"` with no `font-src` to fall
 * back on). Confirmed genuinely latent in 7b — `toColumnDefs` sets
 * `sortable: false` and no filter is configured, so nothing in 7b's own grid
 * currently draws a glyph from that font — but real: 7c is the slice that
 * turns sort/filter (and therefore icons) on, at which point the missing
 * font would otherwise surface as a fresh bug rather than a known one. Fixed
 * now rather than left on 7c's punch list, since the fix is this cheap and
 * already this well-confirmed — `data:` because the font itself is a
 * data-URI payload inside the bundled CSS, `{cspSource}` alongside it for
 * the same reason `style-src` already carries it, in case a later theme
 * change serves a font as a real extension resource instead of inlining it.
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
