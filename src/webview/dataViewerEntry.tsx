// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The data viewer panel's own browser bootstrap — 7b, ADR-0028. This
 * project's first React component and its first use of `ag-grid-community`.
 *
 * **Structure follows `client/src/webview/DataViewer.tsx`/`useDataViewer.ts`
 * in sassoftware/vscode-sas-extension (Apache-2.0)** for the *mechanical*
 * library usage this file has no independent design freedom over — which
 * `ag-grid-community`/`ag-grid-react` exports a working `36.0.2` integration
 * actually needs (`ModuleRegistry.registerModules`, `rowModelType:
 * "infinite"`, `theme="legacy"` alongside the two stylesheet imports,
 * `IGetRowsParams`'s `successCallback` shape) — read for what it does and
 * matched rather than redesigned, the same "audited rather than transcribed"
 * discipline `src/data/adapter.ts` already applies to `RestLibraryAdapter.ts`.
 * Everything *not* mechanical — the message protocol, column/row mapping,
 * what happens on a load failure — is this project's own, via
 * `src/data/dataViewerModel.ts`.
 *
 * **This file imports only types from `dataViewerModel.ts`, never a runtime
 * value** — the same discipline `src/webview/entry.ts` follows for
 * `resultPanelModel.ts` (ADR-0021), so this stays a browser-only bundle with
 * no accidental dependency on anything that assumes a Node module graph.
 *
 * **Visually verified against a real panel 2026-09-10** (Sean's own manual
 * test pass, `manual-test-pass.md` §10/§11) — rendering, scrolling, paging,
 * independent tabs, and legibility across VS Code's light/dark/high-contrast
 * themes all confirmed. This remains the one file in this slice neither
 * `tsc` (the `ag-grid-community`/`ag-grid-react` packages are devDependencies
 * added by this same change, and cannot be typechecked against in the
 * sandbox this was written in — see this project's own Claude Desktop rule
 * against installing packages) nor the unit tier can check — it is
 * structurally excluded from both, the same way `src/webview/entry.ts`
 * already is (ADR-0009's `isBrowserOnly`), which is why that same manual pass
 * is what caught {@link toColumnDefs}'s wrong `"NUM"` comparison (Finding
 * 7.14) — nothing else in this project's own tiers could have.
 *
 * **`init`'s `initialSort`/`initialFilter` (added responding to Sean's own
 * manual test, `manual-test-pass.md` §12) are not yet visually confirmed
 * against a real panel either** — the same "this file is excluded from both
 * `tsc` and the unit tier" caveat above applies to whether ag-grid actually
 * seeds its header sort indicator from a column's initial `sort`/`sortIndex`
 * the way {@link toColumnDefs} now sets them, and whether the restored filter
 * text visibly appears in the filter box on a real hide/show cycle.
 *
 * **The `message` listener's origin check (added responding to a CodeQL
 * finding on this PR) has been rewritten twice since that manual pass, and
 * both the `startsWith`/`endsWith` version and this file's current
 * `new URL(event.origin)` version (the second an automated CodeQL "Commit
 * suggestion" applied directly to the PR branch, 2026-09-10) have each been
 * confirmed against a real panel** — most recently the version actually
 * shipping here. If the check's premise is ever wrong for this project's
 * actual Electron/webview version, the failure mode is silent and total:
 * every host→webview message (`init`, `failure`, `rows`, `rowsError`) gets
 * dropped, and the panel never renders anything past its initial blank frame
 * — indistinguishable from `columns === undefined` still loading. Any future
 * rewrite of this check must be confirmed against a real panel again before
 * merge; this is not a one-time check that stays satisfied once the logic
 * changes.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type IDatasource,
  type IGetRowsParams,
  type SortModelItem,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";

import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-alpine.css";

import type {
  DataViewerHostMessage,
  WireColumn,
} from "../data/dataViewerModel";
import type { SortSpec } from "../data/types";

/** What this file needs from `acquireVsCodeApi()` — one method, the same
 * narrow declaration `src/webview/entry.ts` carries, since VS Code ships no
 * `@types/vscode-webview` dependency for this. */
declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
};

// `ag-grid-community` 33+ requires every module a build actually uses to be
// registered explicitly rather than assuming a monolithic bundle.
// `AllCommunityModule` registers the whole community tier — more than the
// Infinite Row Model 7b alone needs, and a real, if modest, bundle-size
// question worth revisiting once a narrower module list can be checked
// against a live build (unavailable in the sandbox this was written in) —
// chosen over guessing at a narrower module name from memory and shipping a
// grid that silently fails to page.
ModuleRegistry.registerModules([AllCommunityModule]);

