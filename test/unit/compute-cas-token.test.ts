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
  MAX_CAS_TOKEN_ASSIGN_ATTEMPTS,
  writeCasToken,
} from "../../src/compute/casToken";
import {
  ASSIGN_REL,
  FILEREF_SELF_REL,
  FILEREF_UPLOAD_REL,
} from "../../src/compute/fileref";
import { type Link } from "../../src/wire/links";
import { type ComputeSession } from "../../src/compute/session";

/**
 * 8b's own token-delivery module: create a fresh fileref, write the token's
 * UTF-8 bytes into it, retry under a new name on a name collision. The two
 * Compute calls per attempt are already `compute-fileref.test.ts`'s own
 * contract; this file is `writeCasToken`'s own — the retry loop, and that
 * the token never appears anywhere but `rawBody`.
 */

const SESSION_ID = "3f2b1c0a-7d4e-4a91-b6c2-1e5f8a0d9c34-ses0000";
const SESSION_PATH = `/compute/sessions/${SESSION_ID}`;

function sessionLinks(): readonly Link[] {
  return [
    {
      method: "POST",
      rel: ASSIGN_REL,
      href: `${SESSION_PATH}/filerefs`,
      type: "application/vnd.sas.compute.fileref.request",
      responseType: "application/vnd.sas.compute.fileref",
    },
  ];
}

function session(): ComputeSession {
  return { id: SESSION_ID, state: "idle", links: sessionLinks() };
}

function filerefLinks(id: string): readonly Link[] {
  const path = `${SESSION_PATH}/filerefs/${id}`;
  return [
    {
      method: "GET",
      rel: "self",
      href: path,
      type: "application/vnd.sas.compute.fileref",
    },
    {
      method: "PUT",
      rel: "upload",
      href: `${path}/content`,
      type: "application/octet-stream",
    },
  ];
}

function ok(
  body: unknown,
  init?: { status?: number; etag?: string },
): ComputeResult<ComputeResponse> {
  return {
    ok: true,
    value: {
      status: init?.status ?? 200,
      notModified: false,
      ...(init?.etag === undefined ? {} : { etag: init.etag }),
      contentType: "application/vnd.sas.compute.fileref+json",
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

/** A create response naming `id` as both the assigned fileref and the
 * links it carries — the same shape `compute-fileref.test.ts` builds. */
function created(id: string): ComputeResult<ComputeResponse> {
  return ok({ id, links: filerefLinks(id) }, { status: 201 });
}

describe("writeCasToken", () => {
  it("creates a fileref, then writes the token's UTF-8 bytes to it", async () => {
    const scripted = fake([
      created("CT000001"),
      ok({ id: "CT000001", links: filerefLinks("CT000001") }, { etag: '"e1"' }),
      ok(null, { status: 201 }),
    ]);

    const result = await writeCasToken(
      scripted.client,
      session(),
      "s3cr3t-token",
    );

    assert.ok(result.ok);
    assert.match(result.value.filerefName, /^CT\d{6}$/);
    assert.equal(scripted.requests.length, 3);
    assert.equal(scripted.requests[0]?.link.rel, ASSIGN_REL);
    assert.equal(scripted.requests[1]?.link.rel, FILEREF_SELF_REL);
    const put = scripted.requests[2];
    assert.equal(put?.link.rel, FILEREF_UPLOAD_REL);
  });

  it("sends the token as rawBody, never as a JSON body", async () => {
    const scripted = fake([
      created("CT000001"),
      ok({ id: "CT000001", links: filerefLinks("CT000001") }, { etag: '"e1"' }),
      ok(null, { status: 201 }),
    ]);

    await writeCasToken(scripted.client, session(), "s3cr3t-token");

    const put = scripted.requests[2];
    assert.ok(put !== undefined);
    // The whole point of this module: nothing it sends carries the token as
    // a JSON body a log could echo — only as `rawBody`.
    assert.equal(put.body, undefined);
    assert.deepEqual(put.rawBody, new TextEncoder().encode("s3cr3t-token"));
  });

  it("retries under a new name on a retriable name collision", async () => {
    const scripted = fake([
      rejected(400),
      created("CT000002"),
      ok({ id: "CT000002", links: filerefLinks("CT000002") }, { etag: '"e1"' }),
      ok(null, { status: 201 }),
    ]);

    const result = await writeCasToken(scripted.client, session(), "token");

    assert.ok(result.ok);
    assert.equal(scripted.requests.length, 4);
  });

  it("does not retry a non-retriable failure", async () => {
    const scripted = fake([rejected(404)]);

    const result = await writeCasToken(scripted.client, session(), "token");

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "session-gone");
    assert.equal(scripted.requests.length, 1);
  });

  it("gives up after the attempt cap, all names colliding", async () => {
    const scripted = fake(
      Array.from({ length: MAX_CAS_TOKEN_ASSIGN_ATTEMPTS }, () =>
        rejected(400),
      ),
    );

    const result = await writeCasToken(scripted.client, session(), "token");

    assert.ok(!result.ok);
    assert.equal(scripted.requests.length, MAX_CAS_TOKEN_ASSIGN_ATTEMPTS);
  });

  it("propagates a failed content write without retrying the name", async () => {
    const scripted = fake([
      created("CT000001"),
      ok({ id: "CT000001", links: filerefLinks("CT000001") }, { etag: '"e1"' }),
      rejected(428),
    ]);

    const result = await writeCasToken(scripted.client, session(), "token");

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "compute-rejected");
    assert.equal(scripted.requests.length, 3);
  });

  it("threads a caller's AbortSignal to every request it makes", async () => {
    const scripted = fake([
      created("CT000001"),
      ok({ id: "CT000001", links: filerefLinks("CT000001") }, { etag: '"e1"' }),
      ok(null, { status: 201 }),
    ]);
    const controller = new AbortController();

    await writeCasToken(scripted.client, session(), "token", {
      signal: controller.signal,
    });

    assert.ok(scripted.requests.every((r) => r.signal === controller.signal));
  });
});
