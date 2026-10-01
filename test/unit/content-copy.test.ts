// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import { ContentAdapter } from "../../src/content/adapter";
import { type ContentRequest } from "../../src/content/client";
import {
  copyItem,
  copyObjection,
  freeCopyName,
  isCopyable,
} from "../../src/content/copy";
import { type ContentProblem } from "../../src/content/problems";
import { SAS_CONTENT_ROOT, type ContentItem } from "../../src/content/types";
import {
  contentFail,
  contentOk,
  recordedContentClient,
} from "../helpers/recorded-content";

/**
 * 13b's copy against the real `ContentAdapter`, with a small scripted
 * Folders/Files service behind the fake `ContentClient`: member listings as
 * finding 99 recorded them, folder create as finding 6.3, and the file copy
 * as Finding 13.9 (`GET` the file for its `copyFile` link, `POST` it with
 * `?parentFolderUri=` and a `Content-Disposition`).
 */

const TARGET = "/folders/folders/tttt0000-0000-4000-8000-000000000001";
const TOP = "/folders/folders/aaaa0000-0000-4000-8000-000000000001";
const LIB = "/folders/folders/aaaa0000-0000-4000-8000-000000000002";

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

function flowMember(name: string): Record<string, unknown> {
  return {
    id: `m-${name}`,
    name,
    type: "child",
    contentType: "dataFlow",
    uri: `/dataFlows/dataFlows/${name}`,
    links: [],
  };
}

function asItem(raw: Record<string, unknown>): ContentItem {
  return raw as unknown as ContentItem;
}

const target: ContentItem = {
  id: "t",
  name: "Dest",
  type: "child",
  contentType: "folder",
  uri: TARGET,
  links: [
    { rel: "members", href: `${TARGET}/members`, method: "GET" },
    {
      rel: "createChild",
      href: `/folders/folders?parentFolderUri=${TARGET}`,
      method: "POST",
    },
  ],
};

const project = asItem(folderMember("Project", TOP));
const model = asItem(fileMember("model.py", "f-model"));

interface Copied {
  readonly from: string;
  readonly parent: string;
  readonly disposition: string | undefined;
}

interface Made {
  readonly name: string;
  readonly parent: string;
}

/** Another paste winning the race for a name in the target: the first
 * create or copy into the target under `name` fails with `problem`, and,
 * unless `taken` is false, the target's listing holds `member` from then
 * on. */
interface Race {
  readonly name: string;
  readonly member: Record<string, unknown>;
  readonly problem: ContentProblem;
  readonly taken?: false;
}

/** The scripted services. `listings` maps a folder href to its members;
 * every other option injects a failure or a hook at one call. */
