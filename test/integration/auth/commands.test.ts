// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import { extensionId } from "../../helpers/manifest";

/**
 * The two auth commands, as the command palette sees them.
 *
 * This is also the only place anything in the suite touches the *real*
 * `SecretStorage`: `pythonOnViya.signOut` runs inside the activated extension,
 * against the `SessionStore` built on `context.secrets` in `activate`. There is
 * no way to read that store back from here, so what is proven is narrower than
 * the round-trip next door — that the real keychain accepts the call and the
 * command returns. It is worth having anyway, because a `delete` against a
 * keychain entry that was never written is exactly the kind of thing that throws
 * on one platform and not another.
 *
 * **`pythonOnViya.signIn` is deliberately not run with a profile configured.**
 * It would open a real browser and then block on a modal that no test can answer,
 * and the twenty-second timeout would be the only thing to end it. The flow
 * behind it is driven end to end in `browser-flow.test.ts`, where the browser and
 * the box are ports. What is left to test here is the arm that refuses before any
 * of that: no active profile, nothing to sign in to.
 */

const SECTION = "pythonOnViya";

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(SECTION);
}

async function set(key: string, value: unknown): Promise<void> {
  await config().update(key, value, vscode.ConfigurationTarget.Global);
}

describe("sign-in and sign-out commands", () => {
  before(async () => {
    const extension = vscode.extensions.getExtension(extensionId());
    assert.ok(extension, `${extensionId()} is not loaded`);
    await extension.activate();
  });

  afterEach(async () => {
    // The host reuses one user-data directory for the whole run, so a profile
    // left behind is a profile the next suite has to reason about.
    await set("connectionProfiles", undefined);
    await set("defaultProfile", undefined);
  });

  it("contributes both commands", async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of ["pythonOnViya.signIn", "pythonOnViya.signOut"]) {
      assert.ok(commands.includes(id), `${id} is not registered`);
    }
  });

  it("declares both commands under the extension's category", () => {
    // Without a category they appear in the palette as bare "Sign In" and "Sign
    // Out", next to every other extension's.
    const extension = vscode.extensions.getExtension(extensionId());
    assert.ok(extension);

    const contributed = commandContributions(extension);
    for (const id of ["pythonOnViya.signIn", "pythonOnViya.signOut"]) {
      const entry = contributed.find((command) => command.command === id);
      assert.ok(entry, `${id} is not in contributes.commands`);
      assert.ok(entry.title, `${id} has no title`);
      assert.ok(entry.category, `${id} has no category`);
      // Enablement keeps them out of the palette until there is a profile —
      // the same condition the profile commands use — and until the folder is
      // trusted. The trust half is not decoration: the provider throws on both
      // of these paths in an untrusted folder, and a palette entry that is
      // guaranteed to fail is worse than one that is not offered.
      assert.equal(
        entry.enablement,
        "pythonOnViya.hasProfiles && isWorkspaceTrusted",
      );
    }
  });

  it("refuses to sign in when no profile is selected", async () => {
    // The state every new install starts in. It reaches an information message
    // and returns; a command that throws on first use is the worst possible
    // first impression.
    await vscode.commands.executeCommand("pythonOnViya.signIn");
  });

  it("signs out of nothing without complaining", async () => {
    await vscode.commands.executeCommand("pythonOnViya.signOut");
  });

  it("clears a session through the real keychain", async () => {
    await set("connectionProfiles", {
      Prod: {
        version: 1,
        id: "auth-commands-integration",
        endpoint: "https://viya.example.com",
      },
    });
    await set("defaultProfile", "Prod");

    // No session was ever stored for this id, which is the case worth running:
    // signing out has to be safe when there is nothing to delete.
    await vscode.commands.executeCommand("pythonOnViya.signOut");
  });
});

interface CommandContribution {
  command?: string;
  title?: string;
  category?: string;
  enablement?: string;
}

/**
 * The manifest's `contributes.commands`, read from the loaded extension rather
 * than from the file on disk — the packaged manifest is the one the palette uses.
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
