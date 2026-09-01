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
  cancelJob,
  type ComputeJob,
  createJob,
  DEFAULT_LOG_LIMIT,
  DEFAULT_LOG_TIMEOUT_SECONDS,
  followLogPage,
  isTerminal,
  JOB_NAME,
  readJobState,
  readLogPage,
  TERMINAL_STATES,
} from "../../src/compute/job";
import { type Link } from "../../src/compute/links";
import {
  type ComputeSession,
  WAIT_MARGIN_SECONDS,
} from "../../src/compute/session";
import { readJsonFixture } from "../helpers/fixtures";

/**
 * Submitting a job, asking whether it finished, and reading a page of its log.
 *
 * Several of these exist because of something measured rather than something
 * imagined, and each names the finding it stands on.
 *
 * **The blank lines.** Six of the twenty-one lines in a real log are empty or
 * whitespace (finding 52). Every other reader in this codebase drops empty
 * strings — `readLinks` and `readContext` both do — so the fixture test asserts
 * the count and the blanks, because the reflex that is right there is wrong here.
 *
 * **The terminal set.** Upstream's `isDone` returns `true` when the job is *not*
 * done. Two tests pin the orientation, and a third pins the membership, because
 * a state quietly dropped from the list is a stream that never ends.
 *
 * **The `timeout`.** ADR-0017 makes it structural: a log poll without it returns
 * immediately every time and the loop above becomes a request storm. It is
 * asserted present in the query, asserted to outlive the client's own timeout,
 * and asserted to be refused when it is not a positive number.
 *
 * **The absent `next`.** A drain keys on the link being gone, never on a short
 * page — the last page of a real traversal was full (finding 51).
 *
 * **The cursor.** `advance` is the number of items the deployment sent and
 * `lines` is what parsed out of them, and three tests hold the two apart. They
 * are the same number on every real page; where they are not, advancing by the
 * wrong one duplicates a line or, on a one-item page, stops advancing at all.
 */

const SESSION_ID = "3f2b1c0a-7d4e-4a91-b6c2-1e5f8a0d9c34-ses0000";
const JOB_ID = "A1B2C3D4-E5F6-4A5B-8C9D-0E1F2A3B4C5D";
const SESSION_PATH = `/compute/sessions/${SESSION_ID}`;
const JOB_PATH = `${SESSION_PATH}/jobs/${JOB_ID}`;

/** The one session relation this module uses, as finding 21 sends it. */
function sessionLinks(): readonly Link[] {
  return [
    {
      method: "POST",
      rel: "execute",
      href: `${SESSION_PATH}/jobs`,
      type: "application/vnd.sas.compute.job.request",
      responseType: "application/vnd.sas.compute.job",
    },
  ];
}

function session(links?: readonly Link[]): ComputeSession {
  return {
    id: SESSION_ID,
    state: "idle",
    links: links ?? sessionLinks(),
  };
}

/** The job relations this module navigates by, as finding 46 sends them. */
function jobLinks(init?: { log?: string }): readonly Link[] {
  return [
    { method: "GET", rel: "self", href: JOB_PATH },
    { method: "GET", rel: "state", href: `${JOB_PATH}/state` },
    {
      method: "GET",
      rel: "log",
      href: init?.log ?? `${JOB_PATH}/log`,
      type: "application/vnd.sas.collection",
    },
  ];
}

function job(links?: readonly Link[]): ComputeJob {
  return { id: JOB_ID, state: "running", links: links ?? jobLinks() };
}

function ok(
  body: unknown,
  init?: {
    status?: number;
    contentType?: string;
    location?: string;
    etag?: string;
  },
): ComputeResult<ComputeResponse> {
  return {
    ok: true,
    value: {
      status: init?.status ?? 200,
      notModified: false,
      ...(init?.location === undefined ? {} : { location: init.location }),
      ...(init?.etag === undefined ? {} : { etag: init.etag }),
      contentType: init?.contentType ?? "application/vnd.sas.compute.job+json",
      text: JSON.stringify(body),
      body,
    },
  };
}

