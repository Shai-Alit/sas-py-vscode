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
  ASSIGN_REL,
  createFileref,
  FILEREF_LIST_REL,
  FILEREF_SELF_REL,
  FILEREF_UPLOAD_REL,
  type Fileref,
  listFilerefNames,
  writeFilerefContent,
} from "../../src/compute/fileref";
import { type Link } from "../../src/compute/links";
import { type ComputeSession } from "../../src/compute/session";

/**
 * Creating a fileref, and writing its content byte for byte.
 *
 * `submission-corpus.test.ts` drives {@link writeFilerefContent} across every
 * corpus fixture; this file is the module's own contract — the two-request
 * shape (a `GET` for a fresh `ETag`, then the `PUT`), what each failure reads
 * as, and that `rawBody` never goes near `JSON.stringify`.
 */

const SESSION_ID = "3f2b1c0a-7d4e-4a91-b6c2-1e5f8a0d9c34-ses0000";
const SESSION_PATH = `/compute/sessions/${SESSION_ID}`;
const FILEREF_ID = "case01";
const FILEREF_PATH = `${SESSION_PATH}/filerefs/${FILEREF_ID}`;

function sessionLinks(): readonly Link[] {
  return [
    {
      method: "POST",
      rel: ASSIGN_REL,
      href: `${SESSION_PATH}/filerefs`,
      type: "application/vnd.sas.compute.fileref.request",
      responseType: "application/vnd.sas.compute.fileref",
    },
    {
      method: "GET",
      rel: FILEREF_LIST_REL,
      href: `${SESSION_PATH}/filerefs`,
      type: "application/vnd.sas.collection",
    },
  ];
}

function session(links?: readonly Link[]): ComputeSession {
  return { id: SESSION_ID, state: "idle", links: links ?? sessionLinks() };
}

/**
 * All seven fileref relations, with the media type each one advertises.
 *
 * Relations from finding 36, types from finding 57 — which is the measurement
 * that matters to this module, because `upload` carrying
 * `application/octet-stream` in the link is what makes `client.ts` send that
 * header rather than its own default. A link set written here with no types at
 * all would exercise the default instead and prove the opposite of what the
 * deployment does.
 */
function filerefLinks(): readonly Link[] {
  return [
    {
      method: "GET",
      rel: "self",
      href: FILEREF_PATH,
      type: "application/vnd.sas.compute.fileref",
    },
    {
      method: "GET",
      rel: "alternate",
      href: FILEREF_PATH,
      type: "application/vnd.sas.compute.fileref.summary",
    },
    { method: "DELETE", rel: "deassign", href: FILEREF_PATH, type: null },
    {
      method: "GET",
      rel: "content",
      href: `${FILEREF_PATH}/content`,
      type: "application/octet-stream",
    },
    {
      method: "PUT",
      rel: "upload",
      href: `${FILEREF_PATH}/content`,
      type: "application/octet-stream",
    },
    {
      method: "POST",
      rel: "append",
      href: `${FILEREF_PATH}/content`,
      type: "application/octet-stream",
    },
    {
      method: "DELETE",
      rel: "delete",
      href: `${FILEREF_PATH}/content`,
      type: null,
    },
  ];
}

function fileref(links?: readonly Link[]): Fileref {
  return { id: FILEREF_ID, links: links ?? filerefLinks() };
}

