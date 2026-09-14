// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `TreeDataProvider` behind the "CAS" view.
 *
 * Deliberately thin, mirroring `src/data/dataTree.ts`: which servers,
 * caslibs, tables and columns exist is `src/cas/adapter.ts`, how an item
 * presents is `src/cas/presentation.ts` — both `vscode`-free and unit
 * tested. This class is the shell: it maps a {@link NodePresentation} onto a
 * {@link vscode.TreeItem}, turns a {@link CasProblem} into a log line, and
 * never throws out of `getChildren`.
 *
 * The adapter is read through a getter rather than held, for the same reason
 * `SasLibraryTreeProvider` reads one: `src/cas/casExplorer.ts` builds a fresh
 * one whenever the active deployment changes.
 *
 * ## 8c: a table node now opens the data viewer
 *
 * A table's `vscode.TreeItem` carries a `command`
 * (`pythonOnViya.openCasTable`, `package.json`'s own `view/item/context`
 * entry mirrors it for the right-click menu), fired with the item itself as
 * its argument — the same one-argument shape `src/data/dataTree.ts`'s
 * `pythonOnViya.openTable` already established, so this class stays free of
 * knowing anything about `DataViewerPanelManager` or `CasAdapter.openTable`/
 * `getColumns`/`getRows` itself. A column is always a leaf.
 */

import * as vscode from "vscode";

import { type CasAdapter } from "./adapter";
import { describeCasProblem } from "./problems";
import { nodePresentationOf } from "./presentation";
import {
  isCaslib,
  isCasColumn,
  isCasServer,
  isCasTable,
  type CasItem,
  type CasTableItem,
} from "./types";