function service(
  listings: Record<string, readonly Record<string, unknown>[]>,
  opts: {
    failListing?: string;
    failCreate?: string;
    failCopy?: string;
    race?: Race;
    /** Every listing of the target after the first fails. */
    failRelisting?: true;
    onList?: (folder: string) => void;
    onCopied?: (from: string) => void;
    onReadFile?: () => void;
  } = {},
) {
  const copies: Copied[] = [];
  const made: Made[] = [];
  let next = 0;
  let targetListings = 0;
  let raced = false;
  const aborted = (request: ContentRequest) =>
    request.signal?.aborted === true
      ? contentFail({ code: "content-unreachable", detail: "aborted" })
      : undefined;
  const lose = (name: string, parent: string) => {
    const race = opts.race;
    if (raced || race === undefined) return undefined;
    if (parent !== TARGET || name !== race.name) return undefined;
    raced = true;
    if (race.taken !== false) {
      listings[TARGET] = [...(listings[TARGET] ?? []), race.member];
    }
    return contentFail(race.problem);
  };

  const { client, calls } = recordedContentClient([
    {
      when: (href, method) => method === "GET" && href.includes("/members"),
      reply: (request) => {
        const folder = request.link.href.split("/members")[0] ?? "";
        opts.onList?.(folder);
        if (folder === TARGET) targetListings += 1;
        if (
          folder === opts.failListing ||
          (folder === TARGET &&
            targetListings > 1 &&
            opts.failRelisting === true)
        ) {
          return contentFail({
            code: "content-rejected",
            error: { status: 500 },
          });
        }
        const items = listings[folder] ?? [];
        return aborted(request) ?? contentOk({ count: items.length, items });
      },
    },
    {
      when: (href, method) =>
        method === "POST" && href.startsWith("/folders/folders?"),
      reply: (request) => {
        const blocked = aborted(request);
        if (blocked !== undefined) return blocked;
        const name = (request.jsonBody as { name: string }).name;
        const parent = request.link.href.split("parentFolderUri=")[1] ?? "";
        const lost = lose(name, parent);
        if (lost !== undefined) return lost;
        if (name === opts.failCreate) {
          return contentFail({
            code: "content-rejected",
            error: { status: 403 },
          });
        }
        made.push({ name, parent });
        next += 1;
        const href = `/folders/folders/new-${String(next)}`;
        return contentOk(
          {
            id: `new-${String(next)}`,
            name,
            type: "folder",
            links: [
              { rel: "self", href, method: "GET" },
              {
                rel: "createChild",
                href: `/folders/folders?parentFolderUri=${href}`,
                method: "POST",
              },
              { rel: "members", href: `${href}/members`, method: "GET" },
            ],
          },
          { status: 201 },
        );
      },
    },
    {
      when: (href, method) =>
        method === "GET" && /^\/files\/files\/[^/]+$/.test(href),
      reply: (request) => {
        opts.onReadFile?.();
        const href = request.link.href;
        return contentOk({
          id: href.slice(href.lastIndexOf("/") + 1),
          name: "stored-name",
          links: [
            { rel: "self", href, method: "GET" },
            {
              rel: "copyFile",
              href: `${href}/copy`,
              method: "POST",
              responseType: "application/vnd.sas.file",
            },
          ],
        });
      },
    },
    {
      when: (href, method) => method === "POST" && href.includes("/copy?"),
      reply: (request) => {
        const blocked = aborted(request);
        if (blocked !== undefined) return blocked;
        const [path, query] = request.link.href.split("?");
        const from = (path ?? "").replace(/\/copy$/, "");
        const lost = lose(
          sentName(request.contentDisposition),
          (query ?? "").replace("parentFolderUri=", ""),
        );
        if (lost !== undefined) return lost;
        if (from === opts.failCopy) {
          return contentFail({
            code: "content-rejected",
            error: { status: 409, message: "already exists" },
          });
        }
        copies.push({
          from,
          parent: (query ?? "").replace("parentFolderUri=", ""),
          disposition: request.contentDisposition,
        });
        opts.onCopied?.(from);
        next += 1;
        return contentOk(
          {
            id: `c-${String(next)}`,
            name: "x",
            links: [
              {
                rel: "self",
                href: `/files/files/c-${String(next)}`,
                method: "GET",
              },
            ],
          },
          { status: 201 },
        );
      },
    },
  ]);
  return {
    adapter: new ContentAdapter(client),
    calls,
    copies,
    made,
    targetListings: () => targetListings,
  };
}

/** The Project tree most folder tests copy: two files, a data flow, a
 * folder member that points back at Project itself, and a sub-folder with
 * one file. */
function projectTree(): Record<string, readonly Record<string, unknown>[]> {
  return {
    [TARGET]: [],
    [TOP]: [
      fileMember("a.py", "f-a"),
      fileMember("b.csv", "f-b"),
      flowMember("flow"),
      folderMember("shortcut", TOP),
      folderMember("lib", LIB),
    ],
    [LIB]: [fileMember("c.py", "f-c")],
  };
}

function sentName(disposition: string | undefined): string {
  return decodeURIComponent(
    (disposition ?? "").replace("filename*=UTF-8''", ""),
  );
}

