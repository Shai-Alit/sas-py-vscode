// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";

import {
  commandFor,
  commandsViewRoots,
  type CommandsEntryId,
  type CommandsGroupId,
  type CommandsNode,
  type CommandsViewState,
} from "../../src/commandsView/model";

/** The Commands view's model (13c). The tree itself is
 * `test/integration/commandsView/commands-view.test.ts`. */

const NONE: CommandsViewState = {
  hasProfiles: false,
  authorized: false,
  connected: false,
  running: false,
};

function group(
  roots: readonly CommandsNode[],
  id: CommandsGroupId,
): readonly CommandsEntryId[] {
  const node = roots.find((n) => n.kind === "group" && n.id === id);
  assert.ok(node?.kind === "group", `no ${id} group`);
  return node.entries;
}

function everyEntry(roots: readonly CommandsNode[]): CommandsEntryId[] {
  return roots.flatMap((n) => (n.kind === "group" ? [...n.entries] : [n.id]));
}

describe("the Commands view's model", () => {
  it("has three groups and then Show Log, in that order", () => {
    const roots = commandsViewRoots(NONE);
    assert.deepEqual(
      roots.map((n) => `${n.kind}:${n.id}`),
      [
        "group:connection",
        "group:run",
        "group:snippets",
        "entry:showOutputChannel",
      ],
    );
  });

  describe("the Connection group", () => {
    it("offers only Add Connection Profile when there is no profile", () => {
      assert.deepEqual(group(commandsViewRoots(NONE), "connection"), [
        "addProfile",
      ]);
    });

    it("offers Sign In and Connect while signed out", () => {
      const roots = commandsViewRoots({ ...NONE, hasProfiles: true });
      assert.deepEqual(group(roots, "connection"), [
        "signIn",
        "connect",
        "switchProfile",
        "addProfile",
      ]);
    });

    it("offers Connect, not Sign In, once signed in", () => {
      const roots = commandsViewRoots({
        ...NONE,
        hasProfiles: true,
        authorized: true,
      });
      assert.deepEqual(group(roots, "connection"), [
        "connect",
        "switchProfile",
        "addProfile",
      ]);
    });

    it("offers Disconnect, not Connect, once connected", () => {
      const roots = commandsViewRoots({
        ...NONE,
        hasProfiles: true,
        authorized: true,
        connected: true,
      });
      assert.deepEqual(group(roots, "connection"), [
        "disconnect",
        "switchProfile",
        "addProfile",
      ]);
    });
  });

  describe("the Run group", () => {
    it("offers no Cancel while nothing runs, even with no profile", () => {
      assert.deepEqual(group(commandsViewRoots(NONE), "run"), [
        "runFile",
        "openInteractiveWindow",
        "resetPythonState",
        "selectRunTarget",
        "refreshCasToken",
      ]);
    });

    it("offers Cancel while a run is going", () => {
      const roots = commandsViewRoots({ ...NONE, running: true });
      assert.deepEqual(group(roots, "run"), [
        "runFile",
        "openInteractiveWindow",
        "cancelRun",
        "resetPythonState",
        "selectRunTarget",
        "refreshCasToken",
      ]);
    });
  });

  it("always offers the snippets", () => {
    for (const connected of [false, true]) {
      const roots = commandsViewRoots({ ...NONE, connected });
      assert.deepEqual(group(roots, "snippets"), [
        "insertViyaSnippet",
        "insertCasConnectionSnippet",
        "insertCasSqlPassthroughSnippet",
      ]);
    }
  });

  it("names a contributed command for every entry it can show", () => {
    const manifest = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8"),
    ) as { contributes: { commands: { command: string }[] } };
    const contributed = new Set(
      manifest.contributes.commands.map((c) => c.command),
    );
    const shown = new Set([
      ...everyEntry(
        commandsViewRoots({
          hasProfiles: true,
          authorized: false,
          connected: false,
          running: true,
        }),
      ),
      ...everyEntry(
        commandsViewRoots({
          hasProfiles: true,
          authorized: true,
          connected: true,
          running: false,
        }),
      ),
    ]);
    assert.equal(shown.size, 15);
    for (const entry of shown) {
      assert.ok(
        contributed.has(commandFor(entry)),
        `${commandFor(entry)} is not in package.json`,
      );
    }
  });
});

/** The view reads `src/contextKeys.ts`'s mirror, which only sees a key set
 * through `setContextKey`. A registrar that went back to a raw `setContext`
 * would leave its part of the view stale with nothing else failing, so this
 * reads their source (13c review). */
describe("the Commands view's context keys", () => {
  const registrars: readonly { file: string; key: string }[] = [
    { file: "src/profile/commands.ts", key: "HAS_PROFILES_CONTEXT_KEY" },
    { file: "src/auth/authProvider.ts", key: "AUTHORIZED_CONTEXT_KEY" },
    { file: "src/compute/commands.ts", key: "CONNECTED_CONTEXT_KEY" },
    { file: "src/run/commands.ts", key: "RUNNING_CONTEXT_KEY" },
  ];
  const keyNames = [
    "pythonOnViya.hasProfiles",
    "pythonOnViya.authorized",
    "pythonOnViya.connected",
    "pythonOnViya.running",
  ];

  for (const { file, key } of registrars) {
    it(`${file} sets ${key} through setContextKey`, () => {
      const source = readFileSync(
        path.resolve(__dirname, "../../..", file),
        "utf8",
      );
      const rawKeys = [
        ...source.matchAll(
          /executeCommand\(\s*["']setContext["']\s*,\s*([^,\s]+)/g,
        ),
      ].map((m) => m[1] ?? "");
      for (const raw of rawKeys) {
        assert.ok(
          !registrars.some((r) => r.key === raw) &&
            !keyNames.some((k) => raw === `"${k}"` || raw === `'${k}'`),
          `${file} sets ${raw} with a raw setContext`,
        );
      }
      assert.match(
        source,
        key === "AUTHORIZED_CONTEXT_KEY"
          ? /\?\?\s*setContextKey;/
          : new RegExp(String.raw`setContextKey\(\s*${key}\b`),
        `${file} does not set ${key} through setContextKey`,
      );
    });
  }
});