/** The `text/plain` state resource — a bare word, no trailing newline. */
function plain(text: string): ComputeResult<ComputeResponse> {
  return {
    ok: true,
    value: {
      status: 200,
      notModified: false,
      contentType: "text/plain;charset=UTF-8",
      text,
      // Not JSON, so the client leaves this unset.
      body: undefined,
    },
  };
}

/**
 * A 2xx that named no media type and carried a JSON `null`.
 *
 * Not a shape any Viya resource has produced — it is what an intermediary
 * answers when it decides to have an opinion about the request.
 */
function untyped(status: number): ComputeResult<ComputeResponse> {
  return {
    ok: true,
    value: { status, notModified: false, text: "null", body: null },
  };
}

/** A log collection page, with or without the relation that continues it. */
function logPage(
  items: readonly unknown[],
  init?: { next?: string },
): ComputeResult<ComputeResponse> {
  const body = {
    // A live running total of what the job has produced, **not** this page's
    // size (finding 47) — deliberately unrelated to `items.length` here so that
    // nothing downstream can grow a dependency on the two agreeing. Nothing
    // reads it.
    count: 21,
    items,
    links: [
      { rel: "self", method: "GET", href: `${JOB_PATH}/log` },
      ...(init?.next === undefined
        ? []
        : [{ rel: "next", method: "GET", href: init.next }]),
    ],
  };
  return ok(body, { contentType: "application/vnd.sas.collection+json" });
}

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

/** One query parameter of a request's href, or `undefined`. */
function parameter(request: ComputeRequest, name: string): string | undefined {
  const query = request.link.href.split("?")[1];
  if (query === undefined) return undefined;
  for (const pair of query.split("&")) {
    const [key, value] = pair.split("=");
    if (key === name) return value ?? "";
  }
  return undefined;
}

