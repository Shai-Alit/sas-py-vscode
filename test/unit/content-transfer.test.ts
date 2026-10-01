// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { ContentAdapter } from "../../src/content/adapter";
import {
  isDownloadable,
  isSafeLocalName,
  planDownload,
} from "../../src/content/transfer";
import { type ContentItem } from "../../src/content/types";
import {
  contentFail,
  contentOk,
  recordedContentClient,
  type RecordedContentRoute,
} from "../helpers/recorded-content";

/**
 * 13a's download planning against the real `ContentAdapter` — folder listings
 * come through the fake `ContentClient`, shaped as member records the way
 * finding 99 recorded them.
 */

const TOP = "/folders/folders/aaaa0000-0000-4000-8000-000000000001";
const SUB = "/folders/folders/aaaa0000-0000-4000-8000-000000000002";

function folderMember(name: string, uri: string): Record<string, unknown> {
  return {
    id: `m-${name}`,
    name,
    type: "child",
    contentType: "folder",
    uri,
    links: [{ rel: "members", href: `${uri}/members`, method: "GET" }],
  };
}

function fileMember(name: string, id: string): Record<string, unknown> {
  return {
    id: `m-${name}`,
    name,
    type: "child",
    contentType: "file",
    uri: `/files/files/${id}`,
    links: [],
  };
}

function listing(items: readonly Record<string, unknown>[]): unknown {
  return { count: items.length, items };
}

const topFolder: ContentItem = {
  id: "top",
  name: "Project",
  type: "child",
  contentType: "folder",
  uri: TOP,
  links: [{ rel: "members", href: `${TOP}/members`, method: "GET" }],
};

function adapterWith(routes: readonly RecordedContentRoute[]): {
  adapter: ContentAdapter;
  calls: { href: string; method: string }[];
} {
  const { client, calls } = recordedContentClient(routes);
  return { adapter: new ContentAdapter(client), calls };
}

