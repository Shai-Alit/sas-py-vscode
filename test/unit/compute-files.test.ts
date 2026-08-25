// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  type ComputeClient,
  type ComputeRequest,
  type ComputeResponse,
  type ComputeResult,
} from "../../src/compute/client";
import {
  deleteSessionFile,
  DIRECTORY_MEMBERS_REL,
  FILE_CONTENT_REL,
  FILE_DELETE_REL,
  FILE_PROPERTIES_REL,
  GET_FILES_REL,
  listSessionFiles,
  readFileContent,
  type SessionFile,
} from "../../src/compute/files";
import { type Link } from "../../src/compute/links";
import { type ComputeSession } from "../../src/compute/session";

/**
 * The session working-directory listing, content read, and delete — ADR-0019's
 * mechanism, confirmed live against `verde` (finding 68, 2026-08-25): a
 * session's `getFiles` relation resolves to the directory's own properties,
 * which carries `getDirectoryMembers`; a listing item carries `getFile`
 * (content) and `getFileProperties`/`deleteFile` (not `self`/`delete`) as its
 * own, distinct relations.
 */

const SESSION_ID = "3f2b1c0a-7d4e-4a91-b6c2-1e5f8a0d9c34-ses0000";
const SESSION_PATH = `/compute/sessions/${SESSION_ID}`;
const DIR_PATH = `${SESSION_PATH}/files/~fs~opt~fs~sas~fs~viya~fs~run~fs~${SESSION_ID}`;
const FILE_PATH = `${DIR_PATH}~fs~probe_plot.png`;

function sessionLinks(): readonly Link[] {
  return [
    {
      method: "GET",
      rel: GET_FILES_REL,
      href: `${SESSION_PATH}/files`,
      type: "application/vnd.sas.compute.file.properties",
    },
  ];
}

function session(links?: readonly Link[]): ComputeSession {
  return { id: SESSION_ID, state: "idle", links: links ?? sessionLinks() };
}

/** The directory's own properties representation — a subset of finding 68's
 * confirmed link set, keeping only the one relation this module follows. */
function directoryProperties(links?: readonly Link[]): Record<string, unknown> {
  return {
    isDirectory: true,
    name: SESSION_ID,
    path: "/opt/sas/viya/config/var/run/compsrv/default",
    size: 4096,
    links: links ?? [
      {
        method: "GET",
        rel: DIRECTORY_MEMBERS_REL,
        href: `${DIR_PATH}/members`,
        type: "application/vnd.sas.collection",
        itemType: "application/vnd.sas.compute.file.properties",
      },
    ],
  };
}

/** One listing item's own link set — finding 68's confirmed shape, trimmed to
 * the relations this module reads. */
function fileLinks(): readonly Link[] {
  return [
    {
      method: "GET",
      rel: FILE_PROPERTIES_REL,
      href: FILE_PATH,
      type: "application/vnd.sas.compute.file.properties",
    },
    {
      method: "GET",
      rel: FILE_CONTENT_REL,
      href: `${FILE_PATH}/content`,
      type: "image/png",
    },
    { method: "DELETE", rel: FILE_DELETE_REL, href: FILE_PATH },
  ];
}

function file(links?: readonly Link[]): SessionFile {
  return { name: "probe_plot.png", size: 23_206, links: links ?? fileLinks() };
}

function ok(
  body: unknown,
  init?: {
    status?: number;
    contentType?: string;
    etag?: string;
    rawBody?: Uint8Array;
  },
): ComputeResult<ComputeResponse> {
  return {
    ok: true,
    value: {
      status: init?.status ?? 200,
      notModified: false,
      ...(init?.etag === undefined ? {} : { etag: init.etag }),
      contentType: init?.contentType ?? "application/json",
      text: JSON.stringify(body),
      body,
      ...(init?.rawBody === undefined ? {} : { rawBody: init.rawBody }),
    },
  };
}

function rejected(status: number): ComputeResult<ComputeResponse> {
  return {
    ok: false,
    reason: `the compute service answered HTTP ${String(status)}`,
    problem: { code: "compute-rejected", error: { status, message: "" } },
  };
}

