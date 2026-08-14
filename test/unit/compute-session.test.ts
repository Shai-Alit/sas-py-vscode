// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  type ComputeClient,
  type ComputeRequest,
  type ComputeResponse,
  type ComputeResult,
} from "../../src/compute/client";
import type { ComputeContext } from "../../src/compute/contexts";
import type { Link } from "../../src/compute/links";
import {
  asSessionGone,
  cancelSession,
  type ComputeSession,
  createSession,
  DEFAULT_WAIT_SECONDS,
  deleteSession,
  MAX_WAIT_WINDOWS,
  readSessionState,
  SESSION_NAME,
  waitWhilePending,
  WAIT_MARGIN_SECONDS,
} from "../../src/compute/session";
import { readJsonFixture } from "../helpers/fixtures";

/**
 * Creating a session, watching it, and taking it down.
 *
 * Four of the cases below exist because upstream gets them wrong, and one
 * because an earlier draft of this project's own documentation did.
 *
 * **The 401.** `problems.ts` once said a dead token and a dead session should
 * both become `session-gone`. A caller acting on that would create a session
 * with the credential that just failed, forever. Two tests pin the split.
 *
 * **The 304.** Upstream's state poll answers a `304` by fetching the state it
 * just asked not to be sent. Here an unchanged reading carries no state at all,
 * and `deepEqual` against `{ changed: false }` is what keeps it that way.
 *
 * **The `If-Match`.** Upstream sends one on cancel and recurses without bound on
 * the `412` that results; it sends one on delete, where a stale ETag leaves a SAS
 * process running until the 900-second timeout reaps it. Both are asserted absent.
 *
 * **The `Location`.** A `201` carries one, and following it would be a second
 * round trip for a representation we were just handed in the body.
 */

const SESSION_ID = "3f2b1c0a-7d4e-4a91-b6c2-1e5f8a0d9c34-ses0000";
const SESSION_PATH = `/compute/sessions/${SESSION_ID}`;
const ETAG = 'W/"1"';
const NEXT_ETAG = 'W/"2"';
const CONTEXT_ID = "00000000-0000-4000-8000-0000000000c1";
const CONTEXT_NAME = "SAS Job Execution compute context";

/** The context link a session is created from, as `resolveContext` yields it. */
function context(links?: readonly Link[]): ComputeContext {
  return {
    id: CONTEXT_ID,
    name: CONTEXT_NAME,
    links: links ?? [
      {
        method: "POST",
        rel: "createSession",
        href: `/compute/contexts/${CONTEXT_ID}/sessions`,
        type: "application/vnd.sas.compute.session.request",
        responseType: "application/vnd.sas.compute.session",
      },
    ],
  };
}

/** The session links this module navigates by, exactly as finding 21 shows them. */
function sessionLinks(init?: { state?: string }): readonly Link[] {
  return [
    {
      method: "GET",
      rel: "self",
      href: SESSION_PATH,
      type: "application/vnd.sas.compute.session",
    },
    {
      method: "GET",
      rel: "state",
      href: init?.state ?? `${SESSION_PATH}/state`,
      type: "text/plain",
    },
    // Sent fully formed, query and all. Nothing here builds this href.
    {
      method: "PUT",
      rel: "cancel",
      href: `${SESSION_PATH}/state?value=canceled`,
    },
    { method: "DELETE", rel: "delete", href: SESSION_PATH },
  ];
}

function session(init?: {
  state?: string;
  etag?: string;
  links?: readonly Link[];
}): ComputeSession {
  return {
    id: SESSION_ID,
    state: init?.state ?? "pending",
    etag: init?.etag ?? ETAG,
    links: init?.links ?? sessionLinks(),
  };
}

/** The smallest body that is a session, for the tests that are not about parsing. */
function sessionBody(): unknown {
  return {
    id: SESSION_ID,
    state: "pending",
    attributes: { sessionInactiveTimeout: 900 },
    links: sessionLinks(),
  };
}

function ok(
  body: unknown,
  init?: {
    status?: number;
    contentType?: string;
    etag?: string;
    location?: string;
  },
): ComputeResult<ComputeResponse> {
  return {
    ok: true,
    value: {
      status: init?.status ?? 200,
      notModified: false,
      ...(init?.etag === undefined ? {} : { etag: init.etag }),
      ...(init?.location === undefined ? {} : { location: init.location }),
      contentType:
        init?.contentType ?? "application/vnd.sas.compute.session+json",
      text: JSON.stringify(body),
      body,
    },
  };
}

