// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * A synthetic tree node the three browsing trees (`src/content/contentTree.ts`,
 * `src/data/dataTree.ts`, `src/cas/casTree.ts`) render in place of a failed
 * listing, so a broken connection never reads as a silently empty tree
 * (Phase 11, B1).
 *
 * Before this: a failed `getChildren` call was logged to the output channel
 * and swallowed — `return []` — which is indistinguishable on screen from a
 * folder, caslib or library that is genuinely empty. `viewsWelcome` already
 * covers "no profile" and "signed in but no session at all" for the trees
 * that have that concept, but nothing rendered anything when a profile that
 * *looked* fine turned out not to be — a timed-out session, a dropped VPN,
 * mid-browse. This node is that missing case: each tree's own `!result.ok`
 * branch returns one of these instead of `[]`, at whatever level the
 * listing failed, carrying that domain's own already-existing user-facing
 * message (`localiseCasProblem`/`localiseContentProblem`/
 * `localiseDataProblem`) rather than the log-only fragment.
 *
 * Deliberately not folded into any of the three domains' own item unions
 * (`CasItem`/`ContentItem`/`DataItem`) — those stay `vscode`-free and unit
 * tested without this file (their own top-of-file doc comments are explicit
 * about never importing `vscode`). Each tree provider widens its own local
 * node type to include this one instead, the same way a `vscode`-facing
 * shell is already the seam between a pure domain type and the tree API in
 * all three modules.
 */

import * as vscode from "vscode";

export interface ConnectionProblemNode {
  readonly kind: "connectionProblem";
  /** A complete, punctuated, user-facing sentence — this domain's own
   * `localiseXProblem`, not the log-only `describeXProblem` fragment. */
  readonly message: string;
  /** The command id this node's click runs — each tree's own refresh
   * command (`pythonOnViya.refresh{Content,Data,Cas}Explorer`), so retrying
   * re-reads the listing rather than guessing at a specific remedy the
   * message itself may not warrant (a VPN blip needs a retry, not a
   * sign-in). */
  readonly retryCommand: string;
}

export function isConnectionProblemNode(
  item: unknown,
): item is ConnectionProblemNode {
  return (
    typeof item === "object" &&
    item !== null &&
    (item as { kind?: unknown }).kind === "connectionProblem"
  );
}

/** Builds the `vscode.TreeItem` for a {@link ConnectionProblemNode} — never
 * expandable, a warning icon, and a click that retries. */
export function connectionProblemTreeItem(
  node: ConnectionProblemNode,
): vscode.TreeItem {
  const item = new vscode.TreeItem(
    node.message,
    vscode.TreeItemCollapsibleState.None,
  );
  item.iconPath = new vscode.ThemeIcon("warning");
  item.contextValue = "connectionProblem";
  item.command = {
    command: node.retryCommand,
    title: vscode.l10n.t("Retry"),
  };
  return item;
}