describe("content/copy", () => {
  describe("freeCopyName", () => {
    it("keeps a name nothing in the folder has", () => {
      assert.equal(freeCopyName("model.py", false, ["other.py"]), "model.py");
    });

    it("takes the first free _Copy{n} before the extension", () => {
      assert.equal(
        freeCopyName("model.py", false, ["model.py"]),
        "model_Copy1.py",
      );
      assert.equal(
        freeCopyName("model.py", false, [
          "model.py",
          "model_Copy1.py",
          "model_Copy3.py",
        ]),
        "model_Copy2.py",
      );
    });

    it("compares names ignoring case", () => {
      assert.equal(
        freeCopyName("model.py", false, ["MODEL.PY", "Model_copy1.py"]),
        "model_Copy2.py",
      );
    });

    it("does not split a folder's name, a dot file, or a name with no dot", () => {
      assert.equal(freeCopyName("v1.2", true, ["v1.2"]), "v1.2_Copy1");
      assert.equal(freeCopyName(".env", false, [".env"]), ".env_Copy1");
      assert.equal(freeCopyName("README", false, ["README"]), "README_Copy1");
      assert.equal(freeCopyName("a.b.py", false, ["a.b.py"]), "a.b_Copy1.py");
    });
  });

  describe("isCopyable", () => {
    it("allows a folder and a file with an address, and nothing else", () => {
      assert.equal(isCopyable(project), true);
      assert.equal(isCopyable(model), true);
      assert.equal(isCopyable(asItem(flowMember("flow"))), false);
      assert.equal(isCopyable({ ...model, uri: undefined }), false);
    });
  });

  describe("copyObjection", () => {
    it("allows a paste into another folder, the item's own folder, or itself", () => {
      assert.equal(copyObjection(model, target), undefined);
      assert.equal(
        copyObjection({ ...model, parentFolderUri: TARGET }, target),
        undefined,
      );
      assert.equal(copyObjection(project, project), undefined);
    });

    it("refuses what is not an ordinary member", () => {
      assert.equal(
        copyObjection({ ...project, type: "folder" }, target),
        "not-a-member",
      );
    });

    it("refuses the Recycle Bin on either side", () => {
      assert.equal(
        copyObjection({ ...model, inRecycleBin: true }, target),
        "in-recycle-bin",
      );
      assert.equal(
        copyObjection(model, { ...target, inRecycleBin: true }),
        "in-recycle-bin",
      );
    });

    it("refuses a data flow", () => {
      assert.equal(
        copyObjection(asItem(flowMember("flow")), target),
        "not-copyable",
      );
    });

    it("refuses a target that cannot take members", () => {
      assert.equal(copyObjection(project, model), "target-not-a-folder");
      assert.equal(
        copyObjection(project, SAS_CONTENT_ROOT),
        "target-not-a-folder",
      );
      assert.equal(
        copyObjection(project, {
          id: "bin",
          name: "Recycle Bin",
          type: "trashFolder",
          links: [],
        }),
        "target-not-a-folder",
      );
    });
  });

  describe("copyItem", () => {
    it("copies a file under its own name when the folder has none like it", async () => {
      const { adapter, copies } = service({ [TARGET]: [] });
      const seen: string[] = [];
      const outcome = await copyItem(
        adapter,
        model,
        target,
        new AbortController().signal,
        (path, index, total) => {
          seen.push(`${path.join("/")} ${String(index)}/${String(total)}`);
        },
      );
      assert.equal(outcome.name, "model.py");
      assert.equal(outcome.copied, 1);
      assert.equal(outcome.total, 1);
      assert.equal(outcome.cancelled, false);
      assert.equal(outcome.stopped, undefined);
      assert.match(outcome.copyHref ?? "", /^\/files\/files\/c-/);
      assert.deepEqual(seen, ["model.py 0/1"]);
      const [only, ...rest] = copies;
      assert.ok(only);
      assert.deepEqual(rest, []);
      assert.equal(only.from, "/files/files/f-model");
      assert.equal(only.parent, TARGET);
      assert.equal(sentName(only.disposition), "model.py");
    });

    it("copies a file under a free name when its own is taken", async () => {
      const { adapter, copies } = service({
        [TARGET]: [fileMember("model.py", "f-other")],
      });
      const outcome = await copyItem(
        adapter,
        model,
        target,
        new AbortController().signal,
      );
      assert.equal(outcome.name, "model_Copy1.py");
      assert.equal(sentName(copies[0]?.disposition), "model_Copy1.py");
    });

    it("reports a file the service would not copy, without stopping", async () => {
      const { adapter } = service(
        { [TARGET]: [] },
        { failCopy: "/files/files/f-model" },
      );
      const outcome = await copyItem(
        adapter,
        model,
        target,
        new AbortController().signal,
      );
      assert.equal(outcome.copied, 0);
      assert.equal(outcome.copyHref, undefined);
      assert.equal(outcome.stopped, undefined);
      assert.deepEqual(
        outcome.failures.map((f) => f.path),
        [["model.py"]],
      );
    });

    it("stops before anything when the target folder cannot be listed", async () => {
      const { adapter, calls } = service({}, { failListing: TARGET });
      const outcome = await copyItem(
        adapter,
        project,
        target,
        new AbortController().signal,
      );
      assert.deepEqual(outcome.stopped?.path, ["Project"]);
      assert.equal(outcome.copyHref, undefined);
      assert.equal(outcome.total, 0);
      assert.equal(calls.length, 1);
    });

    it("copies a folder tree, leaving out a data flow and a folder already listed", async () => {
      const { adapter, copies, made } = service(projectTree());
      const seen: string[] = [];
      const outcome = await copyItem(
        adapter,
        project,
        target,
        new AbortController().signal,
        (path, index, total) => {
          seen.push(`${path.join("/")} ${String(index)}/${String(total)}`);
        },
      );
      assert.equal(outcome.name, "Project");
      assert.equal(outcome.copyHref, "/folders/folders/new-1");
      assert.equal(outcome.total, 3);
      assert.equal(outcome.copied, 3);
      assert.equal(outcome.cancelled, false);
      assert.deepEqual(made, [
        { name: "Project", parent: TARGET },
        { name: "lib", parent: "/folders/folders/new-1" },
      ]);
      // The new lib folder is made after Project's own two files are copied.
      const lib = "/folders/folders/new-4";
      assert.deepEqual(
        copies.map((c) => [c.from, c.parent, sentName(c.disposition)]),
        [
          ["/files/files/f-a", "/folders/folders/new-1", "a.py"],
          ["/files/files/f-b", "/folders/folders/new-1", "b.csv"],
          ["/files/files/f-c", lib, "c.py"],
        ],
      );
      assert.deepEqual(seen, [
        "Project/a.py 0/3",
        "Project/b.csv 1/3",
        "Project/lib/c.py 2/3",
      ]);
      // The listing puts folders first, so the shortcut is reached first.
      assert.deepEqual(outcome.skipped, [
        { path: ["Project", "shortcut"], reason: "already-listed" },
        { path: ["Project", "flow"], reason: "not-a-file" },
      ]);
    });

    it("names a folder copy with _Copy{n} without splitting it", async () => {
      const tree = projectTree();
      const { adapter, made } = service({
        ...tree,
        [TARGET]: [folderMember("Project", TOP)],
      });
      const outcome = await copyItem(
        adapter,
        project,
        target,
        new AbortController().signal,
      );
      assert.equal(outcome.name, "Project_Copy1");
      assert.equal(made[0]?.name, "Project_Copy1");
    });

    it("copies an empty folder as just the folder", async () => {
      const { adapter, made } = service({ [TARGET]: [], [TOP]: [] });
      const outcome = await copyItem(
        adapter,
        project,
        target,
        new AbortController().signal,
      );
      assert.equal(outcome.total, 0);
      assert.equal(outcome.copied, 0);
      assert.equal(outcome.copyHref, "/folders/folders/new-1");
      assert.equal(made.length, 1);
    });

    it("goes on past a file that fails", async () => {
      const { adapter } = service(projectTree(), {
        failCopy: "/files/files/f-a",
      });
      const outcome = await copyItem(
        adapter,
        project,
        target,
        new AbortController().signal,
      );
      assert.equal(outcome.copied, 2);
      assert.deepEqual(
        outcome.failures.map((f) => f.path),
        [["Project", "a.py"]],
      );
      assert.equal(outcome.stopped, undefined);
    });

    it("creates nothing when a folder inside the source cannot be listed", async () => {
      const { adapter, made, copies } = service(projectTree(), {
        failListing: LIB,
      });
      const outcome = await copyItem(
        adapter,
        project,
        target,
        new AbortController().signal,
      );
      assert.deepEqual(outcome.stopped?.path, ["Project", "lib"]);
      assert.equal(outcome.copyHref, undefined);
      assert.equal(outcome.total, 0);
      assert.deepEqual(outcome.skipped, []);
      assert.equal(made.length, 0);
      assert.equal(copies.length, 0);
    });

    it("stops at a folder that cannot be created, keeping what was copied", async () => {
      const { adapter } = service(projectTree(), { failCreate: "lib" });
      const outcome = await copyItem(
        adapter,
        project,
        target,
        new AbortController().signal,
      );
      assert.deepEqual(outcome.stopped?.path, ["Project", "lib"]);
      assert.equal(outcome.copyHref, "/folders/folders/new-1");
      assert.equal(outcome.copied, 2);
      assert.equal(outcome.total, 3);
    });

    it("stops at a folder two levels down, without going on to its siblings", async () => {
      const DEEP = "/folders/folders/aaaa0000-0000-4000-8000-000000000003";
      const { adapter, made } = service(
        {
          [TARGET]: [],
          [TOP]: [folderMember("lib", LIB), folderMember("zed", DEEP)],
          [LIB]: [folderMember("deep", DEEP)],
        },
        { failCreate: "deep" },
      );
      const outcome = await copyItem(
        adapter,
        project,
        target,
        new AbortController().signal,
      );
      assert.deepEqual(outcome.stopped?.path, ["Project", "lib", "deep"]);
      assert.deepEqual(
        made.map((m) => m.name),
        ["Project", "lib"],
      );
      // "zed" points at the folder "deep" already listed, so it is left out.
      assert.deepEqual(outcome.skipped, [
        { path: ["Project", "zed"], reason: "already-listed" },
      ]);
    });

    it("stops with nothing made when the copy's own folder cannot be created", async () => {
      const { adapter, copies } = service(projectTree(), {
        failCreate: "Project",
      });
      const outcome = await copyItem(
        adapter,
        project,
        target,
        new AbortController().signal,
      );
      assert.deepEqual(outcome.stopped?.path, ["Project"]);
      assert.equal(outcome.copyHref, undefined);
      assert.equal(copies.length, 0);
    });

    describe("a name taken after the target was listed", () => {
      const taken409: ContentProblem = {
        code: "content-rejected",
        error: { status: 409, message: "already exists" },
      };

      it("copies a file once more under the next free name", async () => {
        const { adapter, copies } = service(
          { [TARGET]: [] },
          {
            race: {
              name: "model.py",
              member: fileMember("model.py", "f-raced"),
              problem: taken409,
            },
          },
        );
        const outcome = await copyItem(
          adapter,
          model,
          target,
          new AbortController().signal,
        );
        assert.equal(outcome.name, "model_Copy1.py");
        assert.equal(outcome.copied, 1);
        assert.deepEqual(outcome.failures, []);
        assert.deepEqual(
          copies.map((c) => sentName(c.disposition)),
          ["model_Copy1.py"],
        );
      });

      // A create that lost the race is refused `409` (Finding 13.11); one
      // whose name check ran after the winner landed is refused by the check
      // (finding 6.6).
      for (const [how, problem] of [
        [
          "a 409",
          {
            code: "content-rejected",
            error: { status: 409, errorCode: 11552, message: "exists" },
          },
        ],
        ["the name check", { code: "content-name-rejected", message: "taken" }],
      ] as const) {
        it(`makes a folder once more under the next free name after ${how}, renaming what it left out`, async () => {
          const { adapter, made } = service(projectTree(), {
            race: {
              name: "Project",
              member: folderMember("Project", "/folders/folders/raced"),
              problem,
            },
          });
          const outcome = await copyItem(
            adapter,
            project,
            target,
            new AbortController().signal,
          );
          assert.equal(outcome.name, "Project_Copy1");
          assert.equal(outcome.stopped, undefined);
          assert.equal(outcome.copied, 3);
          assert.deepEqual(
            made.map((m) => m.name),
            ["Project_Copy1", "lib"],
          );
          assert.deepEqual(
            outcome.skipped.map((s) => s.path),
            [
              ["Project_Copy1", "shortcut"],
              ["Project_Copy1", "flow"],
            ],
          );
        });
      }

      it("reports the refusal when the name is still free", async () => {
        const { adapter, copies, targetListings } = service(
          { [TARGET]: [] },
          {
            race: {
              name: "model.py",
              member: fileMember("model.py", "f-raced"),
              problem: taken409,
              taken: false,
            },
          },
        );
        const outcome = await copyItem(
          adapter,
          model,
          target,
          new AbortController().signal,
        );
        assert.equal(outcome.name, "model.py");
        assert.deepEqual(
          outcome.failures.map((f) => f.path),
          [["model.py"]],
        );
        assert.equal(copies.length, 0);
        assert.equal(targetListings(), 2);
      });

      it("reports the refusal when the target cannot be listed again", async () => {
        const { adapter, copies } = service(
          { [TARGET]: [] },
          {
            race: {
              name: "model.py",
              member: fileMember("model.py", "f-raced"),
              problem: taken409,
            },
            failRelisting: true,
          },
        );
        const outcome = await copyItem(
          adapter,
          model,
          target,
          new AbortController().signal,
        );
        assert.equal(outcome.name, "model.py");
        assert.deepEqual(outcome.failures[0]?.failure.problem, taken409);
        assert.equal(copies.length, 0);
      });

      it("does not try again after a call with no answer, which may have copied", async () => {
        const { adapter, copies, targetListings } = service(
          { [TARGET]: [] },
          {
            race: {
              name: "model.py",
              member: fileMember("model.py", "f-raced"),
              problem: { code: "content-unreachable", detail: "timed out" },
            },
          },
        );
        const outcome = await copyItem(
          adapter,
          model,
          target,
          new AbortController().signal,
        );
        assert.deepEqual(
          outcome.failures.map((f) => f.path),
          [["model.py"]],
        );
        assert.equal(copies.length, 0);
        assert.equal(targetListings(), 1);
      });
    });

    describe("cancel", () => {
      it("does nothing on a signal already aborted", async () => {
        const { adapter, calls } = service(projectTree());
        const controller = new AbortController();
        controller.abort();
        const outcome = await copyItem(
          adapter,
          project,
          target,
          controller.signal,
        );
        assert.equal(outcome.cancelled, true);
        assert.equal(calls.length, 0);
      });

      it("ends a file copy before the copy when cancelled during the listing", async () => {
        const controller = new AbortController();
        const { adapter, copies } = service(
          { [TARGET]: [] },
          // After the listing has been answered.
          {
            onList: () => {
              queueMicrotask(() => {
                controller.abort();
              });
            },
          },
        );
        const outcome = await copyItem(
          adapter,
          model,
          target,
          controller.signal,
        );
        assert.equal(outcome.cancelled, true);
        assert.equal(copies.length, 0);
      });

      it("reports a file copy aborted on the wire as cancelled", async () => {
        const controller = new AbortController();
        const { adapter } = service(
          { [TARGET]: [] },
          {
            onReadFile: () => {
              controller.abort();
            },
          },
        );
        const outcome = await copyItem(
          adapter,
          model,
          target,
          controller.signal,
        );
        assert.equal(outcome.cancelled, true);
        assert.deepEqual(outcome.failures, []);
      });

      it("reports a listing aborted on the wire as cancelled, not stopped", async () => {
        const controller = new AbortController();
        const { adapter, made } = service(projectTree(), {
          onList: (folder) => {
            if (folder === TOP) controller.abort();
          },
        });
        const outcome = await copyItem(
          adapter,
          project,
          target,
          controller.signal,
        );
        assert.equal(outcome.cancelled, true);
        assert.equal(outcome.stopped, undefined);
        assert.equal(made.length, 0);
      });

      it("creates nothing when cancelled once the source is listed", async () => {
        const controller = new AbortController();
        const { adapter, made } = service(
          { [TARGET]: [], [TOP]: [fileMember("a.py", "f-a")] },
          {
            onList: (folder) => {
              if (folder === TOP) {
                // After this listing has been answered.
                queueMicrotask(() => {
                  controller.abort();
                });
              }
            },
          },
        );
        const outcome = await copyItem(
          adapter,
          project,
          target,
          controller.signal,
        );
        assert.equal(outcome.cancelled, true);
        assert.equal(made.length, 0);
      });

      it("stops before the next file, and counts what was copied", async () => {
        const controller = new AbortController();
        const { adapter, copies } = service(projectTree(), {
          onCopied: () => {
            controller.abort();
          },
        });
        const outcome = await copyItem(
          adapter,
          project,
          target,
          controller.signal,
        );
        assert.equal(outcome.cancelled, true);
        assert.equal(outcome.copied, 1);
        assert.equal(outcome.total, 3);
        assert.equal(copies.length, 1);
        assert.equal(outcome.copyHref, "/folders/folders/new-1");
      });

      it("stops before the next folder", async () => {
        const controller = new AbortController();
        const { adapter, made } = service(projectTree(), {
          onCopied: (from) => {
            if (from === "/files/files/f-b") controller.abort();
          },
        });
        const outcome = await copyItem(
          adapter,
          project,
          target,
          controller.signal,
        );
        assert.equal(outcome.cancelled, true);
        assert.equal(outcome.copied, 2);
        assert.equal(made.length, 1);
      });

      it("reports a file in a folder aborted on the wire as cancelled", async () => {
        const controller = new AbortController();
        const { adapter } = service(projectTree(), {
          onReadFile: () => {
            controller.abort();
          },
        });
        const outcome = await copyItem(
          adapter,
          project,
          target,
          controller.signal,
        );
        assert.equal(outcome.cancelled, true);
        assert.equal(outcome.copied, 0);
        assert.deepEqual(outcome.failures, []);
      });
    });
  });
});
