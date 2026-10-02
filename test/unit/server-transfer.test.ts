// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  type CallOptions,
  type MemberListing,
  type ServerResult,
} from "../../src/server/adapter";
import {
  MAX_SERVER_DOWNLOAD_DEPTH,
  planServerDownload,
  type ServerListingAdapter,
} from "../../src/server/transfer";
import { type ServerItem } from "../../src/server/types";

/**
 * A SAS Server download plan, through 13a's planner over the server's tree.
 * The listings are stubbed at the adapter's `getChildren`, which
 * `server-adapter.test.ts` covers against the wire.
 */

function item(path: string, isDirectory: boolean): ServerItem {
  return {
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
    isDirectory,
    readOnly: false,
    size: isDirectory ? 4096 : 3,
    modifiedAt: undefined,
    links: [],
  };
}

/** An adapter listing `tree[path]` for each folder, recording what it was
 * asked for and with which options. */
function lister(
  tree: Record<string, readonly ServerItem[] | ServerResult<MemberListing>>,
): ServerListingAdapter & {
  listed: string[];
  options: (CallOptions | undefined)[];
} {
  const listed: string[] = [];
  const options: (CallOptions | undefined)[] = [];
  return {
    listed,
    options,
    getChildren: (folder, callOptions) => {
      listed.push(folder.path);
      options.push(callOptions);
      const entry = tree[folder.path];
      if (entry === undefined) {
        return Promise.reject(new Error(`unexpected listing ${folder.path}`));
      }
      return Promise.resolve(
        Array.isArray(entry)
          ? { ok: true, value: { items: entry, truncated: false } }
          : (entry as ServerResult<MemberListing>),
      );
    },
  };
}

describe("planServerDownload", () => {
  it("plans a file as itself, with no listing", async () => {
    const file = item("/tmp/a.py", false);
    const adapter = lister({});
    const plan = await planServerDownload(adapter, file);
    assert.ok(plan.ok);
    assert.deepEqual(plan.value, {
      folders: [],
      files: [{ path: ["a.py"], source: file }],
      skipped: [],
    });
    assert.deepEqual(adapter.listed, []);
  });

  it("walks a folder, parents first, reading each file from its own item", async () => {
    const data = item("/tmp/p/data", true);
    const main = item("/tmp/p/main.py", false);
    const input = item("/tmp/p/data/in.csv", false);
    const adapter = lister({
      "/tmp/p": [data, main],
      "/tmp/p/data": [input],
    });
    const signal = new AbortController().signal;
    const plan = await planServerDownload(
      adapter,
      item("/tmp/p", true),
      signal,
    );
    assert.ok(plan.ok);
    assert.deepEqual(plan.value.folders, [["p"], ["p", "data"]]);
    assert.deepEqual(plan.value.files, [
      { path: ["p", "data", "in.csv"], source: input },
      { path: ["p", "main.py"], source: main },
    ]);
    assert.deepEqual(plan.value.skipped, []);
    assert.deepEqual(adapter.options, [{ signal }, { signal }]);
  });

  it("passes no signal when given none", async () => {
    const adapter = lister({ "/tmp/p": [] });
    const plan = await planServerDownload(adapter, item("/tmp/p", true));
    assert.ok(plan.ok);
    assert.deepEqual(adapter.options, [{}]);
  });

  it("leaves out a folder deeper than MAX_SERVER_DOWNLOAD_DEPTH, without listing it", async () => {
    const tree: Record<string, readonly ServerItem[]> = {};
    let path = "/l";
    for (let depth = 1; depth <= MAX_SERVER_DOWNLOAD_DEPTH; depth++) {
      tree[path] = [item(`${path}/l`, true)];
      path = `${path}/l`;
    }
    const adapter = lister(tree);
    const plan = await planServerDownload(adapter, item("/l", true));
    assert.ok(plan.ok);
    assert.equal(plan.value.folders.length, MAX_SERVER_DOWNLOAD_DEPTH);
    assert.equal(adapter.listed.length, MAX_SERVER_DOWNLOAD_DEPTH);
    assert.equal(plan.value.skipped.length, 1);
    const [skip] = plan.value.skipped;
    assert.equal(skip?.reason, "too-deep");
    assert.equal(skip.path.length, MAX_SERVER_DOWNLOAD_DEPTH + 1);
  });

  it("leaves out a name this computer cannot hold, and a second whose name differs only in case", async () => {
    const adapter = lister({
      "/tmp/p": [
        item("/tmp/p/a:b.txt", false),
        item("/tmp/p/Readme", false),
        item("/tmp/p/README", false),
      ],
    });
    const plan = await planServerDownload(adapter, item("/tmp/p", true));
    assert.ok(plan.ok);
    assert.deepEqual(
      plan.value.files.map((file) => file.path),
      [["p", "Readme"]],
    );
    assert.deepEqual(plan.value.skipped, [
      { path: ["p", "a:b.txt"], reason: "unsafe-name" },
      { path: ["p", "README"], reason: "duplicate-name" },
    ]);
  });

  it("downloads what a cut-short listing returned and reports the folder as listed only in part", async () => {
    const sub = item("/tmp/p/sub", true);
    const main = item("/tmp/p/main.py", false);
    const inner = item("/tmp/p/sub/in.csv", false);
    const listings: Record<string, MemberListing> = {
      "/tmp/p": { items: [sub, main], truncated: true },
      "/tmp/p/sub": { items: [inner], truncated: false },
    };
    const adapter = lister(
      Object.fromEntries(
        Object.entries(listings).map(([path, value]) => [
          path,
          { ok: true, value },
        ]),
      ),
    );
    const plan = await planServerDownload(adapter, item("/tmp/p", true));
    assert.ok(plan.ok);
    assert.deepEqual(
      plan.value.files.map((file) => file.path),
      [
        ["p", "sub", "in.csv"],
        ["p", "main.py"],
      ],
    );
    assert.deepEqual(plan.value.skipped, [
      { path: ["p"], reason: "listing-truncated" },
    ]);
  });

  it("fails the whole plan when a listing fails", async () => {
    const failure: ServerResult<MemberListing> = {
      ok: false,
      reason: "gone",
      problem: { code: "not-connected" },
    };
    const adapter = lister({ "/tmp/p": failure });
    const plan = await planServerDownload(adapter, item("/tmp/p", true));
    assert.deepEqual(plan, failure);
  });
});
