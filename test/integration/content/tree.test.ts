// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import * as vscode from "vscode";

import { type ContentAdapter } from "../../../src/content/adapter";
import { type ContentResult } from "../../../src/content/client";
import { SasContentTreeProvider } from "../../../src/content/contentTree";
import { SAS_CONTENT_ROOT, type ContentItem } from "../../../src/content/types";
import { parseContentUri } from "../../../src/content/uri";

/**
 * `SasContentTreeProvider`'s mapping of a `ContentItem` onto a real
 * `vscode.TreeItem`, and its never-throw contract on `getChildren`. Runs in the
 * extension host because it constructs `vscode.TreeItem` / `vscode.ThemeIcon`;
 * the decisions behind the mapping are unit-tested in
 * `test/unit/content-presentation.test.ts`.
 */

const ENDPOINT = "https://viya.example.com";

function fakeLog(): { channel: vscode.LogOutputChannel; errors: string[] } {
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
  parent: ContentResult<ContentItem | undefined> = {
    ok: true,
    value: undefined,
  },
): ContentAdapter {
  // The provider calls these three.
  return {
    getRootItems: () => Promise.resolve(roots),
    getChildItems: () => Promise.resolve(children),
    getParentOfItem: () => Promise.resolve(parent),
  } as unknown as ContentAdapter;
}

function makeProvider(
  adapter: () => ContentAdapter | undefined,
  // `null` means "no active deployment" — distinct from omitted, which defaults
  // to ENDPOINT. Passing `undefined` cannot express the former: it re-triggers
  // the default.
  endpoint: string | null = ENDPOINT,
): { provider: SasContentTreeProvider; errors: string[] } {
  const { channel, errors } = fakeLog();
  const provider = new SasContentTreeProvider(
    adapter,
    () => endpoint ?? undefined,
    channel,
  );
  return { provider, errors };
}