interface Fake {
  readonly requests: ComputeRequest[];
  readonly client: ComputeClient;
}

function fake(replies: readonly ComputeResult<ComputeResponse>[]): Fake {
  const requests: ComputeRequest[] = [];
  const client: ComputeClient = {
    send: (request) => {
      const index = requests.length;
      requests.push(request);
      const reply = replies[index];
      assert.ok(
        reply !== undefined,
        `the module sent ${String(index + 1)} requests and the script had fewer replies`,
      );
      return Promise.resolve(reply);
    },
  };
  return { requests, client };
}

describe("listSessionFiles", () => {
  it("follows getFiles then getDirectoryMembers, and maps items", async () => {
    const scripted = fake([
      ok(directoryProperties()),
      ok({
        count: 1,
        items: [
          {
            isDirectory: false,
            name: "probe_plot.png",
            size: 23_206,
            links: fileLinks(),
          },
        ],
      }),
    ]);

    const result = await listSessionFiles(scripted.client, session());

    assert.ok(result.ok);
    assert.equal(result.value.length, 1);
    assert.equal(result.value[0]?.name, "probe_plot.png");
    // Narrowed non-nullish by the assertion above (see the identical note in
    // `backend-rich-output.test.ts`) — the `?.` here trips
    // `no-unnecessary-condition`.
    assert.equal(result.value[0].size, 23_206);
    assert.equal(scripted.requests.length, 2);
    assert.equal(scripted.requests[0]?.link.rel, GET_FILES_REL);
    assert.equal(scripted.requests[1]?.link.rel, DIRECTORY_MEMBERS_REL);
  });

  it("returns an empty list for an empty directory", async () => {
    const scripted = fake([
      ok(directoryProperties()),
      ok({ count: 0, items: [] }),
    ]);

    const result = await listSessionFiles(scripted.client, session());

    assert.ok(result.ok);
    assert.deepEqual(result.value, []);
  });

  it("reports a session with no getFiles relation, without making a request", async () => {
    const scripted = fake([]);

    const result = await listSessionFiles(scripted.client, session([]));

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "link-missing");
    assert.equal(scripted.requests.length, 0);
  });

  it("reports a directory representation with no getDirectoryMembers relation", async () => {
    const scripted = fake([ok(directoryProperties([]))]);

    const result = await listSessionFiles(scripted.client, session());

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "link-missing");
    assert.equal(scripted.requests.length, 1);
  });

  it("reports a listing with no items array", async () => {
    const scripted = fake([ok(directoryProperties()), ok({ count: 0 })]);

    const result = await listSessionFiles(scripted.client, session());

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "response-malformed");
  });

  it("drops a listing item with no string name rather than failing the list", async () => {
    // Nothing has measured a listing item shaped this way; the check is
    // defensive, the same posture `readVariable` takes on an unmatched item.
    const scripted = fake([
      ok(directoryProperties()),
      ok({ count: 1, items: [{ size: 10, links: [] }] }),
    ]);

    const result = await listSessionFiles(scripted.client, session());

    assert.ok(result.ok);
    assert.deepEqual(result.value, []);
  });

  it("reads size as undefined when an item carries none", async () => {
    const scripted = fake([
      ok(directoryProperties()),
      ok({ count: 1, items: [{ name: "no_size.txt", links: [] }] }),
    ]);

    const result = await listSessionFiles(scripted.client, session());

    assert.ok(result.ok);
    assert.equal(result.value[0]?.size, undefined);
  });

  it("reads a 404 on getFiles as the session being gone", async () => {
    const scripted = fake([rejected(404)]);

    const result = await listSessionFiles(scripted.client, session());

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "session-gone");
  });

  it("reads a 404 on getDirectoryMembers as the session being gone", async () => {
    const scripted = fake([ok(directoryProperties()), rejected(404)]);

    const result = await listSessionFiles(scripted.client, session());

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "session-gone");
  });
});

