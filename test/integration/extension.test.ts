// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import { extensionId } from "../helpers/manifest";

/**
 * The whole point of the integration tier in one suite: this is the only place
 * that can prove the extension actually loads in a real VS Code. Bundling,
 * `main`, `engines`, the activation contract, and command registration are all
 * things the unit tier cannot see and the compiler cannot check — a bundle can
 * type-check perfectly and still fail to load.
 */
describe("extension activation", () => {
  const id = extensionId();

  it("is present in the test host", () => {
    assert.ok(
      vscode.extensions.getExtension(id),
      `${id} is not loaded. Either the manifest identity changed or --extensionDevelopmentPath is pointing somewhere unexpected.`,
    );
  });

  it("activates and registers its command", async () => {
    const extension = vscode.extensions.getExtension(id);
    assert.ok(extension);

    await extension.activate();
    assert.equal(extension.isActive, true);

    // `true` forces a refresh rather than trusting a cached list.
    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("pythonOnViya.showOutputChannel"),
      "pythonOnViya.showOutputChannel is not registered after activation",
    );
  });

  it("runs its command without throwing", async () => {
    await vscode.commands.executeCommand("pythonOnViya.showOutputChannel");
  });
});