describe("SasContentTreeProvider", () => {
  it("maps a folder to a collapsible TreeItem with a themed icon and stable id", () => {
    const { provider } = makeProvider(() => adapterReturning(okResult([])));
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

  it("maps a file member to a leaf that opens via sasContent:, carrying the deployment", () => {
    const { provider } = makeProvider(() => adapterReturning(okResult([])));
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
    assert.equal(openArg.scheme, "sasContent");
    assert.equal(openArg.path, "/a.py");
    // vscode-uri percent-decodes `query` on parse, so this is exactly what the
    // FileSystemProvider reads back: the file href and the deployment root.
    assert.deepEqual(parseContentUri(openArg.query), {
      resourceHref: "/files/files/eeeeeeee-0000-4000-8000-000000000001",
      deploymentRoot: ENDPOINT,
    });
    assert.ok(node.resourceUri instanceof vscode.Uri);
    assert.equal(node.resourceUri.toString(), openArg.toString());
    provider.dispose();
  });

  it("opens a recycled file leaf under the read-only sasContentReadOnly scheme (6d-ii)", () => {
    const { provider } = makeProvider(() => adapterReturning(okResult([])));
    const node = provider.getTreeItem(
      item({
        id: "f",
        name: "scratch.py",
        type: "child",
        contentType: "file",
        uri: "/files/files/eeeeeeee-0000-4000-8000-000000000002",
        inRecycleBin: true,
      }),
    );
    assert.ok(node.command);
    assert.equal(node.command.command, "vscode.open");
    const openArg: unknown = (node.command.arguments ?? [])[0];
    assert.ok(openArg instanceof vscode.Uri);
    assert.equal(openArg.scheme, "sasContentReadOnly");
    // the query still round-trips the same way the editable scheme does
    assert.deepEqual(parseContentUri(openArg.query), {
      resourceHref: "/files/files/eeeeeeee-0000-4000-8000-000000000002",
      deploymentRoot: ENDPOINT,
    });
    assert.equal(node.resourceUri?.toString(), openArg.toString());
    provider.dispose();
  });

  it("leaves a file member with no resolvable href inert", () => {
    const { provider } = makeProvider(() => adapterReturning(okResult([])));
    const node = provider.getTreeItem(
      item({ id: "f", name: "a.py", type: "child", contentType: "file" }),
    );
    assert.equal(node.command, undefined);
    assert.equal(node.resourceUri, undefined);
    provider.dispose();
  });

  it("leaves a file leaf inert when there is no active deployment", () => {
    const { provider } = makeProvider(
      () => adapterReturning(okResult([])),
      null,
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
    assert.equal(node.command, undefined);
    assert.equal(node.resourceUri, undefined);
    provider.dispose();
  });

  it("returns nothing when there is no adapter", async () => {
    const { provider } = makeProvider(() => undefined);
    assert.deepEqual(await provider.getChildren(), []);
    provider.dispose();
  });

  it("returns the adapter's root items", async () => {
    const roots = [
      SAS_CONTENT_ROOT,
      item({ id: "d", name: "My Folder", type: "myFolder" }),
    ];
    const { provider } = makeProvider(() => adapterReturning(okResult(roots)));
    const children = await provider.getChildren();
    assert.deepEqual(
      children.map((c) => c.name),
      ["SAS Content", "My Folder"],
    );
    provider.dispose();
  });

  it("logs and returns [] when a listing fails, never throwing", async () => {
    const { provider, errors } = makeProvider(() =>
      adapterReturning({
        ok: false,
        reason: "boom",
        problem: {
          code: "link-missing",
          rel: "members",
          resource: 'folder "x"',
        },
      }),
    );
    const children = await provider.getChildren();
    assert.deepEqual(children, []);
    assert.equal(errors.length, 1);
    assert.match(errors[0] ?? "", /SAS Content:/);
    provider.dispose();
  });

  describe("getParent (6c-iii)", () => {
    it("has no parent for the synthetic root or a delegate, without asking the adapter", async () => {
      let asked = 0;
      const adapter = {
        getParentOfItem: () => {
          asked += 1;
          return Promise.resolve({ ok: true, value: undefined });
        },
      } as unknown as ContentAdapter;
      const { provider } = makeProvider(() => adapter);

      assert.equal(await provider.getParent(SAS_CONTENT_ROOT), undefined);
      assert.equal(
        await provider.getParent(
          item({ id: "d", name: "My Folder", type: "myFolder" }),
        ),
        undefined,
      );
      assert.equal(asked, 0);
      provider.dispose();
    });

    it("returns the adapter's parent for a member item, on a bounded request", async () => {
      const parentFolder = item({ id: "p", name: "reports", type: "folder" });
      let sawSignal: unknown;
      const adapter = {
        getParentOfItem: (_item: ContentItem, signal?: AbortSignal) => {
          sawSignal = signal;
          return Promise.resolve({ ok: true, value: parentFolder });
        },
      } as unknown as ContentAdapter;
      const { provider } = makeProvider(() => adapter);
      const got = await provider.getParent(
        item({ id: "m", name: "a.py", type: "child", contentType: "file" }),
      );
      assert.equal(got, parentFolder);
      // getParent has no CancellationToken to thread, so it supplies its own
      // timeout signal rather than leaving the fetch on the client default.
      assert.ok(sawSignal instanceof AbortSignal);
      provider.dispose();
    });

    it("maps a root-listing folder with no ancestors back to the synthetic root", async () => {
      const { provider } = makeProvider(() =>
        adapterReturning(okResult([]), okResult([]), {
          ok: true,
          value: undefined,
        }),
      );
      const got = await provider.getParent(
        item({ id: "top", name: "Products", type: "folder" }),
      );
      assert.equal(got, SAS_CONTENT_ROOT);
      provider.dispose();
    });

    it("returns undefined for a member with no ancestors (rather than the root)", async () => {
      const { provider } = makeProvider(() =>
        adapterReturning(okResult([]), okResult([]), {
          ok: true,
          value: undefined,
        }),
      );
      const got = await provider.getParent(
        item({ id: "m", name: "a.py", type: "child", contentType: "file" }),
      );
      assert.equal(got, undefined);
      provider.dispose();
    });

    it("logs and returns undefined when the adapter fails", async () => {
      const { provider, errors } = makeProvider(() =>
        adapterReturning(okResult([]), okResult([]), {
          ok: false,
          reason: "boom",
          problem: { code: "content-unreachable", detail: "ETIMEDOUT" },
        }),
      );
      const got = await provider.getParent(
        item({ id: "m", name: "a.py", type: "child" }),
      );
      assert.equal(got, undefined);
      assert.equal(errors.length, 1);
      assert.match(errors[0] ?? "", /SAS Content:/);
      provider.dispose();
    });

    it("returns undefined when there is no adapter", async () => {
      const { provider } = makeProvider(() => undefined);
      assert.equal(
        await provider.getParent(
          item({ id: "m", name: "a.py", type: "child" }),
        ),
        undefined,
      );
      provider.dispose();
    });
  });
});