function ok(
  body: unknown,
  init?: { status?: number; contentType?: string; etag?: string },
): ComputeResult<ComputeResponse> {
  return {
    ok: true,
    value: {
      status: init?.status ?? 200,
      notModified: false,
      ...(init?.etag === undefined ? {} : { etag: init.etag }),
      contentType:
        init?.contentType ?? "application/vnd.sas.compute.fileref+json",
      text: JSON.stringify(body),
      body,
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

describe("createFileref", () => {
  it("reads the id back and follows the session's assign relation", async () => {
    const scripted = fake([
      ok({ id: FILEREF_ID, links: filerefLinks() }, { status: 201 }),
    ]);

    const result = await createFileref(scripted.client, session(), FILEREF_ID);

    assert.ok(result.ok);
    assert.equal(result.value.id, FILEREF_ID);
    assert.equal(scripted.requests.length, 1);
    assert.equal(scripted.requests[0]?.link.rel, ASSIGN_REL);
  });

  it("sends the same value as name and path", async () => {
    const scripted = fake([ok({ id: FILEREF_ID, links: [] }, { status: 201 })]);

    await createFileref(scripted.client, session(), FILEREF_ID);

    assert.deepEqual(scripted.requests[0]?.body, {
      name: FILEREF_ID,
      path: FILEREF_ID,
    });
  });

  it("refuses an empty name without making a request", async () => {
    const scripted = fake([]);

    await assert.rejects(
      async () => await createFileref(scripted.client, session(), ""),
      TypeError,
    );
    assert.equal(scripted.requests.length, 0);
  });

  it("reports a session that carries no assign relation", async () => {
    const scripted = fake([]);

    const result = await createFileref(
      scripted.client,
      session([]),
      FILEREF_ID,
    );

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "link-missing");
    assert.match(result.reason, /compute session/);
  });

  it("reads a 404 as the session being gone", async () => {
    const scripted = fake([rejected(404)]);

    const result = await createFileref(scripted.client, session(), FILEREF_ID);

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "session-gone");
  });

  it("reports a 201 that is not a fileref, without quoting it", async () => {
    const scripted = fake([ok({ nothing: "useful" }, { status: 201 })]);

    const result = await createFileref(scripted.client, session(), FILEREF_ID);

    assert.ok(!result.ok);
    assert.ok(result.problem.code === "response-malformed");
    assert.doesNotMatch(result.problem.detail, /useful/);
  });
});

describe("writeFilerefContent", () => {
  const bytes = new TextEncoder().encode("print('hello')\n");

  it("GETs self for a fresh ETag, then PUTs upload with If-Match", async () => {
    const scripted = fake([
      ok({ id: FILEREF_ID, links: filerefLinks() }, { etag: '"etag-1"' }),
      ok(null, { status: 201 }),
    ]);

    const result = await writeFilerefContent(scripted.client, fileref(), bytes);

    assert.ok(result.ok);
    assert.equal(scripted.requests.length, 2);
    assert.equal(scripted.requests[0]?.link.rel, FILEREF_SELF_REL);
    const put = scripted.requests[1];
    assert.equal(put?.link.rel, FILEREF_UPLOAD_REL);
    // Not `put?.etag`: the assertion above is `asserts actual is T`-typed in
    // Node's strict assert module, and narrowing an optional chain's result
    // narrows the chain's own root too — so by this line the compiler already
    // knows `put` is not `undefined`, and the extra `?.` is what ESLint flagged.
    assert.equal(put.etag, '"etag-1"');
  });

  it("sends the bytes as rawBody, never as body", async () => {
    const scripted = fake([
      ok({ id: FILEREF_ID, links: filerefLinks() }, { etag: '"etag-1"' }),
      ok(null, { status: 201 }),
    ]);

    await writeFilerefContent(scripted.client, fileref(), bytes);

    const put = scripted.requests[1];
    // `assert.ok` rather than leaning on the next line to narrow: unlike the
    // test above, `assert.equal(put?.body, undefined)` holds just as well when
    // `put` itself is undefined, so it narrows nothing and every later member
    // access would be unchecked.
    assert.ok(put !== undefined);
    assert.equal(put.body, undefined);
    assert.equal(put.rawBody, bytes);
    // The module sets no `Content-Type` of its own: the link it hands the
    // client is the one finding 57 measured advertising
    // `application/octet-stream`, and `client.ts` sends a link's type verbatim
    // when it is not a SAS vendor type. Its own octet-stream default for a
    // `rawBody` is a different arm, which this path never reaches — so this
    // asserts the request the module actually made, not the fixture above.
    assert.equal(put.link.type, "application/octet-stream");
  });

  it("reports a fileref with no self relation, without making a request", async () => {
    const scripted = fake([]);

    const result = await writeFilerefContent(
      scripted.client,
      fileref([]),
      bytes,
    );

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "link-missing");
    assert.match(result.reason, /fileref/);
    assert.equal(scripted.requests.length, 0);
  });

  it("reports a fileref with no upload relation, without making a request", async () => {
    // The count is the assertion. Both relations come off the representation
    // already in hand, so a missing `upload` is knowable before the `self` read
    // — spending that round trip first would tell us nothing we did not have.
    const selfOnly: readonly Link[] = [
      { method: "GET", rel: "self", href: FILEREF_PATH },
    ];
    const scripted = fake([]);

    const result = await writeFilerefContent(
      scripted.client,
      fileref(selfOnly),
      bytes,
    );

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "link-missing");
    assert.equal(scripted.requests.length, 0);
  });

  it("reports a self read that carried no ETag", async () => {
    const scripted = fake([ok({ id: FILEREF_ID, links: filerefLinks() })]);

    const result = await writeFilerefContent(scripted.client, fileref(), bytes);

    assert.ok(!result.ok);
    assert.ok(result.problem.code === "response-malformed");
    assert.equal(scripted.requests.length, 1);
  });

  it("reads a 428 (missing precondition) as an ordinary rejection", async () => {
    // Finding 36's observed failure for a stale or absent If-Match. Nothing
    // here interprets 428 specially — it arrives as compute-rejected, same as
    // any other status this layer does not have a reading for.
    const scripted = fake([
      ok({ id: FILEREF_ID, links: filerefLinks() }, { etag: '"etag-1"' }),
      rejected(428),
    ]);

    const result = await writeFilerefContent(scripted.client, fileref(), bytes);

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "compute-rejected");
  });

  it("reads a 404 on the content write as the session being gone", async () => {
    const scripted = fake([
      ok({ id: FILEREF_ID, links: filerefLinks() }, { etag: '"etag-1"' }),
      rejected(404),
    ]);

    const result = await writeFilerefContent(scripted.client, fileref(), bytes);

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "session-gone");
  });
});