const vscode = acquireVsCodeApi();

/** One in-flight `requestRows` call's own resolver pair, keyed by the
 * `requestId` `src/data/dataViewerPanel.ts` echoes back on both the success
 * and failure reply — see this module's own message-handling effect below. */
interface PendingRowRequest {
  resolve: (page: {
    rows: readonly unknown[][];
    count: number | undefined;
  }) => void;
  reject: (message: string) => void;
}

const pendingRowRequests = new Map<string, PendingRowRequest>();

/**
 * `crypto.randomUUID()`, not a monotonic counter — caught in review. This
 * module's own state (`pendingRowRequests`, and a counter would have been the
 * same) resets to empty on every fresh document load, but the *host*
 * (`OpenTablePanel`) does not: `retainContextWhenHidden: false` means a
 * hide/show reloads this script from scratch, yet a `getRows` call the
 * pre-reload document started can still resolve afterward, and the host's own
 * `ready` flag (already `true`, never reset) lets it post that reply straight
 * to the *new* document. A monotonic counter restarting at `"1"` on every
 * load meant that reply's `requestId` could collide with an id the freshly
 * mounted grid had already issued for an unrelated window, silently resolving
 * the wrong `getRows` promise with rows for the wrong offset — `count` stays
 * correct, so nothing would even look wrong. A globally unique id removes the
 * collision outright, regardless of how many times this document reloads
 * inside the same panel; the same API already generates this panel's own CSP
 * nonce host-side (`dataViewerPanel.ts`), so it is a proven-available
 * primitive on both sides of this exact boundary.
 */
/** ag-grid's own `SortModelItem.sort` (`"asc"`/`"desc"`) mapped onto this
 * project's wire vocabulary (`SortSpec.direction`, `"ascending"`/
 * `"descending"`) — the exact shape `LibraryAdapter.applySort`'s own
 * `sortBy` body expects (`docs/phases/phase-7.md`'s Finding 7.15), so no
 * second translation happens host-side. */
function toSortSpecs(sortModel: readonly SortModelItem[]): readonly SortSpec[] {
  return sortModel.map((item) => ({
    key: item.colId,
    direction: item.sort === "desc" ? "descending" : "ascending",
  }));
}

function requestRows(
  start: number,
  limit: number,
  sort: readonly SortSpec[],
  filter: string,
): Promise<{ rows: readonly unknown[][]; count: number | undefined }> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pendingRowRequests.set(requestId, { resolve, reject });
    vscode.postMessage({
      type: "requestRows",
      requestId,
      start,
      limit,
      sort,
      filter,
    });
  });
}

/**
 * ag-grid's own `IGetRowsParams.successCallback`'s second argument — the
 * *known last row index*, or `undefined` if there might be more. `count`
 * (Finding 7.10) is the exact answer when the deployment supplied one — but
 * Findings 7.16/7.17 found `count` is **absent** the instant either a sort
 * or a filter is active, not merely sometimes null, so this grid needs
 * upstream's own `useDataViewer.ts` fallback for exactly that case: if fewer
 * rows came back than the page size asked for, that short page *is* the end,
 * full stop; otherwise there may be more, and ag-grid should ask again.
 */
function lastRowFor(
  startRow: number,
  rows: readonly unknown[][],
  requested: number,
  count: number | undefined,
): number | undefined {
  if (count !== undefined) return count;
  return rows.length < requested ? startRow + rows.length : undefined;
}

