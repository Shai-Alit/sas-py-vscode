// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import { extensionId } from "../../helpers/manifest";

/**
 * The two compute commands, as the command palette sees them.
 *
 * Registration is most of what this tier can prove without a deployment to
 * connect to, and it is worth proving: a command contributed in `package.json`
 * and never registered fails at the moment a user runs it, with an error that
 * names the command and explains nothing.
 *
 * **`pythonOnViya.connect` is deliberately not run.** With no profile it reaches
 * an information message and returns, which is asserted below; with one it would
 * open a browser for a sign-in no test can answer. The behaviour behind it is
 * driven end to end in `session-manager.test.ts`, where the deployment, the
 * token and the progress bar are all ports.
 */

const COMMANDS = ["pythonOnViya.connect", "pythonOnViya.disconnect"];

interface CommandContribution {
  command?: string;
  title?: string;
  category?: string;
  enablement?: string;
}

describe("compute session commands", () => {
  before(async () => {
    const extension = vscode.extensions.getExtension(extensionId());
    assert.ok(extension, `${extensionId()} is not loaded`);
    await extension.activate();
  });

  it("registers both commands", async () => {
    const registered = await vscode.commands.getCommands(true);
    for (const id of COMMANDS) {
      assert.ok(registered.includes(id), `${id} is not registered`);
    }
  });

  it("gates each one on the state that makes it possible", () => {
    const extension = vscode.extensions.getExtension(extensionId());
    assert.ok(extension);
    const contributed = commandContributions(extension);

    const connect = contributed.find(
      (command) => command.command === "pythonOnViya.connect",
    );
    assert.ok(connect, "connect is not in contributes.commands");
    assert.ok(connect.title);
    assert.equal(connect.category, "Python on Viya");
    // Trust is not decoration here: the manager refuses in an untrusted folder,
    // and a palette entry guaranteed to fail is worse than one not offered.
    assert.equal(
      connect.enablement,
      "pythonOnViya.hasProfiles && isWorkspaceTrusted && !pythonOnViya.connected",
    );

    const disconnect = contributed.find(
      (command) => command.command === "pythonOnViya.disconnect",
    );
    assert.ok(disconnect, "disconnect is not in contributes.commands");
    assert.ok(disconnect.title);
    assert.equal(disconnect.category, "Python on Viya");
    // Only the one key: there is nothing to disconnect from unless a session is
    // held, and holding one already implies a trusted folder and a profile.
    assert.equal(disconnect.enablement, "pythonOnViya.connected");
  });

  it("declines to connect when no profile is selected", async () => {
    // The state every new install starts in. It reaches an information message
    // and returns; a command that throws on first use is the worst possible
    // first impression, and this one runs before any browser could open.
    await vscode.commands.executeCommand("pythonOnViya.connect");
  });

  it("disconnects from nothing without complaining", async () => {
    await vscode.commands.executeCommand("pythonOnViya.disconnect");
  });
});

/**
 * The manifest's `contributes.commands`, read from the loaded extension rather
 * than from the file on disk — the packaged manifest is the one the palette uses,
 * with `%key%` placeholders already resolved through `package.nls.json`.
 */
function commandContributions(
  extension: vscode.Extension<unknown>,
): CommandContribution[] {
  const packaged: unknown = extension.packageJSON as unknown;
  if (
    typeof packaged !== "object" ||
    packaged === null ||
    !("contributes" in packaged)
  ) {
    throw new Error("the loaded extension has no contributes section");
  }

  const section: unknown = packaged.contributes;
  if (
    typeof section !== "object" ||
    section === null ||
    !("commands" in section) ||
    !Array.isArray(section.commands)
  ) {
    throw new Error("the loaded extension contributes no commands");
  }

  return section.commands as CommandContribution[];
}
