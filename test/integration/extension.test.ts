// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import { activationEvents, extensionId } from "../helpers/manifest";

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

  /**
   * The one thing implicit command activation cannot do.
   *
   * A command in `contributes.commands` activates its extension when it runs,
   * which covers every path except the one that matters most: a reloaded window
   * runs no command, so without a startup event nothing registers the
   * authentication provider and a signed-in account does not come back. That
   * was the observed behaviour before `onStartupFinished` was declared.
   *
   * This is asserted against the manifest rather than against `isActive`,
   * because by the time any suite runs, something else in the run has almost
   * certainly activated the extension already — an `isActive` check here would
   * pass whether or not the event is declared, which is the worst kind of test.
   */
  it("declares a startup activation event, so a reloaded window restores sessions", () => {
    assert.ok(
      activationEvents().includes("onStartupFinished"),
      'activationEvents no longer includes "onStartupFinished". Commands activate the extension implicitly, but a reloaded window runs no command: the authentication provider would never be registered and the Accounts menu would come back empty. See docs/dev/building.md.',
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