/** Maps this project's own {@link WireColumn} onto an ag-grid `ColDef`.
 * `sortable: true` — 7c's own server-side sort (`LibraryAdapter.applySort`,
 * a `createView` round trip, not something this grid does locally); ag-grid
 * still owns the header click/indicator/multi-sort UI, it just reads
 * `params.sortModel` fresh on every `getRows` call rather than sorting rows
 * client-side.
 *
 * **A `FLOAT` column gets ag-grid's own right-aligned cell/header classes —
 * caught in review as a claim this function was not honouring, then caught
 * again in Sean's own manual test pass (`manual-test-pass.md` §11,
 * 2026-09-10) as testing the wrong string.** `WireColumn.type`'s own doc
 * comment (`dataViewerModel.ts`) says this SAS type is "carried through
 * unmodified so the grid can right-align a numeric column", but the
 * original check compared against `"NUM"` — a value never confirmed against
 * a real deployment, and wrong: Finding 7.14 (`docs/phases/phase-7.md`) live-
 * probed `GET …/SASHELP/CLASS/columns` against `verde` and got `"FLOAT"` for
 * every numeric column (`Age`/`Height`/`Weight`) and `"CHAR"` for every
 * character one (`Name`/`Sex`), matching the worked example on SAS's own
 * `getColumns` reference (`developer.sas.com/rest-apis/compute/getColumns`)
 * exactly. `ag-right-aligned-cell`/`ag-right-aligned-header` are plain CSS
 * classes this panel's own imported stylesheets (`ag-grid.css`) already
 * define — not `type: "numericColumn"`, ag-grid's built-in provided column
 * type, which pulls in a default numeric filter this project has no way to
 * verify behaves correctly against a SAS numeric value in the sandbox this
 * was written in (packages not installed — see this file's own top doc
 * comment). Applying only the alignment classes keeps this fix inside what a
 * plain, already-loaded stylesheet can be trusted to do.
 *
 * **`initialSort` seeds a column's own `sort`/`sortIndex`** — the documented
 * way to give ag-grid a default sort at mount, read fresh into
 * `params.sortModel` by the same `getRows` call an ordinary header click
 * would trigger, so nothing downstream needs to know whether a sort came
 * from a user click or from this restore. Added for `InitMessage`'s own
 * `initialSort` field (`dataViewerModel.ts`) — see that field's doc comment
 * for why a hide/show cycle needs this at all. */
function toColumnDefs(
  columns: readonly WireColumn[],
  initialSort: readonly SortSpec[],
): ColDef[] {
  return columns.map((column) => {
    const sortIndex = initialSort.findIndex(
      (spec) => spec.key === column.field,
    );
    const sort = initialSort[sortIndex];
    return {
      field: column.field,
      headerName: column.headerName,
      sortable: true,
      ...(column.type === "FLOAT"
        ? {
            cellClass: "ag-right-aligned-cell",
            headerClass: "ag-right-aligned-header",
          }
        : {}),
      ...(sort !== undefined
        ? { sort: sort.direction === "descending" ? "desc" : "asc", sortIndex }
        : {}),
    };
  });
}

/** Turns one page's positional `cells` arrays into the field-keyed objects
 * ag-grid's row model actually wants. Correct *because* `columns`' own order
 * is exactly the order `src/data/adapter.ts`'s `getColumns` read the
 * collection in, and `RowItem.cells` is positional against that same column
 * order by construction (Finding 7.1, `src/data/types.ts`'s own doc comment)
 * — this function is the one place that positional contract turns into a
 * named one, and it does so by zipping the same `columns` array `init`
 * already established, never by re-deriving field order from the row data
 * itself. */
function toRowData(
  rows: readonly unknown[][],
  columns: readonly ColDef[],
): Record<string, unknown>[] {
  return rows.map((cells) => {
    const row: Record<string, unknown> = {};
    columns.forEach((column, index) => {
      if (column.field !== undefined) row[column.field] = cells[index];
    });
    return row;
  });
}

/** Builds the infinite-row-model datasource `onGridReady`/a committed filter
 * change installs. `filterRef` is read fresh on every `getRows` call (a
 * `useRef`, not a closed-over state value) so a filter committed after this
 * datasource was built is still picked up without rebuilding it again —
 * unlike `sort`, which ag-grid itself re-reads from `params.sortModel` on
 * every call and needs no such ref.
 *
 * **`onRowsError` — added responding to Sean's own manual test
 * (`manual-test-pass.md` §12): "an invalid filter just shows a blank table.
 * no error or warning."** The host already answers a bad `where=`/`sortBy`
 * with a real, specific message (Finding 7.18, `docs/phases/phase-7.md`) —
 * `requestRows`'s own promise rejects with exactly that string — but this
 * function was discarding it and calling only `params.failCallback()`,
 * which tells ag-grid a block failed to load and nothing else. Called with
 * `undefined` on every success, so a stale error from an earlier failed
 * fetch does not linger once a later one (a retry, a new filter, an
 * unrelated scroll) succeeds. */