describe("content/transfer", () => {
  describe("isSafeLocalName", () => {
    it("accepts ordinary file and folder names", () => {
      for (const name of ["model.py", "My Data", "a.b.c", "résumé.txt", "x"]) {
        assert.equal(isSafeLocalName(name), true, name);
      }
    });

    it("refuses separators, dot names and characters Windows forbids", () => {
      for (const name of [
        "",
        ".",
        "..",
        "a\\b",
        "a/b",
        "a:b",
        "a*b",
        "a?b",
        'a"b',
        "a<b",
        "a>b",
        "a|b",
        "tab\there",
      ]) {
        assert.equal(isSafeLocalName(name), false, JSON.stringify(name));
      }
    });

    it("refuses a trailing dot or space, which Windows strips", () => {
      assert.equal(isSafeLocalName("notes."), false);
      assert.equal(isSafeLocalName("notes "), false);
    });

    it("refuses Windows device names, with or without an extension, in any case", () => {
      for (const name of [
        "CON",
        "prn",
        "Aux.txt",
        "nul.py",
        "COM1",
        "lpt9.log",
        "COM¹",
        "lpt³.txt",
      ]) {
        assert.equal(isSafeLocalName(name), false, name);
      }
      assert.equal(isSafeLocalName("console.py"), true);
      assert.equal(isSafeLocalName("COM10"), true);
      assert.equal(isSafeLocalName("COM⁴"), true);
    });
  });

  describe("isDownloadable", () => {
    const base: ContentItem = {
      id: "m1",
      name: "x",
      type: "child",
      contentType: "file",
      uri: "/files/files/f1",
      links: [],
    };

    it("accepts a folder and a file with a resource address", () => {
      assert.equal(isDownloadable(topFolder), true);
      assert.equal(isDownloadable(base), true);
    });

    it("refuses a data flow, and a file with no resource address", () => {
      assert.equal(
        isDownloadable({
          ...base,
          contentType: "dataFlow",
          uri: "/dataFlows/dataFlows/x",
        }),
        false,
      );
      assert.equal(isDownloadable({ ...base, uri: undefined }), false);
    });
  });

  describe("planDownload", () => {
    it("plans a single file as one entry named after it, with no listing", async () => {
      const { adapter, calls } = adapterWith([]);
      const file: ContentItem = {
        id: "m1",
        name: "model.py",
        type: "child",
        contentType: "file",
        uri: "/files/files/f1",
        links: [],
      };
      const result = await planDownload(adapter, file);
      assert.ok(result.ok);
      assert.deepEqual(result.value, {
        folders: [],
        files: [{ path: ["model.py"], href: "/files/files/f1" }],
        skipped: [],
      });
      assert.equal(calls.length, 0);
    });

    it("walks a folder recursively, parents before children", async () => {
      const { adapter } = adapterWith([
        {
          when: `${TOP}/members`,
          reply: contentOk(
            listing([folderMember("data", SUB), fileMember("main.py", "f1")]),
          ),
        },
        {
          when: `${SUB}/members`,
          reply: contentOk(listing([fileMember("input.csv", "f2")])),
        },
      ]);
      const result = await planDownload(adapter, topFolder);
      assert.ok(result.ok);
      assert.deepEqual(result.value.folders, [
        ["Project"],
        ["Project", "data"],
      ]);
      assert.deepEqual(
        result.value.files.map((f) => ({ path: f.path, href: f.href })),
        [
          { path: ["Project", "data", "input.csv"], href: "/files/files/f2" },
          { path: ["Project", "main.py"], href: "/files/files/f1" },
        ],
      );
      assert.deepEqual(result.value.skipped, []);
    });

    it("skips a member that is not a file, such as a data flow", async () => {
      const { adapter } = adapterWith([
        {
          when: `${TOP}/members`,
          reply: contentOk(
            listing([
              {
                id: "m-flow",
                name: "etl.flw",
                type: "child",
                contentType: "dataFlow",
                uri: "/dataFlows/dataFlows/x",
                links: [],
              },
              fileMember("main.py", "f1"),
            ]),
          ),
        },
      ]);
      const result = await planDownload(adapter, topFolder);
      assert.ok(result.ok);
      assert.deepEqual(
        result.value.files.map((f) => f.path),
        [["Project", "main.py"]],
      );
      assert.deepEqual(result.value.skipped, [
        { path: ["Project", "etl.flw"], reason: "not-a-file" },
      ]);
    });

    it("skips a file member with no resource address", async () => {
      const { adapter } = adapterWith([]);
      const file: ContentItem = {
        id: "m1",
        name: "orphan.py",
        type: "child",
        contentType: "file",
        links: [],
      };
      const result = await planDownload(adapter, file);
      assert.ok(result.ok);
      assert.deepEqual(result.value.skipped, [
        { path: ["orphan.py"], reason: "not-a-file" },
      ]);
    });

    it("skips a member whose name cannot be a local file name, and does not descend into it", async () => {
      const { adapter, calls } = adapterWith([
        {
          when: `${TOP}/members`,
          reply: contentOk(
            listing([
              folderMember("..", SUB),
              fileMember("a\\b.py", "f1"),
              fileMember("ok.py", "f2"),
            ]),
          ),
        },
      ]);
      const result = await planDownload(adapter, topFolder);
      assert.ok(result.ok);
      assert.deepEqual(
        result.value.files.map((f) => f.path),
        [["Project", "ok.py"]],
      );
      assert.deepEqual(result.value.skipped, [
        { path: ["Project", ".."], reason: "unsafe-name" },
        { path: ["Project", "a\\b.py"], reason: "unsafe-name" },
      ]);
      assert.equal(
        calls.some((c) => c.href.startsWith(SUB)),
        false,
      );
    });

    it("skips a second sibling whose name differs only in case", async () => {
      const { adapter } = adapterWith([
        {
          when: `${TOP}/members`,
          reply: contentOk(
            listing([
              fileMember("Report.csv", "f1"),
              fileMember("report.csv", "f2"),
            ]),
          ),
        },
      ]);
      const result = await planDownload(adapter, topFolder);
      assert.ok(result.ok);
      assert.equal(result.value.files.length, 1);
      assert.equal(result.value.skipped.length, 1);
      assert.equal(result.value.skipped[0]?.reason, "duplicate-name");
    });

    it("plans nothing but a skip when the chosen item's own name is unsafe", async () => {
      const { adapter, calls } = adapterWith([]);
      const result = await planDownload(adapter, { ...topFolder, name: "CON" });
      assert.ok(result.ok);
      assert.deepEqual(result.value, {
        folders: [],
        files: [],
        skipped: [{ path: ["CON"], reason: "unsafe-name" }],
      });
      assert.equal(calls.length, 0);
    });

    it("lists a folder reached twice only once, and reports the second path", async () => {
      const { adapter, calls } = adapterWith([
        {
          when: `${TOP}/members`,
          reply: contentOk(
            listing([folderMember("a", SUB), folderMember("b", SUB)]),
          ),
        },
        {
          when: `${SUB}/members`,
          reply: contentOk(listing([fileMember("x.py", "f1")])),
        },
      ]);
      const result = await planDownload(adapter, topFolder);
      assert.ok(result.ok);
      assert.equal(
        calls.filter((c) => c.href.startsWith(`${SUB}/members`)).length,
        1,
      );
      assert.deepEqual(
        result.value.files.map((f) => f.path),
        [["Project", "a", "x.py"]],
      );
      assert.deepEqual(result.value.folders, [["Project"], ["Project", "a"]]);
      assert.deepEqual(result.value.skipped, [
        { path: ["Project", "b"], reason: "already-listed" },
      ]);
    });

    it("fails the whole plan when a folder listing fails", async () => {
      const { adapter } = adapterWith([
        {
          when: `${TOP}/members`,
          reply: contentOk(listing([folderMember("data", SUB)])),
        },
        {
          when: `${SUB}/members`,
          reply: contentFail({ code: "forbidden", error: { status: 403 } }),
        },
      ]);
      const result = await planDownload(adapter, topFolder);
      assert.ok(!result.ok);
      assert.equal(result.problem.code, "forbidden");
    });
  });
});