export class SasCasTreeProvider
  implements vscode.TreeDataProvider<CasItem>, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<CasItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  /**
   * Columns just served for a table this provider itself told VS Code had
   * changed, keyed by {@link nodeId} — consumed by the very next
   * {@link getColumnsAndRefreshIcon} call for that id, then discarded.
   *
   * **Caught in PR #173's own automated review (GitHub Actions bot,
   * 2026-09-14), plausible not confirmed:** firing {@link onDidChangeTreeData}
   * for a table while VS Code is mid-expanding that exact node matches the
   * API's own "update the changed element ... and its children recursively
   * (if shown)" contract — the node is shown, being expanded right now — so
   * VS Code is expected to re-invoke `getChildren` for it immediately,
   * re-running `adapter.getColumns` a second time. Idempotent (the second
   * call sees `state === "loaded"` and does not fire again) but a real extra
   * network round trip {@link getColumnsAndRefreshIcon}'s own doc comment
   * claimed did not happen. This cache removes it: the columns that method
   * already fetched are served straight back on that one expected re-entrant
   * call rather than being fetched twice, and the entry is deleted the
   * instant it is read so a later, unrelated collapse/re-expand of the same
   * table always fetches for real rather than ever risking stale columns.
   */
  private readonly justLoaded = new Map<string, readonly CasItem[]>();

  dispose(): void {
    this.changed.dispose();
  }

  /**
   * @param currentAdapter Returns the adapter for the active deployment, or
   *   `undefined` when there is no active profile at all.
   * @param log The extension's shared channel — a failed listing is logged
   *   here, not shown as a notification, matching the SAS Libraries and SAS
   *   Content trees.
   */
  constructor(
    private readonly currentAdapter: () => CasAdapter | undefined,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  /** Re-reads the whole tree. Called on refresh, profile change, sign-in and
   * sign-out. */
  refresh(): void {
    this.changed.fire(undefined);
  }

  getTreeItem(item: CasItem): vscode.TreeItem {
    const shape = nodePresentationOf(item);
    const node = new vscode.TreeItem(
      shape.label,
      shape.expandable
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    if (shape.description !== undefined) node.description = shape.description;
    node.iconPath = new vscode.ThemeIcon(shape.icon);
    node.contextValue = shape.contextValue;
    node.id = nodeId(item);
    if (isCasTable(item)) {
      // Opening is a click, not just a context-menu action — matching
      // `src/data/dataTree.ts`'s own `pythonOnViya.openTable`. Not gated on
      // `item.state`: `CasAdapter.openTable` loads an unloaded table itself
      // (the same JIT-load gate `getColumns` already has), so clicking an
      // unloaded ("cloud"-icon) table works exactly like clicking a loaded
      // one, just slower the first time.
      node.command = {
        command: "pythonOnViya.openCasTable",
        title: vscode.l10n.t("Open Table"),
        arguments: [item],
      };
    }
    return node;
  }

  async getChildren(item?: CasItem): Promise<CasItem[]> {
    const adapter = this.currentAdapter();
    if (adapter === undefined) return [];

    if (item !== undefined && isCasColumn(item)) return [];

    if (item !== undefined && isCasTable(item)) {
      return await this.getColumnsAndRefreshIcon(adapter, item);
    }

    const result =
      item === undefined
        ? await adapter.getServers()
        : isCasServer(item)
          ? await adapter.getCaslibs(item)
          : await adapter.getTables(item);

    if (!result.ok) {
      this.log.error(
        vscode.l10n.t("CAS: {0}", describeCasProblem(result.problem)),
      );
      return [];
    }
    return [...result.value];
  }

  /**
   * Expanding an unloaded table triggers `CasAdapter.getColumns`'s own
   * JIT-load `PUT` (Finding 8.3/8.8), but `table` is this caller's own stale
   * reference — its `state` still reads `"unloaded"` afterward, because
   * nothing re-fetches or mutates it, so `getTreeItem` kept drawing the
   * cloud icon until the user ran **Refresh CAS** by hand. **Manual test
   * finding, 2026-09-14**: the icon should flip the moment the load
   * succeeds, with no refresh needed.
   *
   * Fixed by firing {@link onDidChangeTreeData} with a state-updated copy of
   * `table` once `getColumns` succeeds — the same `{ ...table, state:
   * "loaded" }` shape `CasAdapter.openTable`'s own doc comment already
   * establishes is correct post-load, regardless of whether this call did
   * the loading or the table already was. VS Code re-renders the node from
   * this fresh object (matched to the existing row by `nodeId`, not by
   * reference), so no extra round trip is needed to re-list the caslib — but
   * firing for a node that is itself mid-expansion is expected to make VS
   * Code re-invoke `getChildren` for that same node immediately (the API's
   * own "and its children recursively, if shown" contract); {@link
   * justLoaded}'s own doc comment covers why that re-entrant call is served
   * from cache rather than hitting `adapter.getColumns` again.
   */
  private async getColumnsAndRefreshIcon(
    adapter: CasAdapter,
    table: CasTableItem,
  ): Promise<CasItem[]> {
    const id = nodeId(table);
    const cached = this.justLoaded.get(id);
    if (cached !== undefined) {
      this.justLoaded.delete(id);
      return [...cached];
    }

    const wasUnloaded = table.state !== "loaded";
    const result = await adapter.getColumns(table);
    if (!result.ok) {
      this.log.error(
        vscode.l10n.t("CAS: {0}", describeCasProblem(result.problem)),
      );
      return [];
    }
    if (wasUnloaded) {
      this.justLoaded.set(id, result.value);
      this.changed.fire({ ...table, state: "loaded" });
    }
    return [...result.value];
  }
}

/** A stable id so expansion and selection survive a refresh — qualified by
 * every ancestor's own name, the same reason `dataTree.ts` qualifies a
 * table's id with its libref. */
function nodeId(item: CasItem): string {
  if (isCasServer(item)) return `cas:${item.name}`;
  if (isCaslib(item)) return `cas:${item.serverName}.${item.name}`;
  if (isCasTable(item)) {
    return `cas:${item.serverName}.${item.caslibName}.${item.name}`;
  }
  return `cas:${item.serverName}.${item.caslibName}.${item.tableName}.${item.name}`;
}
