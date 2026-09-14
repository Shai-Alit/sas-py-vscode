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
   * reference), so no extra network round trip is needed to re-list the
   * caslib.
   */
  private async getColumnsAndRefreshIcon(
    adapter: CasAdapter,
    table: CasTableItem,
  ): Promise<CasItem[]> {
    const wasUnloaded = table.state !== "loaded";
    const result = await adapter.getColumns(table);
    if (!result.ok) {
      this.log.error(
        vscode.l10n.t("CAS: {0}", describeCasProblem(result.problem)),
      );
      return [];
    }
    if (wasUnloaded) this.changed.fire({ ...table, state: "loaded" });
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