describe("createJob", () => {
  it("reads the representation a real deployment sent", async () => {
    const payload = readJsonFixture("viya4", "compute-job-created.json");
    const scripted = fake([ok(payload, { status: 201, location: JOB_PATH })]);

    const result = await createJob(scripted.client, session(), ["run;"]);

    assert.ok(result.ok, "a created job was reported as a failure");
    assert.equal(result.value.id, JOB_ID);
    // `pending` at create (finding 46) — never a terminal state, so a caller
    // that reads this response hoping to be finished has to poll anyway.
    assert.equal(result.value.state, "pending");
    // Ten relations. If this number drops, something a later call navigates by
    // is being filtered out before anyone looks for it.
    assert.equal(result.value.links.length, 10);
  });

  it("keeps the explicit null media type on cancel and delete", async () => {
    const payload = readJsonFixture("viya4", "compute-job-created.json");
    const scripted = fake([ok(payload, { status: 201 })]);

    const result = await createJob(scripted.client, session(), ["run;"]);

    assert.ok(result.ok);
    // Finding 46, and the reason `Link.type` has a `null` arm at all. A session's
    // equivalents *omit* the key; a job's send it as null, and a reader that
    // treats one as valid and the other as a shape change is wrong about one of
    // them. It also had a consequence outside the code: `via.type` in
    // `contracts/viya4.yaml` could not describe either relation until slice
    // 2c-ii taught the contract checker to accept a `type` that is a media type
    // or null — where the session's *absent* key and the job's explicit null are
    // both written `type: null`.
    const cancel = result.value.links.find((link) => link.rel === "cancel");
    const remove = result.value.links.find((link) => link.rel === "delete");
    assert.equal(cancel?.type, null);
    assert.equal(remove?.type, null);
  });

  it("sends the statements verbatim under the execute link", async () => {
    const scripted = fake([ok({ id: JOB_ID, state: "pending" })]);
    const statements = ["data _null_;", '  put "x";', "run;"];

    await createJob(scripted.client, session(), statements);

    const request = only(scripted.requests);
    assert.equal(request.link.rel, "execute");
    assert.equal(request.link.href, `${SESSION_PATH}/jobs`);
    // The body measured producing a 201: a name and the statements, and no
    // `version` — a session request carries one, this does not, and neither is
    // the other's business.
    assert.deepEqual(request.body, { name: JOB_NAME, code: statements });
  });

  it("does not read the statements it was given", async () => {
    // ADR-0017 part 2. Whatever 3a eventually composes — `proc python
    // infile=<fileref>;` per ADR-0014 — arrives here as opaque text, and this
    // test fails the day something starts inspecting it.
    const scripted = fake([ok({ id: JOB_ID, state: "pending" })]);
    const statements = ["%let x = 1;", "proc python infile=code;", "run;"];

    await createJob(scripted.client, session(), statements);

    assert.deepEqual(
      (only(scripted.requests).body as { code: readonly string[] }).code,
      statements,
    );
  });

  it("does not follow the Location header", async () => {
    // The body already carries the links. Following the header would be a
    // second round trip for a representation we were just handed.
    const scripted = fake([
      ok({ id: JOB_ID, state: "pending" }, { status: 201, location: JOB_PATH }),
    ]);

    await createJob(scripted.client, session(), ["run;"]);

    assert.equal(scripted.requests.length, 1);
  });

  it("refuses a job with no statements", async () => {
    const scripted = fake([]);

    await assert.rejects(
      async () => await createJob(scripted.client, session(), []),
      TypeError,
    );
    assert.equal(scripted.requests.length, 0);
  });

  it("reports a session that does not offer the execute relation", async () => {
    const scripted = fake([]);

    const result = await createJob(scripted.client, session([]), ["run;"]);

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "link-missing");
    // The noun matters: `execute` is missing from a session, not from a job.
    assert.match(result.reason, /compute session/);
    assert.equal(scripted.requests.length, 0);
  });

  it("reads a 404 as a session that is gone", async () => {
    // Finding 53: once the session dies, everything under it answers 404 with a
    // message naming the session rather than the job.
    const scripted = fake([rejected(404)]);

    const result = await createJob(scripted.client, session(), ["run;"]);

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "session-gone");
  });

  it("reports a 201 that is not a job, without quoting it", async () => {
    const scripted = fake([ok({ nothing: "useful" }, { status: 201 })]);

    const result = await createJob(scripted.client, session(), ["run;"]);

    assert.ok(!result.ok);
    assert.ok(result.problem.code === "response-malformed");
    // The body is described, never quoted. Here it is two words of nonsense; on
    // the log reader it would be the user's own program output.
    assert.doesNotMatch(result.problem.detail, /useful/);
  });

  it("reports a 201 with an empty id or an empty state", async () => {
    // A present-but-empty field is the shape a partially-populated proxy
    // response takes, and it is the one that would survive a `typeof` test and
    // then be used as a path segment.
    for (const body of [
      { id: "", state: "pending" },
      { id: JOB_ID, state: "" },
    ]) {
      const scripted = fake([ok(body, { status: 201 })]);

      const result = await createJob(scripted.client, session(), ["run;"]);

      assert.ok(!result.ok, `${JSON.stringify(body)} was read as a job`);
      assert.equal(result.problem.code, "response-malformed");
    }
  });

  it("describes a reply that named no media type", async () => {
    const scripted = fake([untyped(201)]);

    const result = await createJob(scripted.client, session(), ["run;"]);

    assert.ok(!result.ok);
    assert.ok(result.problem.code === "response-malformed");
    // Says so rather than printing "undefined" at the user, and still says what
    // was asked and what came back.
    assert.match(result.problem.detail, /an unknown type/);
    assert.match(result.problem.detail, /201/);
  });

  it("hands the caller's signal to the request", async () => {
    // 2c-ii's cancellation is this signal and nothing else. A function that
    // accepted one and dropped it would make cancelling appear to work while the
    // request it was meant to stop ran to completion.
    const scripted = fake([ok({ id: JOB_ID, state: "pending" })]);
    const controller = new AbortController();

    await createJob(scripted.client, session(), ["run;"], {
      signal: controller.signal,
    });

    assert.equal(only(scripted.requests).signal, controller.signal);
  });
});