describe("listFilerefNames", () => {
  it("returns the ids, following the session's files relation", async () => {
    const scripted = fake([
      ok({
        items: [
          { id: "PY000001" },
          { id: "PY000002" },
          { id: "somethingElse" },
        ],
      }),
    ]);

    const result = await listFilerefNames(scripted.client, session());

    assert.ok(result.ok);
    assert.deepEqual(result.value, ["PY000001", "PY000002", "somethingElse"]);
    assert.equal(scripted.requests.length, 1);
    assert.equal(scripted.requests[0]?.link.rel, FILEREF_LIST_REL);
  });

  it("treats a body with no items array as an empty list, not a failure", async () => {
    const scripted = fake([ok({ count: 0 })]);

    const result = await listFilerefNames(scripted.client, session());

    assert.ok(result.ok);
    assert.deepEqual(result.value, []);
  });

  it("skips items that carry no string id", async () => {
    const scripted = fake([
      ok({ items: [{ id: "PY000001" }, { id: 7 }, {}, "not-an-object"] }),
    ]);

    const result = await listFilerefNames(scripted.client, session());

    assert.ok(result.ok);
    assert.deepEqual(result.value, ["PY000001"]);
  });

  it("reports a session that carries no files relation", async () => {
    const scripted = fake([]);

    const result = await listFilerefNames(scripted.client, session([]));

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "link-missing");
    assert.match(result.reason, /compute session/);
    assert.equal(scripted.requests.length, 0);
  });

  it("propagates a 404 as the session being gone", async () => {
    const scripted = fake([rejected(404)]);

    const result = await listFilerefNames(scripted.client, session());

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "session-gone");
  });
});
