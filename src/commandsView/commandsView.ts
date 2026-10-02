// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The Commands view (13c, F6): the tree, its labels and icons, and the
 * refresh when one of the context keys it follows changes. Which entries
 * show is `model.ts`; where the state comes from is `src/contextKeys.ts`.
 *
 * Labels repeat the palette titles in `package.nls.json`, without the
 * category, so a user learns one name for each command.
 */

import * as vscode from "vscode";

import { AUTHORIZED_CONTEXT_KEY } from "../auth/authProvider";
import { CONNECTED_CONTEXT_KEY } from "../compute/commands";
import { contextKeyValue, onDidChangeContextKey } from "../contextKeys";
import { HAS_PROFILES_CONTEXT_KEY } from "../profile/commands";
import { RUNNING_CONTEXT_KEY } from "../run/commands";
import {
  commandFor,
  commandsViewRoots,
  type CommandsEntryId,
  type CommandsGroupId,
  type CommandsNode,
  type CommandsViewState,
} from "./model";

/** The id of the tree view, matching `package.json`'s `contributes.views`. */
export const COMMANDS_VIEW_ID = "pythonOnViya.commandsView";

/** The context keys {@link CommandsViewState} is read from. */
const FOLLOWED_KEYS: ReadonlySet<string> = new Set([
  HAS_PROFILES_CONTEXT_KEY,
  AUTHORIZED_CONTEXT_KEY,
  CONNECTED_CONTEXT_KEY,
  RUNNING_CONTEXT_KEY,
]);

/** Reads the view's state; a key never set reads as `false`, as it does in a
 * `when` clause. */
export function readCommandsViewState(
  read: (key: string) => unknown = contextKeyValue,
): CommandsViewState {
  return {
    hasProfiles: read(HAS_PROFILES_CONTEXT_KEY) === true,
    authorized: read(AUTHORIZED_CONTEXT_KEY) === true,
    connected: read(CONNECTED_CONTEXT_KEY) === true,
    running: read(RUNNING_CONTEXT_KEY) === true,
  };
}

function groupLabel(group: CommandsGroupId): string {
  switch (group) {
    case "connection":
      return vscode.l10n.t("Connection");
    case "run":
      return vscode.l10n.t("Run");
    case "snippets":
      return vscode.l10n.t("Snippets");
  }
}

function entryLabelAndIcon(entry: CommandsEntryId): [string, string] {
  switch (entry) {
    case "addProfile":
      return [vscode.l10n.t("Add Connection Profile"), "add"];
    case "signIn":
      return [vscode.l10n.t("Sign In"), "sign-in"];
    case "connect":
      return [vscode.l10n.t("Connect to SAS Viya"), "plug"];
    case "disconnect":
      return [vscode.l10n.t("Disconnect from SAS Viya"), "debug-disconnect"];
    case "switchProfile":
      return [vscode.l10n.t("Switch Connection Profile"), "arrow-swap"];
    case "runFile":
      return [vscode.l10n.t("Run File"), "play"];
    case "openInteractiveWindow":
      return [vscode.l10n.t("New Interactive Window"), "window"];
    case "cancelRun":
      return [vscode.l10n.t("Cancel"), "debug-stop"];
    case "resetPythonState":
      return [vscode.l10n.t("Reset Python State"), "debug-restart"];
    case "selectRunTarget":
      return [vscode.l10n.t("Select Run Target"), "target"];
    case "insertCasConnectionSnippet":
      return [vscode.l10n.t("Insert CAS Connection Snippet"), "symbol-snippet"];
    case "insertCasSqlPassthroughSnippet":
      return [
        vscode.l10n.t("Insert CAS SQL Passthrough Snippet"),
        "symbol-snippet",
      ];
    case "refreshCasToken":
      return [vscode.l10n.t("Refresh CAS Token"), "key"];
    case "showOutputChannel":
      return [vscode.l10n.t("Show Log"), "output"];
  }
}

export class CommandsTreeProvider
  implements vscode.TreeDataProvider<CommandsNode>, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly state: () => CommandsViewState) {}

  refresh(): void {
    this.changed.fire();
  }

  getChildren(node?: CommandsNode): CommandsNode[] {
    if (node === undefined) return [...commandsViewRoots(this.state())];
    if (node.kind === "entry") return [];
    return node.entries.map((id) => ({ kind: "entry", id }));
  }

  getTreeItem(node: CommandsNode): vscode.TreeItem {
    if (node.kind === "group") {
      const item = new vscode.TreeItem(
        groupLabel(node.id),
        vscode.TreeItemCollapsibleState.Expanded,
      );
      // A stable id keeps a group's expanded state across a refresh.
      item.id = `group:${node.id}`;
      return item;
    }
    const [label, icon] = entryLabelAndIcon(node.id);
    const item = new vscode.TreeItem(
      label,
      vscode.TreeItemCollapsibleState.None,
    );
    item.id = `entry:${node.id}`;
    item.iconPath = new vscode.ThemeIcon(icon);
    item.command = { command: commandFor(node.id), title: label };
    return item;
  }

  dispose(): void {
    this.changed.dispose();
  }
}

/** Refreshes `provider` whenever one of the keys it follows changes. */
export function followContextKeys(
  provider: Pick<CommandsTreeProvider, "refresh">,
  onDidChange: vscode.Event<string> = onDidChangeContextKey,
): vscode.Disposable {
  return onDidChange((key) => {
    if (FOLLOWED_KEYS.has(key)) provider.refresh();
  });
}

/** Registers the Commands view. Every disposable goes on
 * `context.subscriptions`. */
export function registerCommandsView(context: vscode.ExtensionContext): void {
  const provider = new CommandsTreeProvider(() => readCommandsViewState());
  context.subscriptions.push(
    provider,
    vscode.window.createTreeView(COMMANDS_VIEW_ID, {
      treeDataProvider: provider,
    }),
    followContextKeys(provider),
  );
}