describe("isTerminal", () => {
  it("keeps all five states a job does not come back from", () => {
    // Membership, pinned. `canceled` is now observed live too (Phase 4's
    // Finding 76 — `cancelJob` reaching a fresh ETag in time reads it back,
    // lower-case). `done` and `warning` alone remain kept on trust: an extra
    // member costs nothing, a missing one is a poll loop with no exit.
    assert.deepEqual(
      new Set(TERMINAL_STATES),
      new Set(["done", "canceled", "error", "warning", "completed"]),
    );
    assert.equal(TERMINAL_STATES.length, 5);
  });

  it("answers true for a finished job", () => {
    // Orientation. Upstream's `isDone` tests `indexOf(state) === -1` and so
    // answers this exact question backwards.
    for (const state of TERMINAL_STATES) {
      assert.ok(isTerminal(state), `${state} should be terminal`);
    }
  });

  it("answers false for a job that is still going", () => {
    for (const state of ["pending", "running", "idle"]) {
      assert.ok(!isTerminal(state), `${state} should not be terminal`);
    }
  });

  it("ignores case and surrounding whitespace", () => {
    // Cheap, because every state observed is lower-case and unpadded. Here
    // because the failure it prevents is a stream that never ends.
    assert.ok(isTerminal("Completed"));
    assert.ok(isTerminal(" error\n"));
  });
});

describe("readJobState", () => {
  it("reads the bare word the state resource sends", async () => {
    const scripted = fake([plain("completed")]);

    const result = await readJobState(scripted.client, job());

    assert.ok(result.ok);
    assert.equal(result.value, "completed");
  });

  it("trims a state a deployment padded", async () => {
    const scripted = fake([plain("error\n")]);

    const result = await readJobState(scripted.client, job());

    assert.ok(result.ok);
    assert.equal(result.value, "error");
  });

  it("asks unconditionally, with no wait and no validator", async () => {
    // The two together are the point. `wait` is inert without an
    // `If-None-Match` (finding 28), the job state's expiry has never been
    // observed at all (finding 49), and the pump only asks when it already
    // suspects the answer — so a held connection is neither available nor
    // wanted. No 304 arm can exist here, which is what keeps upstream's
    // self-recursing `getState()` from having a place to grow.
    const scripted = fake([plain("running")]);

    await readJobState(scripted.client, job());

    const request = only(scripted.requests);
    assert.equal(request.ifNoneMatch, undefined);
    assert.equal(request.etag, undefined);
    assert.doesNotMatch(request.link.href, /wait=/);
  });

  it("reports an empty state resource", async () => {
    const scripted = fake([plain("   ")]);

    const result = await readJobState(scripted.client, job());

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "response-malformed");
  });

  it("reads a 404 as a session that is gone", async () => {
    const scripted = fake([rejected(404)]);

    const result = await readJobState(scripted.client, job());

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "session-gone");
  });

  it("hands the caller's signal to the request", async () => {
    const scripted = fake([plain("running")]);
    const controller = new AbortController();

    await readJobState(scripted.client, job(), { signal: controller.signal });

    assert.equal(only(scripted.requests).signal, controller.signal);
  });

  it("reports a job that does not offer the state relation", async () => {
    const scripted = fake([]);

    const result = await readJobState(scripted.client, job([]));

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "link-missing");
    assert.match(result.reason, /compute job/);
  });
});