/** The `text/plain` state resource — seven bytes, no trailing newline. */
function plain(
  text: string,
  init?: { etag?: string },
): ComputeResult<ComputeResponse> {
  return {
    ok: true,
    value: {
      status: 200,
      notModified: false,
      ...(init?.etag === undefined ? {} : { etag: init.etag }),
      contentType: "text/plain;charset=UTF-8",
      text,
      // Not JSON, so the client leaves this unset — which is why `readSessionState`
      // reads `text` and not `body`.
      body: undefined,
    },
  };
}

/** A `304`: the state is still whatever the caller already held. */
function unchanged(): ComputeResult<ComputeResponse> {
  return {
    ok: true,
    value: {
      status: 304,
      notModified: true,
      etag: ETAG,
      contentType: "text/plain;charset=UTF-8",
      text: "",
      body: undefined,
    },
  };
}

/** A `204`, as `DELETE` answers. */
function noContent(): ComputeResult<ComputeResponse> {
  return {
    ok: true,
    value: { status: 204, notModified: false, text: "", body: undefined },
  };
}

/** What the client makes of any non-2xx it declines to interpret. */
function rejected(status: number): ComputeResult<ComputeResponse> {
  return {
    ok: false,
    reason: `the compute service answered HTTP ${String(status)}`,
    problem: {
      code: "compute-rejected",
      error: { status, message: "Not Found" },
    },
  };
}

/** A 401 as slice 1c reads it, which is the reading that must survive. */
function unauthorized(): ComputeResult<ComputeResponse> {
  return {
    ok: false,
    reason: "the access token is no longer active",
    problem: {
      code: "unauthorized",
      problem: { code: "session-expired" },
    },
  };
}

interface Fake {
  readonly requests: ComputeRequest[];
  readonly client: ComputeClient;
}

function fake(
  replies:
    | readonly ComputeResult<ComputeResponse>[]
    | ((index: number) => ComputeResult<ComputeResponse>),
): Fake {
  const requests: ComputeRequest[] = [];
  const client: ComputeClient = {
    send: (request) => {
      const index = requests.length;
      requests.push(request);
      const reply =
        typeof replies === "function" ? replies(index) : replies[index];
      assert.ok(
        reply !== undefined,
        `the module sent ${String(index + 1)} requests and the script had fewer replies`,
      );
      return Promise.resolve(reply);
    },
  };
  return { requests, client };
}

/** The single request the module made, so no test optional-chains an index. */
function only(requests: readonly ComputeRequest[]): ComputeRequest {
  assert.equal(
    requests.length,
    1,
    "the module did not make exactly one request",
  );
  const [request] = requests;
  assert.ok(request !== undefined);
  return request;
}

/** The request at an index, with the same courtesy. */
function at(
  requests: readonly ComputeRequest[],
  index: number,
): ComputeRequest {
  const request = requests[index];
  assert.ok(
    request !== undefined,
    `the module made fewer than ${String(index + 1)} requests`,
  );
  return request;
}

