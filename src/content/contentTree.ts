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
 * The adapter is read through a getter rather than held, because the tree
 * follows the active profile and `src/content/contentExplorer.ts` can switch
 * the deployment under the view. When there is no adapter (no profile, or not
 * signed in), `getChildren` returns nothing and the view's `viewsWelcome`
 * content shows.
 *
 * ## `getParent`, for reveal (6c-iii)
 *
 * {@link SasContentTreeProvider.getParent} lets `TreeView.reveal` walk from a
 * node up to a root, which the create (6c-i) and drag-and-drop move (6c-ii)
 * commands use to show and select the item they just landed. A top-level node
 * (the synthetic root, a delegate folder) has no parent; a folder directly
 * under the synthetic root reports none from the service (finding 6.12) and is
 * mapped back to {@link SAS_CONTENT_ROOT}; every other item asks the adapter.
 * The identity a rendered *member* node carries (its member-record id) and the
 * one an `ancestors` response carries for the same folder (its folder id)
 * differ, so `reveal` selects precisely only where the two agree — a delegate,
 * a root-listing folder, or a node taken straight from a fresh listing — and
 * otherwise just expands the chain, which is what `reveal` is for.
 *
 * The 6c-i context-menu actions (create/rename/delete) are commands registered
 * in `src/content/contentCommands.ts` and keyed on the `contextValue`
 * `src/content/presentation.ts` sets; this class only grew a {@link
 * SasContentTreeProvider.refresh} argument so one of those mutations can reload
 * just the folder it changed. A failed *listing* is logged, not shown as a
 * notification per expand — a per-click toast for a folder you cannot read
 * would be noise; a failed *open or save* is the `FileSystemProvider`'s to
 * surface, and a failed *mutation* is `contentCommands.ts`', both through
 * `localiseContentProblem`.
 *
 * 6b does wire one thing here: an openable file leaf
 * ({@link NodePresentation.openable}) gets a `resourceUri` and a `vscode.open`
 * command pointed at its `sasContent:` URI, so a single click opens the remote
 * file through `src/content/contentFileSystem.ts`.
 */

import * as vscode from "vscode";

import { type ContentAdapter } from "./adapter";
import { nodePresentationOf } from "./presentation";
import { describeContentProblem } from "./problems";
import {
  isDelegateFolder,
  isSasContentRoot,
  resourceHrefOf,
  SAS_CONTENT_ROOT,
  type ContentItem,
} from "./types";
import { contentReadOnlyUriString, contentUriString } from "./uri";

/**
 * The per-request bound on a {@link SasContentTreeProvider.getParent} fetch,
 * shorter than the client's 15s default. `getParent` has no `CancellationToken`
 * to thread (VS Code does not pass one), and a `reveal` walk can touch the
 * network once per ancestor level, so a slow deployment must not be able to
 * stack full-length timeouts behind a best-effort UI affordance. The client
 * still enforces its own default too — this only tightens it.
 */
const GET_PARENT_TIMEOUT_MS = 8_000;

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
   * @param currentEndpoint The active profile's deployment root, stamped into
   *   the `sasContent:` URI of each openable leaf so the file keeps talking to
   *   this deployment even after a later profile switch.
   * @param log The extension's shared channel — a failed listing is logged
   *   here, not shown as a notification.
   */
  constructor(
    private readonly currentAdapter: () => ContentAdapter | undefined,
    private readonly currentEndpoint: () => string | undefined,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  /**
   * Re-reads the tree. With no argument (refresh button, profile change,
   * sign-in/out) the whole tree reloads; with an `item` — a 6c-i mutation
   * naming the parent it changed — only that node's children are re-fetched,
   * so the rest of the user's expansion state is left alone. VS Code matches
   * the node by the `id` {@link SasContentTreeProvider.getTreeItem} stamped on
   * it, which is the item's own service id.
   */
  refresh(item?: ContentItem): void {
    this.changed.fire(item);
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

    // An openable file leaf: one click opens it through the `sasContent:`
    // FileSystemProvider. `resourceHrefOf` is the member's own `uri`; a member
    // that carries neither `uri` nor a `self` link, or a view with no active
    // deployment, is left inert rather than pointed at a URI missing a part.
    // A file shown inside the Recycle Bin opens under the read-only
    // `sasContentReadOnly:` scheme instead (6d-ii) — the same provider serves
    // it, registered `isReadonly`, so a recycled file can be looked at but not
    // edited before it is restored.
    const endpoint = this.currentEndpoint();
    if (shape.openable && endpoint !== undefined) {
      const href = resourceHrefOf(item);
      if (href !== undefined) {
        const readOnly = item.inRecycleBin === true;
        const uri = vscode.Uri.parse(
          readOnly
            ? contentReadOnlyUriString(item.name, href, endpoint)
            : contentUriString(item.name, href, endpoint),
        );
        node.resourceUri = uri;
        node.command = {
          command: "vscode.open",
          title: readOnly
            ? vscode.l10n.t("View Recycled SAS Content File")
            : vscode.l10n.t("Open SAS Content File"),
          arguments: [uri],
        };
      }
    }
    return node;
  }

  async getChildren(item?: ContentItem): Promise<ContentItem[]> {
    const adapter = this.currentAdapter();
    if (adapter === undefined) return [];

    if (item !== undefined && !nodePresentationOf(item).expandable) return [];

    const result =
      item === undefined
        ? await adapter.getRootItems()
        : // `markFavorites` costs one extra `@myFavorites/members` read per
          // user-driven expand, so the menu can offer Remove-from-Favorites on
          // an item already favourited (6d-i).
          await adapter.getChildItems(item, undefined, { markFavorites: true });

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

  /**
   * The parent of a node, for `TreeView.reveal`. VS Code walks this upward from
   * a reveal target, expanding each level.
   *
   * The synthetic root and the delegate folders are top-level — return
   * `undefined` so the walk stops. A folder read directly (`type: "folder"` —
   * the `isNull(parent)` listing) sits under the synthetic root, so when the
   * service reports it has no ancestors (finding 6.12) it is mapped back to
   * {@link SAS_CONTENT_ROOT} rather than read as top-level. Everything else
   * asks the adapter, on a {@link GET_PARENT_TIMEOUT_MS} bound since there is no
   * cancellation token to thread; a failure there is logged like a failed
   * listing and the walk stops.
   */
  async getParent(item: ContentItem): Promise<ContentItem | undefined> {
    if (isSasContentRoot(item) || isDelegateFolder(item)) return undefined;

    const adapter = this.currentAdapter();
    if (adapter === undefined) return undefined;

    const result = await adapter.getParentOfItem(
      item,
      AbortSignal.timeout(GET_PARENT_TIMEOUT_MS),
    );
    if (!result.ok) {
      this.log.error(
        vscode.l10n.t(
          "SAS Content: {0}",
          describeContentProblem(result.problem),
        ),
      );
      return undefined;
    }
    if (result.value !== undefined) return result.value;

    // No ancestors from the service. A folder read directly is a child of the
    // synthetic root; anything else with no ancestors is genuinely top-level.
    return item.type === "folder" ? SAS_CONTENT_ROOT : undefined;
  }
}