describe("readFileContent", () => {
  it("follows getFile and returns rawBody", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const scripted = fake([
      ok(null, { contentType: "image/png", rawBody: bytes }),
    ]);

    const result = await readFileContent(scripted.client, file());

    assert.ok(result.ok);
    assert.deepEqual(result.value, bytes);
    assert.equal(scripted.requests[0]?.link.rel, FILE_CONTENT_REL);
  });

  it("passes maxBytes through as the request's maxBodyBytes", async () => {
    const scripted = fake([ok(null, { rawBody: new Uint8Array([1]) })]);

    await readFileContent(scripted.client, file(), {
      maxBytes: 10 * 1024 * 1024,
    });

    assert.equal(scripted.requests[0]?.maxBodyBytes, 10 * 1024 * 1024);
  });

  it("reports a file with no getFile relation, without making a request", async () => {
    const scripted = fake([]);

    const result = await readFileContent(scripted.client, file([]));

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "link-missing");
    assert.equal(scripted.requests.length, 0);
  });

  it("reports a response carrying no raw bytes", async () => {
    // Every transport this project runs provides `rawBody`; this is the
    // defensive arm for one that does not, not an observed deployment shape.
    const scripted = fake([ok(null)]);

    const result = await readFileContent(scripted.client, file());

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "response-malformed");
  });

  it("reads a 404 as the session being gone", async () => {
    const scripted = fake([rejected(404)]);

    const result = await readFileContent(scripted.client, file());

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "session-gone");
  });
});

describe("deleteSessionFile", () => {
  it("GETs getFileProperties for a fresh ETag, then DELETEs deleteFile with If-Match", async () => {
    const scripted = fake([
      ok({ name: "probe_plot.png" }, { etag: '"etag-1"' }),
      ok(null, { status: 204 }),
    ]);

    const result = await deleteSessionFile(scripted.client, file());

    assert.ok(result.ok);
    assert.equal(scripted.requests.length, 2);
    assert.equal(scripted.requests[0]?.link.rel, FILE_PROPERTIES_REL);
    const del = scripted.requests[1];
    assert.ok(del !== undefined);
    assert.equal(del.link.rel, FILE_DELETE_REL);
    assert.equal(del.etag, '"etag-1"');
  });

  it("reports a file with no getFileProperties relation, without making a request", async () => {
    const noProperties: readonly Link[] = [
      { method: "DELETE", rel: FILE_DELETE_REL, href: FILE_PATH },
    ];
    const scripted = fake([]);

    const result = await deleteSessionFile(scripted.client, file(noProperties));

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "link-missing");
    assert.equal(scripted.requests.length, 0);
  });

  it("reports a file with no deleteFile relation, without making a request", async () => {
    // Both relations come off the representation already in hand, so a
    // missing `deleteFile` is knowable before the `getFileProperties` read —
    // the same up-front check `writeFilerefContent` makes for `self`/`upload`.
    const noDelete: readonly Link[] = [
      { method: "GET", rel: FILE_PROPERTIES_REL, href: FILE_PATH },
    ];
    const scripted = fake([]);

    const result = await deleteSessionFile(scripted.client, file(noDelete));

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "link-missing");
    assert.equal(scripted.requests.length, 0);
  });

  it("reports a properties read that carried no ETag", async () => {
    const scripted = fake([ok({ name: "probe_plot.png" })]);

    const result = await deleteSessionFile(scripted.client, file());

    assert.ok(!result.ok);
    assert.ok(result.problem.code === "response-malformed");
    assert.equal(scripted.requests.length, 1);
  });

  it("reads a 428 (missing precondition) as an ordinary rejection", async () => {
    // Finding 65's observed failure for a missing/stale If-Match. Nothing
    // here interprets 428 specially.
    const scripted = fake([
      ok({ name: "probe_plot.png" }, { etag: '"etag-1"' }),
      rejected(428),
    ]);

    const result = await deleteSessionFile(scripted.client, file());

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "compute-rejected");
  });

  it("reads a 404 on the properties read as the session being gone", async () => {
    const scripted = fake([rejected(404)]);

    const result = await deleteSessionFile(scripted.client, file());

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "session-gone");
  });

  it("reads a 404 on the delete itself as the session being gone", async () => {
    const scripted = fake([
      ok({ name: "probe_plot.png" }, { etag: '"etag-1"' }),
      rejected(404),
    ]);

    const result = await deleteSessionFile(scripted.client, file());

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "session-gone");
  });
});