describe("createSession", () => {
  it("reads the representation a real deployment sent", async () => {
    // The scrubbed 201 body, structurally as it arrived (finding 21). Reading it
    // rather than a hand-built object is the only way this test would notice the
    // service changing shape underneath us.
    const payload = readJsonFixture("viya4", "compute-session-created.json");
    const scripted = fake([ok(payload, { status: 201, etag: ETAG })]);

    const result = await createSession(scripted.client, context());

    assert.ok(result.ok, "a created session was reported as a failure");
    assert.equal(result.value.id, SESSION_ID);
    assert.equal(result.value.state, "pending");
    assert.equal(result.value.etag, ETAG);
    // Read, not assumed: it is a configurable, and 2a-ii wants to tell the user
    // how long their session will survive being ignored.
    assert.equal(result.value.inactiveTimeoutSeconds, 900);
    // The session API arrives in the body. If this number ever drops, something
    // is being filtered out that a later slice navigates by.
    assert.equal(result.value.links.length, 22);
  });

  it("sends the session request the service expects", async () => {
    const scripted = fake([ok(sessionBody(), { status: 201 })]);

    await createSession(scripted.client, context());

    const request = only(scripted.requests);
    assert.equal(request.link.rel, "createSession");
    assert.equal(request.link.method, "POST");
    assert.deepEqual(request.body, {
      version: 1,
      name: SESSION_NAME,
      description: "Python on Viya — VS Code extension session",
      attributes: {},
      environment: { options: [], autoExecLines: [] },
    });
  });

  it("gives the session a stable name an administrator can search for", () => {
    // Not localised. It shows up in someone else's Environment Manager, and a
    // name that changes with the editor's display language is unsearchable.
    assert.equal(SESSION_NAME, "python-on-viya");
  });

  it("passes SAS options and autoexec lines into the environment", async () => {
    const scripted = fake([ok(sessionBody(), { status: 201 })]);

    await createSession(scripted.client, context(), {
      options: ["-memsize 4G"],
      autoExecLines: ["options nosource;"],
    });

    assert.deepEqual(only(scripted.requests).body, {
      version: 1,
      name: SESSION_NAME,
      description: "Python on Viya — VS Code extension session",
      attributes: {},
      environment: {
        options: ["-memsize 4G"],
        autoExecLines: ["options nosource;"],
      },
    });
  });

  it("does not follow the Location header", async () => {
    // The body already carries the links, so a second request for the same
    // representation is a round trip spent on nothing.
    const scripted = fake([
      ok(sessionBody(), { status: 201, location: SESSION_PATH, etag: ETAG }),
    ]);

    const result = await createSession(scripted.client, context());

    assert.ok(result.ok, "a created session was reported as a failure");
    only(scripted.requests);
  });

  it("reports a context without a createSession link, sending nothing", async () => {
    const scripted = fake([]);

    const result = await createSession(scripted.client, context([]));

    assert.ok(!result.ok, "a context with no link was accepted");
    assert.equal(result.problem.code, "link-missing");
    assert.equal(scripted.requests.length, 0);
  });

  it("reports a 201 that is not a session as malformed, without quoting it", async () => {
    const scripted = fake([
      ok({ owner: "someone@example.com", state: "pending" }, { status: 201 }),
    ]);

    const result = await createSession(scripted.client, context());

    assert.ok(!result.ok, "a body with no id was accepted as a session");
    // `assert.ok(x === "…")` rather than `assert.equal`: the latter narrows the
    // property to that literal, after which reading `detail` off the union is a
    // comparison the linter can prove is always true.
    assert.ok(
      result.problem.code === "response-malformed",
      "a body with no id was not reported as malformed",
    );
    assert.ok(
      !result.problem.detail.includes("someone@example.com"),
      "the malformed-body detail repeated the payload into the log",
    );
  });

  it("refuses a 201 that is not an object at all", async () => {
    for (const body of [null, "pending", 42, [{ id: SESSION_ID }]]) {
      const scripted = fake([ok(body, { status: 201 })]);

      const result = await createSession(scripted.client, context());

      assert.ok(!result.ok, `a ${typeof body} body was accepted as a session`);
      assert.equal(result.problem.code, "response-malformed");
    }
  });

  it("refuses an id or a state that is present but empty", async () => {
    // A representation with an empty id would be navigable right up until the
    // first request built from it, which is a worse place to find out.
    for (const body of [
      { id: "", state: "pending" },
      { id: SESSION_ID, state: "" },
    ]) {
      const scripted = fake([ok(body, { status: 201 })]);

      const result = await createSession(scripted.client, context());

      assert.ok(!result.ok, "an empty identifier was accepted");
      assert.equal(result.problem.code, "response-malformed");
    }
  });

  it("says nothing about the inactivity timeout when the service does not", async () => {
    // Read, never assumed. Every deployment seen says 900, but it is a
    // configurable, and telling a user their session lasts 15 minutes when it
    // does not is worse than not telling them.
    for (const attributes of [
      undefined,
      null,
      "none",
      {},
      { sessionInactiveTimeout: "900" },
      { sessionInactiveTimeout: Number.NaN },
    ]) {
      const scripted = fake([
        ok(
          { id: SESSION_ID, state: "pending", attributes, links: [] },
          { status: 201 },
        ),
      ]);

      const result = await createSession(scripted.client, context());

      assert.ok(result.ok, "a session without a usable timeout was rejected");
      assert.equal(result.value.inactiveTimeoutSeconds, undefined);
    }
  });

  it("describes a malformed response that arrived without a content type", async () => {
    const scripted = fake([
      {
        ok: true,
        value: {
          status: 201,
          notModified: false,
          text: "",
          body: { state: "pending" },
        },
      },
    ]);

    const result = await createSession(scripted.client, context());

    assert.ok(!result.ok, "a body with no id was accepted as a session");
    assert.ok(
      result.problem.code === "response-malformed",
      "a body with no id was not reported as malformed",
    );
    assert.ok(
      result.problem.detail.includes("an unknown type"),
      "the failure did not say what the response claimed to be",
    );
  });

  it("passes a transport-level failure through untouched", async () => {
    const scripted = fake([
      {
        ok: false,
        reason: "not permitted",
        problem: { code: "forbidden", error: { status: 403 } },
      },
    ]);

    const result = await createSession(scripted.client, context());

    assert.ok(!result.ok, "a 403 was reported as success");
    assert.equal(result.problem.code, "forbidden");
  });

  it("passes the caller's signal to the request", async () => {
    const controller = new AbortController();
    const scripted = fake([ok(sessionBody(), { status: 201 })]);

    await createSession(scripted.client, context(), {
      signal: controller.signal,
    });

    assert.equal(only(scripted.requests).signal, controller.signal);
  });
});

