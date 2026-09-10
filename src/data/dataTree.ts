// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `TreeDataProvider` behind the "SAS Libraries" view.
 *
 * Deliberately thin, mirroring `src/content/contentTree.ts`: which libraries
 * and tables exist is `src/data/adapter.ts`, how an item presents is
 * `src/data/presentation.ts` — both `vscode`-free and unit-tested. This class
 * is the shell: it maps a {@link NodePresentation} onto a
 * {@link vscode.TreeItem}, turns a {@link DataProblem} into a log line, and
 * never throws out of `getChildren`.
 *
 * The adapter is read through a getter rather than held, because
 * `src/data/dataExplorer.ts` builds a fresh one whenever the active profile
 * changes — a `LibraryAdapter` is parameterised by profile id (ADR-0027), not
 * rebuilt in place. When there is no adapter (no active profile) or the
 * adapter reports `not-connected`, `getChildren` returns nothing and the
 * view's `viewsWelcome` content shows instead.
 *
 * ## What this slice does not do
 *
 * No `command` on a table node (opening one needs the data-viewer webview,
 * 7b), no context-menu actions (7c), no `getParent` (nothing reveals yet) —
 * the same scope line `src/content/contentTree.ts` drew for 6a-ii.
 */

import * as vscode from "vscode";

import { type LibraryAdapter } from "./adapter";
import { nodePresentationOf } from "./presentation";
import { describeDataProblem } from "./problems";
import { isLibrary, isTable, type DataItem } from "./types";

export class SasLibraryTreeProvider
  implements vscode.TreeDataProvider<DataItem>, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<DataItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  dispose(): void {
    this.changed.dispose();
  }

  /**
   * @param currentAdapter Returns the adapter for the active profile, or
   *   `undefined` when there is no active profile at all. A profile with no
   *   compute session still yields an adapter — it is `LibraryAdapter` itself
   *   that reports `not-connected` per call, so a session that comes and goes
   *   is read fresh on every expand rather than baked into whether an adapter
   *   exists.
   * @param log The extension's shared channel — a failed listing is logged
   *   here, not shown as a notification, matching the content tree.
   */
  constructor(
    private readonly currentAdapter: () => LibraryAdapter | undefined,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  /** Re-reads the whole tree. Called on refresh, profile change, connect,
   * disconnect, sign-in and sign-out. */
  refresh(): void {
    this.changed.fire(undefined);
  }

  getTreeItem(item: DataItem): vscode.TreeItem {
    const shape = nodePresentationOf(item);
    const node = new vscode.TreeItem(
      shape.label,
      shape.expandable
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    node.iconPath = new vscode.ThemeIcon(shape.icon);
    node.contextValue = shape.contextValue;
    // A stable id so expansion and selection survive a refresh. A libref is
    // unique within a session and a table name is unique within a libref, so
    // qualifying a table's id with its libref is enough to avoid a collision
    // between two libraries that both happen to hold a same-named table.
    node.id = isLibrary(item)
      ? `library:${item.name}`
      : `table:${item.libref}.${item.name}`;
    return node;
  }

  async getChildren(item?: DataItem): Promise<DataItem[]> {
    const adapter = this.currentAdapter();
    if (adapter === undefined) return [];

    // A table is always a leaf in this slice.
    if (item !== undefined && isTable(item)) return [];

    const result =
      item === undefined
        ? await adapter.getLibraries()
        : await adapter.getTables(item);

    if (!result.ok) {
      this.log.error(
        vscode.l10n.t(
          "SAS Libraries: {0}",
          describeDataProblem(result.problem),
        ),
      );
      return [];
    }
    return [...result.value];
  }
}
