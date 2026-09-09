// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `TreeDataProvider` behind the "SAS Content" view — this repository's
 * first tree view.
 *
 * Deliberately thin, and branch-free where it can be. Which folders exist and
 * how a listing is shaped is `src/content/adapter.ts`; how an item presents
 * (label, icon, `contextValue`, whether it expands) is
 * `src/content/presentation.ts` — both `vscode`-free and unit-tested. This
 * class is the shell: it maps a {@link NodePresentation} onto a
 * {@link vscode.TreeItem}, turns a {@link ContentProblem} into a log line, and
 * never throws out of `getChildren` (VS Code renders a thrown error as an angry
 * inline node).
 *
 * The adapter is read through a getter rather than held, because
 * `src/content/contentExplorer.ts` rebuilds it when the active deployment
 * changes. When there is no adapter (no profile, or not signed in),
 * `getChildren` returns nothing and the view's `viewsWelcome` content shows.
 *
 * ## What this slice does not do
 *
 * No `command` on a file node (opening a remote file needs a
 * `FileSystemProvider`, slice 6b), no `resourceUri`, no `getParent` (only
 * `TreeView.reveal` needs it, and nothing reveals yet), no context-menu
 * actions (mutations are 6c). `contextValue` is set now so 6c's menu `when`
 * clauses do not require touching this file. A failed listing is logged, not
 * shown as a notification per expand — a per-click toast for a folder you
 * cannot read would be noise. The user-facing localisation seam
 * (`localiseContentProblem`) returns with 6b, when an action the user took
 * directly (open, save) can actually fail.
 */

import * as vscode from "vscode";

import { type ContentAdapter } from "./adapter";
import { nodePresentationOf } from "./presentation";
import { describeContentProblem } from "./problems";
import { type ContentItem } from "./types";

export class SasContentTreeProvider
  implements vscode.TreeDataProvider<ContentItem>, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<ContentItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  dispose(): void {
    this.changed.dispose();
  }

  /**
   * @param currentAdapter Returns the adapter for the active profile, or
   *   `undefined` when the view has nothing to show (no profile / signed out).
   * @param log The extension's shared channel — a failed listing is logged
   *   here, not shown as a notification.
   */
  constructor(
    private readonly currentAdapter: () => ContentAdapter | undefined,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  /** Re-reads the whole tree. Called on refresh, profile change, sign-in and
   * sign-out. */
  refresh(): void {
    this.changed.fire(undefined);
  }

  getTreeItem(item: ContentItem): vscode.TreeItem {
    const shape = nodePresentationOf(item);
    const node = new vscode.TreeItem(
      shape.label,
      shape.expandable
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    node.iconPath = new vscode.ThemeIcon(shape.icon);
    node.contextValue = shape.contextValue;
    // A stable id so expansion and selection survive a refresh. Service ids are
    // unique per representation — a delegate folder id, a root-listing folder
    // id and a member-record id never collide — and the synthetic root's id is
    // a fixed sentinel.
    node.id = item.id;
    return node;
  }

  async getChildren(item?: ContentItem): Promise<ContentItem[]> {
    const adapter = this.currentAdapter();
    if (adapter === undefined) return [];

    if (item !== undefined && !nodePresentationOf(item).expandable) return [];

    const result =
      item === undefined
        ? await adapter.getRootItems()
        : await adapter.getChildItems(item);

    if (!result.ok) {
      this.log.error(
        vscode.l10n.t(
          "SAS Content: {0}",
          describeContentProblem(result.problem),
        ),
      );
      return [];
    }
    return [...result.value];
  }
}
