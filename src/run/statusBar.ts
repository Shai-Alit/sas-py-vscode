// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The status bar item showing which run target this window is pointed at —
 * ADR-0011's "the status bar item is the switch."
 *
 * This supersedes `src/profile/statusBar.ts` (removed in the same slice): the
 * item id (`pythonOnViya.activeProfile`) is unchanged, so it keeps its place
 * and its identity to the host, but its job grows from "which deployment" to
 * "which target, and which deployment if that target is Viya" — and its
 * command changes from `pythonOnViya.switchProfile` to
 * `pythonOnViya.selectRunTarget`. That is a visible change to a shipped
 * affordance; see `CHANGELOG.md`.
 *
 * Structure follows: client/src/components/StatusBarItem.ts in
 * sassoftware/vscode-sas-extension (Apache-2.0). No code was copied.
 * See docs/adr/0007-connection-profile-storage.md and docs/adr/0011-choosing-where-python-runs.md.
 */

import * as vscode from "vscode";

import { type ProfileStore } from "../profile/store";
import { type RunTargetStore } from "./targetStore";

/** Same priority `profile/statusBar.ts` used: left of centre, low priority,
 * near the other "what am I connected to" indicators. */
const PRIORITY = 0;

export function createRunTargetStatusBarItem(
  profiles: ProfileStore,
  targets: RunTargetStore,
): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(
    "pythonOnViya.activeProfile",
    vscode.StatusBarAlignment.Left,
    PRIORITY,
  );
  item.name = vscode.l10n.t("Python on Viya: Run Target");
  item.command = "pythonOnViya.selectRunTarget";

  const render = (): void => {
    const status = targets.status();

    if (status.kind === "local") {
      item.text = `$(vm-outline) ${vscode.l10n.t("Local Python")}`;
      item.tooltip = new vscode.MarkdownString(
        [
          `**${vscode.l10n.t("Python on Viya")}**`,
          `${vscode.l10n.t("Target")}: ${vscode.l10n.t("Local Python")}`,
          vscode.l10n.t(
            "Run and Debug use the Python extension's own button. Nothing from this extension appears in the editor while this is the target.",
          ),
        ].join("\n\n"),
      );
      item.backgroundColor = undefined;
      item.show();
      return;
    }

    if (status.profileName === undefined) {
      item.text = `$(server) ${vscode.l10n.t("No profile")}`;
      item.tooltip = new vscode.MarkdownString(
        [
          `**${vscode.l10n.t("Python on Viya")}**`,
          `${vscode.l10n.t("Target")}: ${vscode.l10n.t("SAS Viya")}`,
          vscode.l10n.t(
            "No SAS Viya connection profile is selected. Select one to run Python on Viya.",
          ),
        ].join("\n\n"),
      );
      // Warning rather than error: nothing has failed, and colouring an
      // ordinary first-run state red teaches people to ignore the colour.
      item.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground",
      );
      item.show();
      return;
    }

    const active = profiles.get(status.profileName);
    const lines = [
      `**${vscode.l10n.t("Python on Viya")}**`,
      `${vscode.l10n.t("Target")}: ${vscode.l10n.t("SAS Viya")}`,
      `${vscode.l10n.t("Profile")}: ${status.profileName}`,
    ];
    if (active !== undefined) {
      lines.push(`${vscode.l10n.t("Endpoint")}: ${active.endpoint}`);
      if (active.context !== undefined) {
        lines.push(`${vscode.l10n.t("Context")}: ${active.context}`);
      }
    }

    item.text = `$(server) ${status.profileName}`;
    item.tooltip = new vscode.MarkdownString(lines.join("\n\n"));
    item.backgroundColor = undefined;
    item.show();
  };

  render();
  const subscription = targets.onDidChange(render);

  return {
    dispose(): void {
      subscription.dispose();
      item.dispose();
    },
  };
}
