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
 * ## No command on a table or column node in this slice
 *
 * There is no CAS data viewer yet (that is 8c, blocked on 7b's own
 * React/ag-grid decision — `docs/phases/phase-8.md`'s Plan section), so a
 * table node here does not open anything on click, unlike
 * `src/data/dataTree.ts`'s `pythonOnViya.openTable`. A column is always a
 * leaf.
 */

import * as vscode from "vscode";

import { type CasAdapter } from "./adapter";
import { describeCasProblem } from "./problems";
import { nodePresentationOf } from "./presentation";
import {
  isCasColumn,
  isCaslib,
  isCasServer,
  isCasTable,
  type CasItem,
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
    return node;
  }

  async getChildren(item?: CasItem): Promise<CasItem[]> {
    const adapter = this.currentAdapter();
    if (adapter === undefined) return [];

    if (item !== undefined && isCasColumn(item)) return [];

    const result =
      item === undefined
        ? await adapter.getServers()
        : isCasServer(item)
          ? await adapter.getCaslibs(item)
          : isCaslib(item)
            ? await adapter.getTables(item)
            : await adapter.getColumns(item);

    if (!result.ok) {
      this.log.error(
        vscode.l10n.t("CAS: {0}", describeCasProblem(result.problem)),
      );
      return [];
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