describe("readSessionState", () => {
  it("asks the server to hold the connection, and outlives the wait", async () => {
    const scripted = fake([plain("pending", { etag: NEXT_ETAG })]);

    await readSessionState(scripted.client, session(), { ifNoneMatch: ETAG });

    const request = only(scripted.requests);
    assert.equal(
      request.link.href,
      `${SESSION_PATH}/state?wait=${String(DEFAULT_WAIT_SECONDS)}`,
    );
    assert.equal(request.ifNoneMatch, ETAG);
    // The client's default timeout is 30s. A caller that let it stand while
    // asking the server for a 60s wait would abort every poll just before it
    // was answered, and the failure would read as an unreachable service.
    assert.equal(
      request.timeoutMs,
      (DEFAULT_WAIT_SECONDS + WAIT_MARGIN_SECONDS) * 1000,
    );
  });

  it("keeps a query the deployment already put on the href", async () => {
    // Finding 21 shows hrefs on both sides of this: `state` has no query and
    // `cancel` arrives as `…/state?value=canceled`. Assuming either separator
    // would be wrong half the time.
    const scripted = fake([plain("pending")]);
    const stateful = session({
      links: sessionLinks({ state: `${SESSION_PATH}/state?value=canceled` }),
    });

    await readSessionState(scripted.client, stateful, { waitSeconds: 5 });

    assert.equal(
      only(scripted.requests).link.href,
      `${SESSION_PATH}/state?value=canceled&wait=5`,
    );
  });

  it("answers a 304 with a reading that carries no state at all", async () => {
    const scripted = fake([unchanged()]);

    const result = await readSessionState(scripted.client, session(), {
      ifNoneMatch: ETAG,
    });

    assert.ok(result.ok, "a 304 was reported as a failure");
    // `deepEqual` rather than a property check: the absence is the contract.
    // A caller cannot re-fetch a state it was not handed.
    assert.deepEqual(result.value, { changed: false });
  });

  it("trims the plain-text state and carries the new validator", async () => {
    const scripted = fake([plain("idle\n", { etag: NEXT_ETAG })]);

    const result = await readSessionState(scripted.client, session());

    assert.ok(result.ok, "a state reading was reported as a failure");
    assert.deepEqual(result.value, {
      changed: true,
      state: "idle",
      etag: NEXT_ETAG,
    });
  });

  it("reports an empty state resource as malformed", async () => {
    const scripted = fake([plain("   ")]);

    const result = await readSessionState(scripted.client, session());

    assert.ok(!result.ok, "an empty state was read as a state");
    assert.equal(result.problem.code, "response-malformed");
  });

  it("reads a 404 as the session being gone", async () => {
    const scripted = fake([rejected(404)]);

    const result = await readSessionState(scripted.client, session());

    assert.ok(!result.ok, "a 404 was reported as success");
    assert.equal(result.problem.code, "session-gone");
  });

  it("leaves a 401 as unauthorized", async () => {
    // The deviation from what `problems.ts` originally said. Relabelling this
    // would send a caller round a loop creating sessions with a dead token.
    const scripted = fake([unauthorized()]);

    const result = await readSessionState(scripted.client, session());

    assert.ok(!result.ok, "a 401 was reported as success");
    assert.equal(result.problem.code, "unauthorized");
  });

  it("reports a session with no state link, naming the session", async () => {
    const scripted = fake([]);

    const result = await readSessionState(
      scripted.client,
      session({ links: [] }),
    );

    assert.ok(!result.ok, "a session with no state link was polled anyway");
    assert.ok(result.problem.code === "link-missing");
    assert.equal(result.problem.rel, "state");
    assert.ok(
      result.problem.resource.includes(SESSION_ID),
      "the failure did not say which session was missing the link",
    );
    assert.equal(scripted.requests.length, 0);
  });
});

