// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The status bar affordance for `Python on Viya: Show environment` —
 * `PRODUCTION_PLAN.md` §2.3's "surfaced in the status bar," 3e's own minimum.
 *
 * Separate item from `statusBar.ts`'s run-target one rather than folded into
 * its tooltip: that item's command is `selectRunTarget`, and a single status
 * bar entry can only ever run one command when clicked. Visible only once
 * there is something to show — a configured Viya profile — the same
 * reasoning ADR-0011 gives for contributing nothing to the editor when the
 * target is Local: an item a person can click into a guaranteed "no profile
 * selected" refusal teaches them to ignore it.
 */

import * as vscode from "vscode";

import { type RunTargetStore } from "./targetStore";

/** Just right of `pythonOnViya.activeProfile` — same group, one step lower
 * priority, so the two read as a pair without VS Code being asked to order
 * them by anything but insertion. */
const PRIORITY = -1;

export function createEnvironmentStatusBarItem(
  targets: RunTargetStore,
): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(
    "pythonOnViya.environment",
    vscode.StatusBarAlignment.Left,
    PRIORITY,
  );
  item.name = vscode.l10n.t("Python on Viya: Environment");
  item.text = `$(package) ${vscode.l10n.t("Environment")}`;
  item.command = "pythonOnViya.showEnvironment";
  item.tooltip = vscode.l10n.t(
    "Show the Python interpreter version and installed packages for the current SAS Viya profile.",
  );

  const render = (): void => {
    const status = targets.status();
    if (status.kind === "viya" && status.profileName !== undefined) {
      item.show();
    } else {
      item.hide();
    }
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
