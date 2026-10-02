// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The `TreeDataProvider` behind the "SAS Server" view.
 *
 * Deliberately thin, mirroring `src/data/dataTree.ts`: what is on the server
 * is `src/server/adapter.ts`, `vscode`-free and unit-tested. This class maps
 * a {@link ServerItem} onto a `vscode.TreeItem`, turns a failed listing into a
 * log line and a {@link ConnectionProblemNode}, and never throws out of
 * `getChildren`.
 *
 * The tree has one top-level node, the root folder (`Home`, or a custom
 * root's last segment), expanded. Upstream nests that under a "SAS Server"
 * folder next to "Folder Shortcuts"; this view's title already says SAS
 * Server, and shortcuts are not built.
 *
 * `not-connected` returns nothing, so the view's `viewsWelcome` offers
 * Connect. A `session-gone` listing also calls `forgetProfile`, as the
 * Library tree does, so Connect comes back.
 */

import * as vscode from "vscode";

import { type RootListing, type ServerAdapter } from "./adapter";
import { localiseServerProblem } from "./messages";
import { SERVER_FOLDER_SCHEME, serverUriString } from "./path";
import { describeServerProblem, type ServerProblem } from "./problems";
import { type ServerItem } from "./types";
import {
  connectionProblemTreeItem,
  isConnectionProblemNode,
  type ConnectionProblemNode,
} from "../connectionProblemNode";

/** A file or folder in the tree. */
export interface ServerTreeItem {
  readonly kind: "serverItem";
  readonly item: ServerItem;
  /** The profile whose session listed it; an opened file's URI carries it. */
  readonly profileId: string;
  /** Set on the root, which shows a label rather than its name. */
  readonly rootLabel?: string | undefined;
}

export type ServerTreeNode = ServerTreeItem | ConnectionProblemNode;

/** This view's refresh command, which a problem node's click retries. */
export const REFRESH_SERVER_COMMAND = "pythonOnViya.refreshServerExplorer";

/** `contextValue`s, matched by `package.json`'s menus. The root is its own
 * kind, so it can be created in and downloaded but not renamed, moved or
 * deleted. A folder the server marks `readOnly` gains
 * {@link SERVER_READ_ONLY_SUFFIX}, and is offered nothing that creates in it:
 * the root is one, and a create there fails with a `404` (Finding 13.34). */
export const SERVER_ROOT_CONTEXT = "sasServer:root";
export const SERVER_FOLDER_CONTEXT = "sasServer:folder";
export const SERVER_FILE_CONTEXT = "sasServer:file";
export const SERVER_READ_ONLY_SUFFIX = ".readOnly";

export function isServerTreeItem(node: unknown): node is ServerTreeItem {
  return (
    typeof node === "object" &&
    node !== null &&
    (node as { kind?: unknown }).kind === "serverItem"
  );
}

export class SasServerTreeProvider
  implements vscode.TreeDataProvider<ServerTreeNode>, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<
    ServerTreeNode | undefined
  >();
  readonly onDidChangeTreeData = this.changed.event;

  /**
   * @param currentAdapter The adapter for the active profile, or `undefined`
   *   with no active profile. Read on every call, never held.
   * @param log The shared channel a failed listing is logged to.
   * @param forgetProfile Drops a profile's cached connection once a listing
   *   finds its session gone (`src/data/dataTree.ts` explains why).
   * @param onRoot Told each root the tree reads, for the context's
   *   `allowDownload`.
   */
  constructor(
    private readonly currentAdapter: () => ServerAdapter | undefined,
    private readonly log: vscode.LogOutputChannel,
    private readonly forgetProfile: (profileId: string) => void,
    private readonly onRoot: (root: RootListing) => void = () => undefined,
  ) {}

  dispose(): void {
    this.changed.dispose();
  }

  refresh(): void {
    this.changed.fire(undefined);
  }

  getTreeItem(node: ServerTreeNode): vscode.TreeItem {
    if (isConnectionProblemNode(node)) return connectionProblemTreeItem(node);

    const { item, profileId, rootLabel } = node;
    const tree = new vscode.TreeItem(
      rootLabel ?? item.name,
      !item.isDirectory
        ? vscode.TreeItemCollapsibleState.None
        : rootLabel !== undefined
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
    );
    // Stable across refreshes, so expansion and selection survive one.
    tree.id = `sasServer:${profileId}:${item.path}`;
    tree.tooltip = item.path;
    tree.contextValue =
      (rootLabel !== undefined
        ? SERVER_ROOT_CONTEXT
        : item.isDirectory
          ? SERVER_FOLDER_CONTEXT
          : SERVER_FILE_CONTEXT) +
      (item.isDirectory && item.readOnly ? SERVER_READ_ONLY_SUFFIX : "");
    if (item.isDirectory) {
      // An identity URI only, never opened (`SERVER_FOLDER_SCHEME`).
      tree.resourceUri = vscode.Uri.parse(
        serverUriString({ profileId, path: item.path }, SERVER_FOLDER_SCHEME),
      );
      tree.iconPath = vscode.ThemeIcon.Folder;
    } else {
      const uri = vscode.Uri.parse(
        serverUriString({ profileId, path: item.path }),
      );
      tree.resourceUri = uri;
      tree.iconPath = vscode.ThemeIcon.File;
      tree.command = {
        command: "vscode.open",
        title: vscode.l10n.t("Open SAS Server File"),
        arguments: [uri],
      };
    }
    return tree;
  }

  async getChildren(node?: ServerTreeNode): Promise<ServerTreeNode[]> {
    if (node !== undefined && isConnectionProblemNode(node)) return [];
    if (node !== undefined && !node.item.isDirectory) return [];

    const adapter = this.currentAdapter();
    if (adapter === undefined) return [];
    // A node listed under another profile, expanded before the refresh a
    // profile change fires: its links name that profile's session, so they
    // must not be followed with this one's client.
    if (node !== undefined && node.profileId !== adapter.profileId) return [];

    if (node === undefined) {
      const root = await adapter.getRoot();
      if (!root.ok) return this.failed(adapter, root.problem);
      this.onRoot(root.value);
      return [
        {
          kind: "serverItem",
          item: root.value.item,
          profileId: adapter.profileId,
          // `/` is Home whatever named it; only a custom folder is
          // labelled by its own name.
          rootLabel:
            root.value.root.custom && root.value.root.path !== "/"
              ? root.value.root.label
              : vscode.l10n.t("Home"),
        },
      ];
    }

    const children = await adapter.getChildren(node.item);
    if (!children.ok) return this.failed(adapter, children.problem);
    if (children.value.truncated) {
      this.log.warn(
        vscode.l10n.t(
          'SAS Server: "{0}" has more entries than this view lists; only the first {1} are shown.',
          node.item.path,
          String(children.value.items.length),
        ),
      );
    }
    return children.value.items.map((item) => ({
      kind: "serverItem",
      item,
      profileId: adapter.profileId,
    }));
  }

  /** Logs a failed listing and returns what the tree shows for it. */
  private failed(
    adapter: ServerAdapter,
    problem: ServerProblem,
  ): ServerTreeNode[] {
    this.log.error(
      vscode.l10n.t("SAS Server: {0}", describeServerProblem(problem)),
    );
    if (problem.code === "not-connected") return [];
    if (problem.code === "compute" && problem.problem.code === "session-gone") {
      this.forgetProfile(adapter.profileId);
    }
    return [
      {
        kind: "connectionProblem",
        message: localiseServerProblem(problem),
        retryCommand: REFRESH_SERVER_COMMAND,
      },
    ];
  }
}