function buildDatasource(
  columns: readonly ColDef[],
  filterRef: { readonly current: string },
  onRowsError: (message: string | undefined) => void,
): IDatasource {
  return {
    getRows: (params: IGetRowsParams) => {
      const requested = params.endRow - params.startRow;
      requestRows(
        params.startRow,
        requested,
        toSortSpecs(params.sortModel),
        filterRef.current,
      ).then(
        (page) => {
          onRowsError(undefined);
          params.successCallback(
            toRowData(page.rows, columns),
            lastRowFor(params.startRow, page.rows, requested, page.count),
          );
        },
        (message: string) => {
          onRowsError(message);
          params.failCallback();
        },
      );
    },
  };
}

function DataViewerApp() {
  const [columns, setColumns] = useState<ColDef[] | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [filterPlaceholder, setFilterPlaceholder] = useState<string>("");
  const [filterInput, setFilterInput] = useState<string>("");
  /** The most recent row-window fetch failure (an invalid filter, most
   * commonly), or `undefined` once a later fetch has succeeded — see {@link
   * buildDatasource}'s own `onRowsError` doc comment. */
  const [rowsError, setRowsError] = useState<string | undefined>(undefined);
  const gridApiRef = useRef<GridApi | undefined>(undefined);
  // The *committed* filter — updated only on Enter, read by the datasource's
  // own `getRows` closure via this ref rather than a dependency array, so a
  // fast series of keystrokes never rebuilds the datasource or re-fetches
  // anything until the user actually commits a value.
  const committedFilterRef = useRef<string>("");

  useEffect(() => {
    const listener = (event: MessageEvent<unknown>) => {
      // Caught by CodeQL (`js/missing-origin-check`) on this PR: nothing here
      // verified who posted the message before trusting `event.data`. A
      // `vscode-webview://…` document is still an ordinary browsing context —
      // CVE-2021-43908 demonstrated a real VS Code webview accepting a
      // `postMessage` from an arbitrary page loaded in an `<iframe>` pointed at
      // it, precisely because a handler skipped this check.
      //
      // **First attempt at this fix was itself wrong, caught by the
      // automated PR review (Codex), 2026-09-10**: a bare `startsWith("https:")`
      // fallback — copied from a community answer
      // (`microsoft/vscode-discussions#1061`) without checking its own
      // soundness — matches literally every HTTPS origin in existence,
      // `https://evil.example.com` included, which defeats the point of an
      // origin check entirely. The two concrete origins VS Code actually
      // uses are narrower: `vscode-webview://<id>` on desktop (confirmed via
      // a real webview's own `location.origin`), and
      // `https://<id>.vscode-webview.net` for a browser-hosted `vscode.dev`
      // window (`vscode-resource.vscode-webview.net` is the same domain
      // family VS Code's own resource-URI proxy uses — a real deployed
      // Microsoft domain, not a guess). Checking against those two
      // specifically, rather than the whole `https:` scheme, is what
      // actually narrows this to VS Code's own webview host. This project
      // ships no `browser` entry point (desktop-only, per `package.json`),
      // so the `.vscode-webview.net` arm is defensive rather than
      // load-bearing today.
      let parsedOrigin: URL;
      try {
        parsedOrigin = new URL(event.origin);
      } catch {
        return;
      }
      const isTrustedOrigin =
        parsedOrigin.protocol === "vscode-webview:" ||
        (parsedOrigin.protocol === "https:" &&
          parsedOrigin.hostname.endsWith(".vscode-webview.net"));
      if (!isTrustedOrigin) {
        return;
      }
      const message = event.data as DataViewerHostMessage | undefined;
      // `typeof null === "object"`, so `null` passes a bare `typeof`
      // check — nothing this project's own host code ever posts, and the
      // origin check above already restricts who gets this far, but the
      // `as` cast masks it as a latent gap rather than a checked one.
      if (
        message === undefined ||
        message === null ||
        typeof message !== "object"
      ) {
        return;
      }

      switch (message.type) {
        case "init":
          setColumns(toColumnDefs(message.columns, message.initialSort));
          setFilterPlaceholder(message.filterPlaceholder);
          // Restores the filter box's own displayed text, and — via the ref
          // `buildDatasource` reads from, set here rather than left to the
          // `filterInput` state's own effect — the value the datasource
          // `onGridReady` installs below actually reads on its first fetch.
          // See `InitMessage.initialFilter`'s own doc comment
          // (`dataViewerModel.ts`) for why this is no longer always "".
          setFilterInput(message.initialFilter);
          committedFilterRef.current = message.initialFilter;
          break;
        case "failure":
          setFailure(message.message);
          break;
        case "rows": {
          const pending = pendingRowRequests.get(message.requestId);
          if (pending === undefined) break;
          pendingRowRequests.delete(message.requestId);
          pending.resolve({ rows: message.rows, count: message.count });
          break;
        }
        case "rowsError": {
          const pending = pendingRowRequests.get(message.requestId);
          if (pending === undefined) break;
          pendingRowRequests.delete(message.requestId);
          pending.reject(message.message);
          break;
        }
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  const onGridReady = useCallback(
    (event: GridReadyEvent) => {
      gridApiRef.current = event.api;
      // No `rowCount` key at all — not `rowCount: undefined`, which this
      // project's own `exactOptionalPropertyTypes: true` (and `IDatasource`'s
      // own `rowCount?: number`) rejects outright once a real ag-grid install
      // could finally typecheck this file. Omitting the key entirely is the
      // same "unknown total" signal ag-grid reads it as, and is the same
      // choice upstream's own `useDataViewer.ts` makes with this exact
      // library version: `successCallback`'s own second argument (Finding
      // 7.10: reliably populated on a plain read; Findings 7.16/7.17 found it
      // absent once a sort or filter is active, which is what {@link
      // lastRowFor}'s own fallback exists for) is what tells the grid the
      // real total, per page, never a static total supplied up front.
      event.api.setGridOption(
        "datasource",
        buildDatasource(columns ?? [], committedFilterRef, setRowsError),
      );
    },
    [columns],
  );

  /** Commits the filter box's current value and re-installs a fresh
   * datasource — the same `setGridOption("datasource", ...)` re-install
   * upstream's own `refreshResults` uses, which both discards ag-grid's
   * cached blocks (so a stale, pre-filter row never lingers) and resets
   * scroll to row 0, matching what a newly filtered view should show. Sort
   * needs no equivalent: ag-grid re-invokes the *existing* datasource's
   * `getRows` itself the instant its own header-sort state changes, and that
   * callback already reads `params.sortModel` fresh every time. */
  const commitFilter = useCallback(() => {
    committedFilterRef.current = filterInput;
    gridApiRef.current?.setGridOption(
      "datasource",
      buildDatasource(columns ?? [], committedFilterRef, setRowsError),
    );
  }, [columns, filterInput]);

  // Sent once the listener above is attached — the host buffers its own
  // opening message (`init`/`failure`) until this arrives, the same
  // handshake ADR-0021 established for the result panel and for the same
  // reason: a message posted before this script has loaded is otherwise
  // simply lost.
  useEffect(() => {
    vscode.postMessage({ type: "ready" });
  }, []);

  if (failure !== undefined) {
    return <div className="python-on-viya-data-viewer-failure">{failure}</div>;
  }

  if (columns === undefined) {
    return null;
  }

  // Wrapped in a flex column, rather than letting `AgGridReact` be `#root`'s
  // sole child the way 7b left it: `dataViewerPanel.ts`'s own `<style>` block
  // gives `#root` `height: 100%`, and the grid fills whatever the immediate
  // parent gives it — the filter bar needs its own auto-height row above the
  // grid's own `flex: 1 1 auto` one, not a fixed pixel guess. **Not yet
  // visually confirmed against a real panel** — this file's own top doc
  // comment already names every prior visual claim here that needed Sean's
  // own manual check before it could be trusted, and this layout is the same
  // kind of claim: it typechecks and reads correctly, but whether the filter
  // bar and the grid actually share the panel's height the way this comment
  // predicts is for that check to confirm, not this comment.
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flex: "0 0 auto", padding: "4px" }}>
        <input
          type="text"
          className="python-on-viya-data-viewer-filter"
          placeholder={filterPlaceholder}
          aria-label={filterPlaceholder}
          value={filterInput}
          onChange={(event) => setFilterInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitFilter();
          }}
          style={{ width: "100%", boxSizing: "border-box" }}
        />
      </div>
      {rowsError !== undefined && (
        <div
          className="python-on-viya-data-viewer-rows-error"
          style={{ flex: "0 0 auto" }}
          role="alert"
        >
          {rowsError}
        </div>
      )}
      <div style={{ flex: "1 1 auto", minHeight: 0 }}>
        <AgGridReact
          className="ag-theme-alpine"
          theme="legacy"
          columnDefs={columns}
          rowModelType="infinite"
          cacheBlockSize={100}
          maxBlocksInCache={10}
          onGridReady={onGridReady}
          suppressDragLeaveHidesColumns
        />
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(<DataViewerApp />);
}
