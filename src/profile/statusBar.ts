// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The status bar item showing which deployment this window is pointed at.
 *
 * It exists for a specific reason rather than for decoration. The active profile
 * lives in `workspaceState`, so unlike upstream's arrangement it is not visible
 * in `settings.json` — this item is what answers the question that file used to
 * answer. Before running code somewhere expensive, "which deployment is this?"
 * should be answerable by looking, not by opening a menu.
 *
 * Structure follows: client/src/components/StatusBarItem.ts in
 * sassoftware/vscode-sas-extension (Apache-2.0). No code was copied.
 * See docs/adr/0007-connection-profile-storage.md.
 */

import * as vscode from "vscode";

import { type ProfileStore } from "./store";

/**
 * Placed left of centre with a low priority so it sits near the other
 * "what am I connected to" indicators rather than competing with problems and
 * errors on the right.
 */
const PRIORITY = 0;

export function createProfileStatusBarItem(
  store: ProfileStore,
): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(
    "pythonOnViya.activeProfile",
    vscode.StatusBarAlignment.Left,
    PRIORITY,
  );
  item.name = vscode.l10n.t("Python on Viya: Connection Profile");
  item.command = "pythonOnViya.switchProfile";

  const render = (): void => {
    const active = store.active();
    if (active === undefined) {
      item.text = `$(server) ${vscode.l10n.t("No profile")}`;
      item.tooltip = vscode.l10n.t(
        "No SAS Viya connection profile is selected. Select one to run Python on Viya.",
      );
      // Warning rather than error: nothing has failed, and colouring an ordinary
      // first-run state red teaches people to ignore the colour.
      item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground",
      );
    } else {
      const lines = [
        `**${vscode.l10n.t("Python on Viya")}**`,
        `${vscode.l10n.t("Profile")}: ${active.name}`,
        `${vscode.l10n.t("Endpoint")}: ${active.profile.endpoint}`,
      ];
      if (active.profile.context !== undefined) {
        lines.push(`${vscode.l10n.t("Context")}: ${active.profile.context}`);
      }

      item.text = `$(server) ${active.name}`;
      item.tooltip = new vscode.MarkdownString(lines.join("\n\n"));
      item.backgroundColor = undefined;
    }
    item.show();
  };

  render();
  const subscription = store.onDidChange(render);

  return {
    dispose(): void {
      subscription.dispose();
      item.dispose();
    },
  };
}
