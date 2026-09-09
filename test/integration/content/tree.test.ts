// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import { type ContentAdapter } from "../../../src/content/adapter";
import { type ContentResult } from "../../../src/content/client";
import { SasContentTreeProvider } from "../../../src/content/contentTree";
import { SAS_CONTENT_ROOT, type ContentItem } from "../../../src/content/types";

/**
 * `SasContentTreeProvider`'s mapping of a `ContentItem` onto a real
 * `vscode.TreeItem`, and its never-throw contract on `getChildren`. Runs in the
 * extension host because it constructs `vscode.TreeItem` / `vscode.ThemeIcon`;
 * the decisions behind the mapping are unit-tested in
 * `test/unit/content-presentation.test.ts`.
 */

function fakeLog(): {
  channel: vscode.LogOutputChannel;
  errors: string[];
} {
  const errors: string[] = [];
  const channel = {
    error: (message: string) => errors.push(message),
    // The provider only calls `.error`; the rest are unused no-ops.
    info: () => undefined,
    warn: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    append: () => undefined,
    appendLine: () => undefined,
  } as unknown as vscode.LogOutputChannel;
  return { channel, errors };
}

function item(over: Partial<ContentItem>): ContentItem {
  return { id: "id-1", name: "name", links: [], ...over };
}

function okResult(
  items: readonly ContentItem[],
): ContentResult<readonly ContentItem[]> {
  return { ok: true, value: items };
}

function adapterReturning(
  roots: ContentResult<readonly ContentItem[]>,
  children: ContentResult<readonly ContentItem[]> = okResult([]),
): ContentAdapter {
  // The provider only calls these two methods.
  return {
    getRootItems: () => Promise.resolve(roots),
    getChildItems: () => Promise.resolve(children),
  } as unknown as ContentAdapter;
}

describe("SasContentTreeProvider", () => {
  it("maps a folder to a collapsible TreeItem with a themed icon and stable id", () => {
    const { channel } = fakeLog();
    const provider = new SasContentTreeProvider(
      () => adapterReturning(okResult([])),
      channel,
    );
    const node = provider.getTreeItem(
      item({ id: "folder-9", name: "reports", type: "folder" }),
    );
    assert.equal(node.label, "reports");
    assert.equal(
      node.collapsibleState,
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    assert.ok(node.iconPath instanceof vscode.ThemeIcon);
    assert.equal(node.contextValue, "sasContent:folder");
    assert.equal(node.id, "folder-9");
    provider.dispose();
  });

  it("maps a file member to a non-collapsible leaf that opens via sasContent:", () => {
    const { channel } = fakeLog();
    const provider = new SasContentTreeProvider(
      () => adapterReturning(okResult([])),
      channel,
    );
    const node = provider.getTreeItem(
      item({
        id: "f",
        name: "a.py",
        type: "child",
        contentType: "file",
        uri: "/files/files/eeeeeeee-0000-4000-8000-000000000001",
      }),
    );
    assert.equal(node.collapsibleState, vscode.TreeItemCollapsibleState.None);
    assert.equal(node.contextValue, "sasContent:file");
    assert.ok(node.command);
    assert.equal(node.command.command, "vscode.open");
    const openArg: unknown = (node.command.arguments ?? [])[0];
    assert.ok(openArg instanceof vscode.Uri);
    assert.equal(
      openArg.toString(true),
      "sasContent:/a.py?id=/files/files/eeeeeeee-0000-4000-8000-000000000001",
    );
    assert.ok(node.resourceUri instanceof vscode.Uri);
    assert.equal(node.resourceUri.scheme, "sasContent");
    provider.dispose();
  });

  it("leaves a file member with no resolvable href inert", () => {
    const { channel } = fakeLog();
    const provider = new SasContentTreeProvider(
      () => adapterReturning(okResult([])),
      channel,
    );
    const node = provider.getTreeItem(
      item({ id: "f", name: "a.py", type: "child", contentType: "file" }),
    );
    assert.equal(node.command, undefined);
    assert.equal(node.resourceUri, undefined);
    provider.dispose();
  });

  it("returns nothing when there is no adapter", async () => {
    const { channel } = fakeLog();
    const provider = new SasContentTreeProvider(() => undefined, channel);
    assert.deepEqual(await provider.getChildren(), []);
    provider.dispose();
  });

  it("returns the adapter's root items", async () => {
    const { channel } = fakeLog();
    const roots = [
      SAS_CONTENT_ROOT,
      item({ id: "d", name: "My Folder", type: "myFolder" }),
    ];
    const provider = new SasContentTreeProvider(
      () => adapterReturning(okResult(roots)),
      channel,
    );
    const children = await provider.getChildren();
    assert.deepEqual(
      children.map((c) => c.name),
      ["SAS Content", "My Folder"],
    );
    provider.dispose();
  });

  it("logs and returns [] when a listing fails, never throwing", async () => {
    const { channel, errors } = fakeLog();
    const provider = new SasContentTreeProvider(
      () =>
        adapterReturning({
          ok: false,
          reason: "boom",
          problem: {
            code: "link-missing",
            rel: "members",
            resource: 'folder "x"',
          },
        }),
      channel,
    );
    const children = await provider.getChildren();
    assert.deepEqual(children, []);
    assert.equal(errors.length, 1);
    assert.match(errors[0] ?? "", /SAS Content:/);
    provider.dispose();
  });
});