describe("readLogPage", () => {
  it("reads the log a real deployment sent, blanks and all", async () => {
    const payload = readJsonFixture("viya4", "compute-job-log-page.json");
    const scripted = fake([
      ok(payload, { contentType: "application/vnd.sas.collection+json" }),
    ]);

    const result = await readLogPage(scripted.client, job(), { start: 0 });

    assert.ok(result.ok);
    assert.equal(result.value.lines.length, 21);
    // Nothing was dropped, so the cursor moves by the same number.
    assert.equal(result.value.advance, 21);
    // The four types finding 52 saw, and nothing here narrows them to an enum.
    assert.deepEqual(
      new Set(result.value.lines.map((line) => line.type)),
      new Set(["source", "note", "normal", "error"]),
    );
    // Six blank or whitespace-only lines, kept. Dropping empty strings is the
    // reflex everywhere else in this codebase and it would delete the log's
    // vertical spacing here.
    assert.equal(
      result.value.lines.filter((line) => line.line.trim() === "").length,
      6,
    );
    // The diagnostic is interleaved with the source echo rather than appended
    // after it: it follows the `set` that provoked it and precedes that step's
    // `run;`, so a step's source lines are not contiguous.
    assert.equal(result.value.lines[12]?.type, "error");
    assert.equal(result.value.lines[13]?.type, "source");
    // A full read of a finished log carries no `next`, which is what ends a drain.
    assert.equal(result.value.next, undefined);
  });

  it("sends the cursor, the page size and the timeout", async () => {
    const scripted = fake([logPage([])]);

    await readLogPage(scripted.client, job(), { start: 9 });

    const request = only(scripted.requests);
    assert.equal(parameter(request, "start"), "9");
    assert.equal(parameter(request, "limit"), String(DEFAULT_LOG_LIMIT));
    // ADR-0017: never optional. Omitting it is a request storm that reads as
    // correct code.
    assert.equal(
      parameter(request, "timeout"),
      String(DEFAULT_LOG_TIMEOUT_SECONDS),
    );
  });

  it("outlives the wait it asked the deployment to hold", async () => {
    // A client timeout shorter than the server's wait aborts every poll a moment
    // before it would have answered, and the failure reads as an unreachable
    // deployment rather than as a badly chosen number.
    const scripted = fake([logPage([])]);

    await readLogPage(scripted.client, job(), { start: 0, timeoutSeconds: 30 });

    assert.equal(
      only(scripted.requests).timeoutMs,
      (30 + WAIT_MARGIN_SECONDS) * 1000,
    );
  });

  it("keeps a query the deployment already put on the href", async () => {
    // A job's `cancel` arrives as `…/state?value=canceled` (finding 46), so a
    // builder that assumes `?` is wrong on the resources that have one. The
    // separator is chosen by looking.
    const scripted = fake([logPage([])]);

    await readLogPage(
      scripted.client,
      job(jobLinks({ log: `${JOB_PATH}/log?nocache=1` })),
      { start: 0 },
    );

    const { href } = only(scripted.requests).link;
    assert.match(href, /\?nocache=1&start=0&/);
  });

  it("treats an empty page as nothing yet, not as an error", async () => {
    // Expiry is a 200 with an empty array, never a 304 (finding 49). A consumer
    // that read this as end-of-log would truncate every quiet job.
    const scripted = fake([logPage([])]);

    const result = await readLogPage(scripted.client, job(), { start: 12 });

    assert.ok(result.ok);
    assert.deepEqual(result.value.lines, []);
    assert.equal(result.value.next, undefined);
  });

  it("hands back the relation that continues the drain", async () => {
    const scripted = fake([
      logPage([{ line: "a", type: "note", version: 1 }], {
        next: `${JOB_PATH}/log?start=3&limit=3`,
      }),
    ]);

    const result = await readLogPage(scripted.client, job(), { start: 0 });

    assert.ok(result.ok);
    assert.equal(result.value.next?.href, `${JOB_PATH}/log?start=3&limit=3`);
  });

  it("keeps a line whose type is missing or not a string", async () => {
    // The vocabulary is a floor, not a closed set. Dropping the line would lose
    // text the user wrote; inventing a type would put a word into a vocabulary
    // the server owns.
    const scripted = fake([
      logPage([{ line: "no type here" }, { line: "odd", type: 7 }]),
    ]);

    const result = await readLogPage(scripted.client, job(), { start: 0 });

    assert.ok(result.ok);
    assert.deepEqual(result.value.lines, [
      { line: "no type here" },
      { line: "odd" },
    ]);
  });

  it("drops an item that carries no line at all", async () => {
    const scripted = fake([
      logPage([{ type: "note" }, "not an object", { line: "kept" }]),
    ]);

    const result = await readLogPage(scripted.client, job(), { start: 0 });

    assert.ok(result.ok);
    assert.deepEqual(result.value.lines, [{ line: "kept" }]);
    // The cursor still moves by three. This is the assertion that separates a
    // dropped line from a lost position: advancing by `lines.length` would put
    // the next read back on "kept" and show it twice.
    assert.equal(result.value.advance, 3);
  });

  it("advances the cursor by what was sent, not by what parsed", async () => {
    // The degenerate case, and the reason `advance` is on the page at all: one
    // item, dropped. A caller advancing by `lines.length` would re-request the
    // same `start`, which the deployment answers immediately because there *is*
    // an item there — a busy-wait reached through the parser rather than through
    // a missing `timeout`.
    const scripted = fake([logPage([{ type: "note" }])]);

    const result = await readLogPage(scripted.client, job(), { start: 4 });

    assert.ok(result.ok);
    assert.deepEqual(result.value.lines, []);
    assert.equal(result.value.advance, 1);
  });

  it("advances by zero on the empty page that means nothing yet", async () => {
    const scripted = fake([logPage([])]);

    const result = await readLogPage(scripted.client, job(), { start: 4 });

    assert.ok(result.ok);
    assert.equal(result.value.advance, 0);
  });

  it("keeps the link's media types when it adds the query", async () => {
    // `log` and `logAsText` are the same href and differ only in `rel` and media
    // type (finding 46), so the `Accept` the client derives from the link is the
    // only thing deciding which of the two comes back. Rebuilding the link from
    // its href instead of spreading it would drop that, ask for nothing in
    // particular, and get `text/plain` — which surfaces as a malformed response
    // rather than as anything a reader would recognise as this mistake.
    const scripted = fake([logPage([])]);

    await readLogPage(scripted.client, job(), { start: 0 });

    const { link } = only(scripted.requests);
    assert.equal(link.rel, "log");
    assert.equal(link.method, "GET");
    assert.equal(link.type, "application/vnd.sas.collection");
  });

  it("reports a reply that is not a collection", async () => {
    // The most likely cause is the wrong media type: `log` and `logAsText` are
    // the same href, so a `text/plain` reply arrives with no parsed body rather
    // than as an empty collection.
    const scripted = fake([plain("1    data _null_;")]);

    const result = await readLogPage(scripted.client, job(), { start: 0 });

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "response-malformed");
  });

  it("reads a 404 as a session that is gone", async () => {
    const scripted = fake([rejected(404)]);

    const result = await readLogPage(scripted.client, job(), { start: 0 });

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "session-gone");
  });

  it("hands the caller's signal to the request", async () => {
    // The one that matters most: this is the request that is deliberately left
    // hanging for ten seconds, so it is the one a cancelling user is waiting on.
    const scripted = fake([logPage([])]);
    const controller = new AbortController();

    await readLogPage(scripted.client, job(), {
      start: 0,
      signal: controller.signal,
    });

    assert.equal(only(scripted.requests).signal, controller.signal);
  });

  it("reports a job that does not offer the log relation", async () => {
    const scripted = fake([]);

    const result = await readLogPage(scripted.client, job([]), { start: 0 });

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "link-missing");
  });

  it("refuses a cursor or a window that is not a whole number", async () => {
    const scripted = fake([]);

    for (const options of [
      { start: -1 },
      { start: 1.5 },
      { start: 0, limit: 0 },
      // The one the ADR is about: a timeout computed to zero is the busy-wait
      // wearing a disguise, so it is refused rather than sent.
      { start: 0, timeoutSeconds: 0 },
      { start: 0, timeoutSeconds: Number.NaN },
    ]) {
      await assert.rejects(
        async () => await readLogPage(scripted.client, job(), options),
        TypeError,
        `${JSON.stringify(options)} should have been refused`,
      );
    }
    assert.equal(scripted.requests.length, 0);
  });
});