describe("waitWhilePending", () => {
  it("costs nothing when the session is already past pending", async () => {
    const scripted = fake([]);

    const result = await waitWhilePending(
      scripted.client,
      session({ state: "idle" }),
    );

    assert.ok(result.ok, "an idle session was reported as a failure");
    assert.equal(result.value.state, "idle");
    assert.equal(scripted.requests.length, 0);
  });

  it("keeps the same validator across unchanged windows", async () => {
    const scripted = fake([
      unchanged(),
      unchanged(),
      plain("idle", { etag: NEXT_ETAG }),
    ]);

    const result = await waitWhilePending(scripted.client, session());

    assert.ok(
      result.ok,
      "a session that became idle was reported as a failure",
    );
    assert.equal(result.value.state, "idle");
    assert.equal(result.value.etag, NEXT_ETAG);
    assert.equal(scripted.requests.length, 3);
    // A 304 changes nothing, so the next window must present the same ETag.
    assert.equal(at(scripted.requests, 2).ifNoneMatch, ETAG);
  });

  it("carries a new validator forward when the state changed but is still pending", async () => {
    const scripted = fake([
      plain("pending", { etag: NEXT_ETAG }),
      plain("running"),
    ]);

    const result = await waitWhilePending(scripted.client, session());

    assert.ok(result.ok, "a running session was reported as a failure");
    // Not judged. `running` is not `pending`, and whether that is good news is
    // the caller's call, not this module's.
    assert.equal(result.value.state, "running");
    assert.equal(at(scripted.requests, 1).ifNoneMatch, NEXT_ETAG);
  });

  it("gives up after a bounded number of windows", async () => {
    const scripted = fake(() => unchanged());

    const result = await waitWhilePending(scripted.client, session(), {
      waitSeconds: 10,
    });

    assert.ok(!result.ok, "an endlessly pending session was reported as ready");
    assert.ok(result.problem.code === "session-not-ready");
    assert.equal(result.problem.state, "pending");
    assert.equal(result.problem.seconds, MAX_WAIT_WINDOWS * 10);
    // The bound is the only thing standing between us and a hot loop against a
    // deployment that declines to honour `wait`.
    assert.equal(scripted.requests.length, MAX_WAIT_WINDOWS);
  });

  it("stops at the first failure rather than using up its windows", async () => {
    const scripted = fake([unchanged(), rejected(404)]);

    const result = await waitWhilePending(scripted.client, session());

    assert.ok(!result.ok, "a failed poll was reported as success");
    assert.equal(result.problem.code, "session-gone");
    assert.equal(scripted.requests.length, 2);
  });
});

