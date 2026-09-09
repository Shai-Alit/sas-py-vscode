// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import { extensionId } from "../../helpers/manifest";

/**
 * The SAS Content explorer, as the window sees it after activation.
 *
 * Registration and contribution are most of what this tier can prove without a
 * deployment to read: a view contributed in `package.json` but never created,
 * or a `refresh` command never registered, fails only when a user reaches it.
 * The adapter lifecycle and token flow are driven as pure logic in
 * `test/unit/content-session.test.ts`; the `TreeItem` mapping in
 * `test/integration/content/tree.test.ts`.
 */

interface ViewContribution {
  id?: string;
  name?: string;
}
interface ViewsWelcomeContribution {
  view?: string;
  when?: string;
}

describe("SAS Content explorer", () => {
  before(async () => {
    const extension = vscode.extensions.getExtension(extensionId());
    assert.ok(extension, `${extensionId()} is not loaded`);
    await extension.activate();
  });

  it("registers the refresh command", async () => {
    const registered = await vscode.commands.getCommands(true);
    assert.ok(
      registered.includes("pythonOnViya.refreshContentExplorer"),
      "pythonOnViya.refreshContentExplorer is not registered",
    );
  });

  it("contributes the activity-bar container and the tree view", () => {
    const extension = vscode.extensions.getExtension(extensionId());
    assert.ok(extension);
    const manifest = extension.packageJSON as {
      contributes?: {
        viewsContainers?: { activitybar?: { id?: string }[] };
        views?: Record<string, ViewContribution[]>;
        viewsWelcome?: ViewsWelcomeContribution[];
      };
    };
    const contributes = manifest.contributes ?? {};

    const container = contributes.viewsContainers?.activitybar?.find(
      (c) => c.id === "pythonOnViya",
    );
    assert.ok(container, "no pythonOnViya activity-bar container");

    const view = contributes.views?.pythonOnViya?.find(
      (v) => v.id === "pythonOnViya.contentExplorer",
    );
    assert.ok(view, "no pythonOnViya.contentExplorer view");

    const welcome = (contributes.viewsWelcome ?? []).filter(
      (w) => w.view === "pythonOnViya.contentExplorer",
    );
    assert.equal(
      welcome.length,
      2,
      "expected no-profile and signed-out welcome content",
    );
  });

  it("runs the refresh command without a profile without throwing", async () => {
    await assert.doesNotReject(
      Promise.resolve(
        vscode.commands.executeCommand("pythonOnViya.refreshContentExplorer"),
      ),
    );
  });
});
