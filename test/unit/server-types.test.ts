// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { describeServerProblem } from "../../src/server/problems";
import {
  readServerItem,
  sortServerItems,
  type ServerItem,
} from "../../src/server/types";

/** The files API's properties shape (Findings 13.20 and 13.22): `path` is
 * the parent folder, and the root's `name` is empty. */

describe("readServerItem", () => {
  it("joins the parent path and the name", () => {
    const item = readServerItem({
      name: "x.py",
      path: "/tmp/probe",
      isDirectory: false,
      readOnly: false,
      size: 1024,
      modifiedTimeStamp: "2026-10-01T14:27:29.853Z",
      version: 1,
      links: [{ rel: "getFile", href: "/c/f/content", method: "GET" }],
    });
    assert.deepEqual(item, {
      name: "x.py",
      path: "/tmp/probe/x.py",
      isDirectory: false,
      readOnly: false,
      size: 1024,
      modifiedAt: Date.parse("2026-10-01T14:27:29.853Z"),
      links: [{ rel: "getFile", href: "/c/f/content", method: "GET" }],
    });
  });

  it("places a child of / directly under it", () => {
    assert.equal(
      readServerItem({ name: "tmp", path: "/", isDirectory: true })?.path,
      "/tmp",
    );
  });

  it("takes the root's path from the caller, since its name is empty", () => {
    const root = readServerItem(
      { name: "", path: "/", isDirectory: true, readOnly: true },
      "/",
    );
    assert.ok(root);
    assert.equal(root.path, "/");
    assert.equal(root.readOnly, true);
  });

  it("defaults what it cannot read rather than refusing the item", () => {
    const item = readServerItem({
      name: "a",
      path: "/",
      isDirectory: false,
      size: "1",
      modifiedTimeStamp: "not a date",
    });
    assert.ok(item);
    assert.equal(item.readOnly, false);
    assert.equal(item.size, undefined);
    assert.equal(item.modifiedAt, undefined);
    assert.deepEqual(item.links, []);
  });

  it("refuses what it cannot place", () => {
    for (const bad of [
      null,
      "x",
      { path: "/", isDirectory: true },
      { name: "a", path: "/", isDirectory: "yes" },
      { name: "a", isDirectory: true },
      { name: "", path: "/", isDirectory: true },
    ]) {
      assert.equal(readServerItem(bad), undefined, JSON.stringify(bad));
    }
  });
});

describe("sortServerItems", () => {
  const item = (name: string, isDirectory: boolean): ServerItem => ({
    name,
    path: `/${name}`,
    isDirectory,
    readOnly: false,
    size: undefined,
    modifiedAt: undefined,
    links: [],
  });

  it("puts folders first, then sorts each by name", () => {
    const sorted = sortServerItems([
      item("b.py", false),
      item("z", true),
      item("a.py", false),
      item("c", true),
    ]);
    assert.deepEqual(
      sorted.map((entry) => entry.name),
      ["c", "z", "a.py", "b.py"],
    );
  });
});

describe("describeServerProblem", () => {
  const error = { status: 404 };

  it("writes one log fragment per problem", () => {
    assert.equal(
      describeServerProblem({ code: "not-connected" }),
      "no active SAS Viya session for browsing the SAS server",
    );
    assert.equal(
      describeServerProblem({ code: "path-not-found", path: "/x", error }),
      '"/x" is not available on the SAS server (HTTP 404)',
    );
    assert.equal(
      describeServerProblem({
        code: "path-not-found",
        path: "/x",
        error,
        root: { setBy: "context" },
      }),
      '"/x" is not available on the SAS server (the root set by the context) (HTTP 404)',
    );
    assert.equal(
      describeServerProblem({
        code: "changed-on-server",
        path: "/x",
        error: { status: 412 },
      }),
      '"/x" changed on the SAS server since it was opened (HTTP 412)',
    );
    assert.equal(
      describeServerProblem({
        code: "too-large",
        path: "/x",
        size: 20,
        limitBytes: 10,
      }),
      '"/x" is 20 bytes, over the 10-byte editor limit',
    );
    assert.equal(
      describeServerProblem({ code: "no-version", path: "/x" }),
      '"/x" has no version tag to save against',
    );
    assert.equal(
      describeServerProblem({
        code: "wrong-kind",
        path: "/x",
        expected: "file",
      }),
      '"/x" is not a file',
    );
    assert.match(
      describeServerProblem({
        code: "compute",
        problem: { code: "link-missing", rel: "getFile", resource: "file" },
      }),
      /getFile/,
    );
  });
});