describe("cancelSession", () => {
  it("follows the cancel link exactly as the deployment sent it", async () => {
    const scripted = fake([noContent()]);

    const result = await cancelSession(scripted.client, session());

    assert.ok(result.ok, "a cancel was reported as a failure");
    const request = only(scripted.requests);
    assert.equal(request.link.method, "PUT");
    assert.equal(request.link.href, `${SESSION_PATH}/state?value=canceled`);
    // No ETag, so there is no 412, so there is nothing to recurse over —
    // upstream sends one here and retries itself without bound on the refusal.
    assert.equal(request.etag, undefined);
    assert.equal(request.body, undefined);
  });

  it("reads a 404 as the session being gone", async () => {
    const scripted = fake([rejected(404)]);

    const result = await cancelSession(scripted.client, session());

    assert.ok(!result.ok, "a 404 was reported as success");
    assert.equal(result.problem.code, "session-gone");
  });

  it("passes the caller's signal to the request", async () => {
    const controller = new AbortController();
    const scripted = fake([noContent()]);

    await cancelSession(scripted.client, session(), {
      signal: controller.signal,
    });

    assert.equal(only(scripted.requests).signal, controller.signal);
  });

  it("reports a session with no cancel link", async () => {
    const scripted = fake([]);

    const result = await cancelSession(scripted.client, session({ links: [] }));

    assert.ok(!result.ok, "a session with no cancel link was cancelled anyway");
    assert.ok(result.problem.code === "link-missing");
    assert.equal(result.problem.rel, "cancel");
  });
});

describe("deleteSession", () => {
  it("follows the delete link with no If-Match", async () => {
    const scripted = fake([noContent()]);

    const result = await deleteSession(scripted.client, session());

    assert.ok(result.ok, "a teardown was reported as a failure");
    const request = only(scripted.requests);
    assert.equal(request.link.method, "DELETE");
    assert.equal(request.link.href, SESSION_PATH);
    // Finding 18: 204 with no validator. A stale one would 412 and leave a SAS
    // process running until the 900-second timeout reaped it.
    assert.equal(request.etag, undefined);
  });

  it("treats a session that is already gone as torn down", async () => {
    // This runs on the failure path of something else more often than not, and
    // a second, misleading error underneath the real one helps nobody.
    const scripted = fake([rejected(404)]);

    const result = await deleteSession(scripted.client, session());

    assert.ok(
      result.ok,
      "an already-deleted session was reported as a failure",
    );
  });

  it("still reports a refusal that is not a 404", async () => {
    const scripted = fake([rejected(403)]);

    const result = await deleteSession(scripted.client, session());

    assert.ok(!result.ok, "a 403 on teardown was swallowed");
    assert.equal(result.problem.code, "compute-rejected");
  });

  it("passes the caller's signal to the request", async () => {
    // Teardown is cancellable too: 2a-ii puts a `CancellationToken` behind this,
    // and a window closing should not be blocked by a `DELETE` nobody is waiting
    // on any more.
    const controller = new AbortController();
    const scripted = fake([noContent()]);

    await deleteSession(scripted.client, session(), {
      signal: controller.signal,
    });

    assert.equal(only(scripted.requests).signal, controller.signal);
  });

  it("reports a session with no delete link", async () => {
    const scripted = fake([]);

    const result = await deleteSession(scripted.client, session({ links: [] }));

    assert.ok(!result.ok, "a session with no delete link was deleted anyway");
    assert.ok(result.problem.code === "link-missing");
    assert.equal(result.problem.rel, "delete");
    assert.equal(scripted.requests.length, 0);
  });
});

describe("asSessionGone", () => {
  it("rewrites a 404, keeping the error for the log", () => {
    const failure = {
      ok: false as const,
      reason: "the compute service answered HTTP 404",
      problem: {
        code: "compute-rejected" as const,
        error: { status: 404, errorCode: 5837, correlator: "cca95fbe" },
      },
    };

    const result = asSessionGone(failure);

    assert.ok(result.problem.code === "session-gone");
    // The correlator is the one identifier SAS support can act on, so it has to
    // survive the relabelling.
    assert.equal(result.problem.error.correlator, "cca95fbe");
  });

  it("leaves every other status alone", () => {
    for (const status of [400, 403, 409, 500]) {
      const failure = {
        ok: false as const,
        reason: "rejected",
        problem: { code: "compute-rejected" as const, error: { status } },
      };
      assert.equal(
        asSessionGone(failure).problem.code,
        "compute-rejected",
        `HTTP ${String(status)} was read as a missing session`,
      );
    }
  });

  it("leaves a 401 alone", () => {
    const failure = {
      ok: false as const,
      reason: "the access token is no longer active",
      problem: {
        code: "unauthorized" as const,
        problem: { code: "session-expired" as const },
      },
    };

    assert.equal(asSessionGone(failure).problem.code, "unauthorized");
  });
});
