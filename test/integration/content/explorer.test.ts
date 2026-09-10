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
interface MenuContribution {
  command?: string;
  when?: string;
  group?: string;
}

const MUTATION_COMMANDS = [
  "pythonOnViya.createContentFolder",
  "pythonOnViya.createContentFile",
  "pythonOnViya.renameContentItem",
  "pythonOnViya.deleteContentItem",
];

const FAVORITE_COMMANDS = [
  "pythonOnViya.addContentToFavorites",
  "pythonOnViya.removeContentFromFavorites",
];

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

  it("registers the four 6c-i mutation commands", async () => {
    const registered = await vscode.commands.getCommands(true);
    for (const command of MUTATION_COMMANDS) {
      assert.ok(registered.includes(command), `${command} is not registered`);
    }
  });

  it("puts the mutation commands on the tree context menu, gated by contextValue, and hides them from the palette", () => {
    const extension = vscode.extensions.getExtension(extensionId());
    assert.ok(extension);
    const menus = (
      extension.packageJSON as {
        contributes?: {
          menus?: {
            "view/item/context"?: MenuContribution[];
            commandPalette?: MenuContribution[];
          };
        };
      }
    ).contributes?.menus;

    const contextEntries = (menus?.["view/item/context"] ?? []).filter((m) =>
      MUTATION_COMMANDS.includes(m.command ?? ""),
    );
    assert.equal(
      contextEntries.length,
      4,
      "expected four context-menu entries",
    );
    for (const entry of contextEntries) {
      assert.match(
        entry.when ?? "",
        /view == pythonOnViya\.contentExplorer/,
        `${entry.command ?? "?"} not scoped to the SAS Content view`,
      );
      assert.match(
        entry.when ?? "",
        /viewItem (==|=~) [^&]*sasContent:/,
        `${entry.command ?? "?"} not gated on a contextValue`,
      );
      // 6c-ii added `canSelectMany` to the tree; these commands only act on the
      // clicked item, so they must not offer themselves during a multi-select.
      assert.match(
        entry.when ?? "",
        /!listMultiSelection/,
        `${entry.command ?? "?"} not guarded against a multi-selection`,
      );
    }
    // Create is offered on folders and My Folder; rename/delete on folders and
    // files. Neither touches the synthetic root or the read-only delegates.
    const whenFor = (command: string) =>
      contextEntries.find((m) => m.command === command)?.when ?? "";
    assert.match(
      whenFor("pythonOnViya.createContentFolder"),
      /sasContent:myFolder/,
    );
    assert.doesNotMatch(
      whenFor("pythonOnViya.deleteContentItem"),
      /sasContent:(root|myFolder|delegate)/,
    );

    const hidden = (menus?.commandPalette ?? []).filter(
      (m) => MUTATION_COMMANDS.includes(m.command ?? "") && m.when === "false",
    );
    assert.equal(
      hidden.length,
      4,
      "all four should be hidden from the palette",
    );
  });

  it("does nothing catastrophic when a mutation command runs with no argument", async () => {
    // The `when` clauses stop this in the UI; belt-and-braces that the handler
    // guards a missing item rather than throwing into the command dispatcher.
    for (const command of [...MUTATION_COMMANDS, ...FAVORITE_COMMANDS]) {
      await assert.doesNotReject(
        Promise.resolve(vscode.commands.executeCommand(command)),
        `${command} threw with no argument`,
      );
    }
  });

  it("favourites commands early-out on a Recycle Bin item without throwing (6d-i)", async () => {
    // `favorite()` checks `item.inRecycleBin` before the session, so a
    // programmatic invocation on a bin item is short-circuited even though the
    // `.recycled` `when` clause already hides the menu entry.
    const recycled = {
      id: "bin-1",
      name: "old.py",
      type: "child",
      contentType: "file",
      inRecycleBin: true,
      links: [],
    };
    for (const command of FAVORITE_COMMANDS) {
      await assert.doesNotReject(
        Promise.resolve(vscode.commands.executeCommand(command, recycled)),
        `${command} threw on a recycled item`,
      );
    }
  });

  it("registers the two 6d-i favourites commands and wires their menu", async () => {
    const registered = await vscode.commands.getCommands(true);
    for (const command of FAVORITE_COMMANDS) {
      assert.ok(registered.includes(command), `${command} is not registered`);
    }

    const extension = vscode.extensions.getExtension(extensionId());
    assert.ok(extension);
    const menus = (
      extension.packageJSON as {
        contributes?: {
          menus?: {
            "view/item/context"?: MenuContribution[];
            commandPalette?: MenuContribution[];
          };
        };
      }
    ).contributes?.menus;

    const context = (menus?.["view/item/context"] ?? []).filter((m) =>
      FAVORITE_COMMANDS.includes(m.command ?? ""),
    );
    assert.equal(context.length, 2, "expected an Add and a Remove entry");
    const whenFor = (command: string) =>
      context.find((m) => m.command === command)?.when ?? "";
    // Add shows on a not-yet-favourited folder/file; Remove only on the
    // `.fav`-suffixed contextValue.
    assert.match(
      whenFor("pythonOnViya.addContentToFavorites"),
      /viewItem =~ \/\^sasContent:\(folder\|file\)\$\//,
    );
    assert.match(
      whenFor("pythonOnViya.removeContentFromFavorites"),
      /sasContent:\(folder\|file\)\\\.fav\$/,
    );
    for (const entry of context) {
      assert.match(entry.when ?? "", /!listMultiSelection/);
    }

    const hidden = (menus?.commandPalette ?? []).filter(
      (m) => FAVORITE_COMMANDS.includes(m.command ?? "") && m.when === "false",
    );
    assert.equal(hidden.length, 2, "both should be hidden from the palette");
  });

  it("withholds every content command from a .recycled item (6d-i)", () => {
    const extension = vscode.extensions.getExtension(extensionId());
    assert.ok(extension);
    const context = (
      (
        extension.packageJSON as {
          contributes?: {
            menus?: { "view/item/context"?: MenuContribution[] };
          };
        }
      ).contributes?.menus?.["view/item/context"] ?? []
    ).filter((m) =>
      [...MUTATION_COMMANDS, ...FAVORITE_COMMANDS].includes(m.command ?? ""),
    );
    assert.equal(context.length, 6, "expected all six content menu entries");

    // Every `viewItem =~ /.../` pattern in each content `when` clause, run
    // against the contextValue presentation.ts gives a Recycle Bin folder/file.
    for (const entry of context) {
      const patterns = [
        ...(entry.when ?? "").matchAll(/viewItem =~ \/([^/]+)\//g),
      ].map(([, body]) => new RegExp(body ?? ""));
      assert.ok(patterns.length > 0, `${entry.command ?? "?"}: no viewItem =~`);
      for (const suffix of [
        "sasContent:folder.recycled",
        "sasContent:file.recycled",
      ]) {
        for (const re of patterns) {
          assert.equal(
            re.test(suffix),
            false,
            `${entry.command ?? "?"} would still match a ${suffix} item`,
          );
        }
      }
    }
  });
});