describe("followLogPage", () => {
  it("follows the link exactly as sent", async () => {
    // The deployment composed this href, cursor and page size included. ADR-0010
    // says follow it; rebuilding it here would be easy and wrong.
    const next: Link = {
      rel: "next",
      method: "GET",
      href: `${JOB_PATH}/log?start=3&limit=3`,
      type: "application/vnd.sas.collection",
    };
    const scripted = fake([logPage([{ line: "b", type: "note", version: 1 }])]);
    const controller = new AbortController();

    const result = await followLogPage(scripted.client, next, {
      signal: controller.signal,
    });

    assert.ok(result.ok);
    assert.deepEqual(result.value.lines, [{ line: "b", type: "note" }]);
    const request = only(scripted.requests);
    assert.equal(request.link.href, `${JOB_PATH}/log?start=3&limit=3`);
    assert.equal(request.signal, controller.signal);
    // No second timeout on a drain: a terminal job answers immediately whatever
    // the query says (finding 50), so the client's ordinary bound is the right one.
    assert.equal(request.timeoutMs, undefined);
  });
});

describe("cancelJob", () => {
  /** The `cancel` relation as finding 46 sends it: query attached, type null. */
  const cancel: Link = {
    rel: "cancel",
    method: "PUT",
    href: `${JOB_PATH}/state?value=canceled`,
    type: null,
  };

  /** The fresh self-GET `cancelJob` now makes before its `PUT` (Finding 75) —
   * a job's own representation, carrying whatever `ETag` this reply names.
   * The body's content is never read for it; only `.etag` is. */
  function selfWithEtag(etag: string): ComputeResult<ComputeResponse> {
    return ok({ id: JOB_ID, state: "running", links: jobLinks() }, { etag });
  }

  it("reads a fresh ETag off the self relation and sends it as If-Match on the cancel PUT (Finding 75)", async () => {
    const scripted = fake([selfWithEtag('"kprhurecyg"'), plain("canceled")]);
    const controller = new AbortController();

    const result = await cancelJob(
      scripted.client,
      job([...jobLinks(), cancel]),
      { signal: controller.signal },
    );

    assert.ok(result.ok, "an accepted cancel was reported as a failure");
    assert.equal(scripted.requests.length, 2);
    const [selfRequest, cancelRequest] = scripted.requests;
    assert.ok(selfRequest !== undefined && cancelRequest !== undefined);

    // The self GET, first — measured (Finding 75) to answer a different ETag
    // than the job's own create response carried a second earlier, so this
    // is read fresh rather than trusted from anywhere the caller might have
    // held one.
    assert.equal(selfRequest.link.href, JOB_PATH);
    assert.equal(selfRequest.link.method, "GET");
    assert.equal(selfRequest.signal, controller.signal);

    // Then the cancel, with the query the deployment composed left intact —
    // nothing here rebuilds it, and nothing appends to it, since this is one
    // of only two job hrefs that arrive with a query already on them — and
    // the fresh ETag from the self GET as `If-Match`.
    assert.equal(cancelRequest.link.href, `${JOB_PATH}/state?value=canceled`);
    assert.equal(cancelRequest.link.method, "PUT");
    assert.equal(cancelRequest.etag, '"kprhurecyg"');
    // A `PUT` whose entire payload is in the query carries no representation.
    assert.equal(cancelRequest.body, undefined);
    assert.equal(cancelRequest.signal, controller.signal);
  });

  it("reads a 404 on the self GET as the session having gone, without ever sending the cancel", async () => {
    // Finding 53: a `404` on a job resource cannot be told apart from a `404`
    // on a dead session by status alone, and the reading is only sound because
    // nothing in this extension deletes a job.
    const scripted = fake([rejected(404)]);

    const result = await cancelJob(
      scripted.client,
      job([...jobLinks(), cancel]),
    );

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "session-gone");
    assert.equal(scripted.requests.length, 1, "the cancel PUT must not fire");
  });

  it("reads a 404 on the cancel PUT itself as the session having gone", async () => {
    const scripted = fake([selfWithEtag('"kprhurecyg"'), rejected(404)]);

    const result = await cancelJob(
      scripted.client,
      job([...jobLinks(), cancel]),
    );

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "session-gone");
  });

  it("reports a malformed response when the self GET carries no ETag to cancel with", async () => {
    const scripted = fake([
      ok({ id: JOB_ID, state: "running", links: jobLinks() }),
    ]);

    const result = await cancelJob(
      scripted.client,
      job([...jobLinks(), cancel]),
    );

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "response-malformed");
    assert.equal(scripted.requests.length, 1, "the cancel PUT must not fire");
  });

  it("says which relation was missing rather than which job, for a missing cancel relation", async () => {
    const scripted = fake([]);

    const result = await cancelJob(scripted.client, job());

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "link-missing");
    assert.equal(scripted.requests.length, 0);
  });

  it("says which relation was missing for a missing self relation too", async () => {
    const scripted = fake([]);

    const result = await cancelJob(scripted.client, job([cancel]));

    assert.ok(!result.ok);
    assert.equal(result.problem.code, "link-missing");
    assert.equal(scripted.requests.length, 0);
  });
});
