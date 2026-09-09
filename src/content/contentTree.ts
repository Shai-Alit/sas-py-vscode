// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `TreeDataProvider` behind the "SAS Content" view — this repository's
 * first tree view.
 *
 * Deliberately thin. Everything that can be reasoned about without an extension
 * host — which folders exist, how a member listing is shaped, how it sorts —
 * lives in `src/content/adapter.ts` and `src/content/types.ts`, which the unit
 * tier can load. This class is the `vscode` shell over it: it maps a
 * {@link ContentItem} to a {@link vscode.TreeItem}, turns a
 * {@link ContentProblem} into a log line, and never throws out of
 * `getChildren` (VS Code renders a thrown error as an angry inline node).
 *
 * The adapter is read through a getter rather than held, because it is rebuilt
 * whenever the active profile changes — see `src/content/contentExplorer.ts`.
 * When there is no adapter (no profile, or not signed in), `getChildren`
 * returns nothing and the view's `viewsWelcome` content shows instead.
 *
 * ## What this slice does not do
 *
 * No `command` on a file node (opening a remote file needs a
 * `FileSystemProvider`, which is slice 6b), no `resourceUri`, no `getParent`
 * (only `TreeView.reveal` needs it, and nothing reveals yet), no context-menu
 * actions (mutations are 6c). `contextValue` is set now so 6c's menu `when`
 * clauses do not require touching this file.
 */

import * as vscode from "vscode";

import { type ContentAdapter } from "./adapter";
import { describeContentProblem } from "./problems";
import {
  isContainer,
  isSasContentRoot,
  typeNameOf,
  type ContentItem,
} from "./types";

/** A folder-shaped item the tree can descend into. */
const CONTEXT_FOLDER = "sasContent:folder";
/** A leaf — a file or other non-navigable member. */
const CONTEXT_FILE = "sasContent:file";
/** The synthetic "SAS Content" root. */
const CONTEXT_ROOT = "sasContent:root";

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
   *   here, not shown as a notification per expand.
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
    const container = isContainer(item);
    const node = new vscode.TreeItem(
      item.name,
      container
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    node.iconPath = iconFor(item);
    node.contextValue = isSasContentRoot(item)
      ? CONTEXT_ROOT
      : container
        ? CONTEXT_FOLDER
        : CONTEXT_FILE;
    // A stable id so expansion and selection survive a refresh. Service ids are
    // unique per representation — a delegate folder id, a root-listing folder
    // id, and a member-record id never collide — and the synthetic root's id is
    // a fixed sentinel.
    node.id = item.id;
    return node;
  }

  async getChildren(item?: ContentItem): Promise<ContentItem[]> {
    const adapter = this.currentAdapter();
    if (adapter === undefined) return [];

    if (item !== undefined && !isContainer(item)) return [];

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

/** A theme icon per kind — no bundled SVGs. */
function iconFor(item: ContentItem): vscode.ThemeIcon {
  if (isSasContentRoot(item)) return new vscode.ThemeIcon("root-folder");
  switch (typeNameOf(item)) {
    case "favoritesFolder":
      return new vscode.ThemeIcon("star-full");
    case "trashFolder":
      return new vscode.ThemeIcon("trash");
    case "myFolder":
      return new vscode.ThemeIcon("folder-active");
    default:
      return isContainer(item)
        ? new vscode.ThemeIcon("folder")
        : new vscode.ThemeIcon("file");
  }
}
