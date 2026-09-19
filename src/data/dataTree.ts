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
 * ## 7b: a table node now opens the data viewer
 *
 * A table's `vscode.TreeItem` carries a `command` (`pythonOnViya.openTable`,
 * `package.json`'s own `view/item/context` entry mirrors it for the
 * right-click menu), fired with the item itself as its argument — the same
 * one-argument shape `src/data/dataExplorer.ts`'s command handler expects, so
 * this class stays free of knowing anything about `DataViewerPanelManager`
 * or `LibraryAdapter.openTable`/`getColumns`/`getRows` itself.
 *
 * ## What this slice still does not do
 *
 * No further context-menu actions beyond "Open" (sort/filter/export/
 * properties are 7c), no `getParent` (nothing reveals yet) — the same scope
 * line `src/content/contentTree.ts` drew for 6a-ii.
 *
 * ## 11c: a failed listing renders, it does not just log (B1/B2)
 *
 * This doc comment's own second paragraph above is now only half true: a
 * `not-connected` failure — genuinely no cached session — still falls
 * through to `viewsWelcome`. Everything else `!result.ok` can mean (a
 * session that *was* cached but the server has since reaped, a permission
 * error, a malformed response) used to log and return `[]` too —
 * indistinguishable on screen from a library that is genuinely empty. It now
 * returns one `ConnectionProblemNode` (`../connectionProblemNode.ts`)
 * instead, carrying `localiseDataProblem`'s own user-facing sentence and a
 * click that runs this view's own refresh command (B1). A `session-gone`
 * reading specifically also calls {@link SasLibraryTreeProvider}'s own
 * `forgetProfile` — see its constructor doc comment — so **Connect**
 * reappears in the palette instead of staying hidden until the user finds
 * **Disconnect** first (B2).
 */

import * as vscode from "vscode";

import { type LibraryAdapter } from "./adapter";
import { localiseDataProblem } from "./messages";
import { nodePresentationOf } from "./presentation";
import { describeDataProblem } from "./problems";
import { isLibrary, isTable, type DataItem } from "./types";
import {
  connectionProblemTreeItem,
  isConnectionProblemNode,
  type ConnectionProblemNode,
} from "../connectionProblemNode";

/** What this tree hands VS Code: a real library/table item, or (B1) a
 * synthetic node standing in for a listing that failed. */
export type DataTreeNode = DataItem | ConnectionProblemNode;

/** This tree's own refresh command (`package.json`) — what a
 * {@link ConnectionProblemNode}'s click retries. */
const REFRESH_COMMAND = "pythonOnViya.refreshDataExplorer";

export class SasLibraryTreeProvider
  implements vscode.TreeDataProvider<DataTreeNode>, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<
    DataTreeNode | undefined
  >();
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
   * @param forgetProfile (11c, B2) Drops this window's cached connection for
   *   a profile a listing has just discovered is actually gone
   *   (`ComputeProblem` `session-gone`) and re-syncs `pythonOnViya.connected`
   *   — the same `ComputeCommandHandles.forgetProfile` a run/reset/probe
   *   already calls on `backend-gone` (`src/run/commands.ts`). Without this,
   *   a session that dies while the user is only ever browsing — never
   *   running anything — leaves `pythonOnViya.connected` stuck `true`:
   *   **Connect** stays hidden from the palette (its `enablement` is
   *   `!pythonOnViya.connected`) and the tree has no `viewsWelcome` state
   *   left to fall into, since none of the three match a profile that is
   *   signed in and believes itself connected. The only way out, before this
   *   fix, was **Disconnect** — a full sign-out-shaped action — even though
   *   nothing about the profile or the sign-in was actually wrong.
   */
  constructor(
    private readonly currentAdapter: () => LibraryAdapter | undefined,
    private readonly log: vscode.LogOutputChannel,
    private readonly forgetProfile: (profileId: string) => void,
  ) {}

  /** Re-reads the whole tree. Called on refresh, profile change, connect,
   * disconnect, sign-in and sign-out. */
  refresh(): void {
    this.changed.fire(undefined);
  }

  getTreeItem(item: DataTreeNode): vscode.TreeItem {
    if (isConnectionProblemNode(item)) return connectionProblemTreeItem(item);

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
    if (isTable(item)) {
      // Opening is a click, not just a context-menu action — matching how a
      // file in `src/content/contentTree.ts` opens. The command receives the
      // `TableItem` itself; `src/data/dataExplorer.ts`'s registration is what
      // turns that into a `LibraryAdapter.openTable`/`getColumns` call and a
      // `DataViewerPanelManager.open`, so this class stays exactly as thin as
      // it was before 7b.
      node.command = {
        command: "pythonOnViya.openTable",
        title: vscode.l10n.t("Open Table"),
        arguments: [item],
      };
    }
    return node;
  }

  async getChildren(item?: DataTreeNode): Promise<DataTreeNode[]> {
    // Never expandable (see `connectionProblemTreeItem`), so VS Code should
    // never ask — guarded anyway to keep the rest of this method typed
    // against `DataItem`, not the wider `DataTreeNode`.
    if (item !== undefined && isConnectionProblemNode(item)) return [];

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
      // (11c, B2) The session this listing tried to use is actually gone —
      // not merely "never had one" (`not-connected`, decided before any
      // request, `LibraryAdapter.require()`) — so this window's own belief
      // that it still holds a connection is wrong. See this class's own
      // constructor doc comment for `forgetProfile`.
      if (
        result.problem.code === "compute" &&
        result.problem.problem.code === "session-gone"
      ) {
        this.forgetProfile(adapter.profileId);
      }
      return [
        {
          kind: "connectionProblem",
          message: localiseDataProblem(result.problem),
          retryCommand: REFRESH_COMMAND,
        },
      ];
    }
    return [...result.value];
  }
}
