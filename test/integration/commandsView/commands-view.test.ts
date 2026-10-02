// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import {
  CommandsTreeProvider,
  COMMANDS_VIEW_ID,
  followContextKeys,
  readCommandsViewState,
} from "../../../src/commandsView/commandsView";
import {
  commandsViewRoots,
  type CommandsViewState,
} from "../../../src/commandsView/model";
import {
  contextKeyValue,
  onDidChangeContextKey,
  setContextKey,
} from "../../../src/contextKeys";
import { extensionId } from "../../helpers/manifest";

/**
 * The Commands view (13c): the tree's items, the state it reads, and the
 * refresh when a followed context key changes. These import `out/src`, a
 * different copy of `src/contextKeys.ts` from the running extension's
 * bundle, so they drive the modules directly; that the real registrars feed
 * the view is manual items 13.75–13.78. Which entries show is
 * `test/unit/commands-view-model.test.ts`.
 */

const CONNECTED: CommandsViewState = {
  hasProfiles: true,
  authorized: true,
  connected: true,
  running: true,
};

function items(provider: CommandsTreeProvider): vscode.TreeItem[] {
  return provider
    .getChildren()
    .flatMap((root) =>
      root.kind === "group" ? [root, ...provider.getChildren(root)] : [root],
    )
    .map((node) => provider.getTreeItem(node));
}

describe("the Commands view", () => {
  before(async () => {
    const extension = vscode.extensions.getExtension(extensionId());
    assert.ok(extension, `${extensionId()} is not loaded`);
    await extension.activate();
  });

  it("is contributed, so its focus command exists", async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes(`${COMMANDS_VIEW_ID}.focus`));
  });

  it("gives every entry a registered command, a label and an icon", async () => {
    const registered = new Set(await vscode.commands.getCommands(true));
    for (const state of [
      CONNECTED,
      { ...CONNECTED, authorized: false, connected: false },
    ]) {
      const provider = new CommandsTreeProvider(() => state);
      for (const item of items(provider)) {
        if (item.command === undefined) continue;
        assert.ok(
          registered.has(item.command.command),
          `${item.command.command} is not registered`,
        );
        assert.equal(typeof item.label, "string");
        assert.notEqual(item.label, "");
        assert.ok(item.iconPath instanceof vscode.ThemeIcon);
        assert.equal(item.command.title, item.label);
        assert.equal(
          item.collapsibleState,
          vscode.TreeItemCollapsibleState.None,
        );
      }
      provider.dispose();
    }
  });

  it("shows groups expanded, with ids that survive a refresh", () => {
    const provider = new CommandsTreeProvider(() => CONNECTED);
    const groups = provider
      .getChildren()
      .filter((n) => n.kind === "group")
      .map((n) => provider.getTreeItem(n));
    assert.deepEqual(
      groups.map((g) => [g.id, g.label, g.collapsibleState]),
      [
        [
          "group:connection",
          "Connection",
          vscode.TreeItemCollapsibleState.Expanded,
        ],
        ["group:run", "Run", vscode.TreeItemCollapsibleState.Expanded],
        [
          "group:snippets",
          "Snippets",
          vscode.TreeItemCollapsibleState.Expanded,
        ],
      ],
    );
    assert.equal(
      groups.every((g) => g.command === undefined),
      true,
    );
    provider.dispose();
  });

  it("labels entries with their palette titles", () => {
    const provider = new CommandsTreeProvider(() => CONNECTED);
    const labels = items(provider)
      .filter((i) => i.command !== undefined)
      .map((i) => i.label);
    assert.deepEqual(labels, [
      "Disconnect from SAS Viya",
      "Switch Connection Profile",
      "Add Connection Profile",
      "Run File",
      "New Interactive Window",
      "Cancel",
      "Reset Python State",
      "Select Run Target",
      "Refresh CAS Token",
      "Insert CAS Connection Snippet",
      "Insert CAS SQL Passthrough Snippet",
      "Show Log",
    ]);
    provider.dispose();
  });

  it("labels the entries only shown in other states", () => {
    const provider = new CommandsTreeProvider(() => ({
      hasProfiles: true,
      authorized: false,
      connected: false,
      running: false,
    }));
    const connection = provider.getChildren()[0];
    assert.ok(connection);
    assert.deepEqual(
      provider
        .getChildren(connection)
        .map((n) => provider.getTreeItem(n).label),
      [
        "Sign In",
        "Connect to SAS Viya",
        "Switch Connection Profile",
        "Add Connection Profile",
      ],
    );
    provider.dispose();
  });

  it("asks for the state each time it lists the top level", () => {
    let state: CommandsViewState = { ...CONNECTED, running: false };
    const provider = new CommandsTreeProvider(() => state);
    assert.deepEqual(provider.getChildren(), [...commandsViewRoots(state)]);
    state = CONNECTED;
    assert.deepEqual(provider.getChildren(), [...commandsViewRoots(state)]);
    assert.deepEqual(
      provider.getChildren({ kind: "entry", id: "runFile" }),
      [],
    );
    provider.dispose();
  });

  it("reads each followed key, and anything but true as false", () => {
    const keys: Record<string, unknown> = {
      "pythonOnViya.hasProfiles": true,
      "pythonOnViya.authorized": "yes",
      "pythonOnViya.connected": true,
    };
    assert.deepEqual(
      readCommandsViewState((key) => keys[key]),
      { hasProfiles: true, authorized: false, connected: true, running: false },
    );
  });

  it("refreshes on a followed key, and not on any other", () => {
    const emitter = new vscode.EventEmitter<string>();
    let refreshes = 0;
    const subscription = followContextKeys(
      { refresh: () => (refreshes += 1) },
      emitter.event,
    );
    for (const key of [
      "pythonOnViya.hasProfiles",
      "pythonOnViya.authorized",
      "pythonOnViya.connected",
      "pythonOnViya.running",
    ]) {
      emitter.fire(key);
    }
    emitter.fire("pythonOnViya.runTarget");
    emitter.fire("pythonOnViya.hasContentClipboard");
    assert.equal(refreshes, 4);
    subscription.dispose();
    emitter.fire("pythonOnViya.running");
    assert.equal(refreshes, 4);
    emitter.dispose();
  });

  it("fires the tree's change event on refresh", () => {
    const provider = new CommandsTreeProvider(() => CONNECTED);
    let fired = 0;
    const subscription = provider.onDidChangeTreeData(() => (fired += 1));
    provider.refresh();
    assert.equal(fired, 1);
    subscription.dispose();
    provider.dispose();
  });
});

describe("the context-key mirror", () => {
  const KEY = "pythonOnViya.test.commandsViewMirror";

  it("records a value and fires only when it changes", async () => {
    const fired: string[] = [];
    const subscription = onDidChangeContextKey((key) => fired.push(key));
    assert.equal(contextKeyValue(KEY), undefined);

    await setContextKey(KEY, false);
    assert.equal(contextKeyValue(KEY), false);
    await setContextKey(KEY, false);
    await setContextKey(KEY, true);
    assert.equal(contextKeyValue(KEY), true);

    assert.deepEqual(fired, [KEY, KEY]);
    subscription.dispose();
  });
});
