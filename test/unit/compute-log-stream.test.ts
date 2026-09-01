// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  type ComputeClient,
  type ComputeRequest,
  type ComputeResponse,
  type ComputeResult,
} from "../../src/compute/client";
import { type ComputeJob } from "../../src/compute/job";
import { type Link } from "../../src/compute/links";
import {
  FAST_EMPTY_FRACTION,
  type LogEvent,
  type LogStreamOptions,
  MAX_DRAIN_PAGES,
  MAX_WINDOWS_WITHOUT_STATE_READ,
  streamJobLog,
} from "../../src/compute/logStream";

/**
 * The loop, and the seven ways it can be wrong.
 *
 * `job.ts` makes one request at a time and its tests can look at one request at a
 * time. This module keeps running between calls, so almost every test here is
 * about a *sequence*: which request came next, and what the module believed when
 * it chose it.
 *
 * **Nobody has to be listening.** Two tests never touch `events` at all. ADR-0015
 * says a caller may await `done` and ignore the output, and the obvious
 * implementation — an `async function*` — fails that silently, because a
 * generator does not run until something iterates it. A test that always consumed
 * would pass against the deadlock.
 *
 * **The state is the authority; the clock is only a hint.** A fast empty page asks
 * the state, a slow one does not, and neither of them ends the stream on its own
 * (findings 48 and 50). The counter tests are the safety net under that: a
 * deployment that never answers fast still gets asked, because termination cannot
 * be allowed to depend on a timing that was measured once.
 *
 * **The drain keys on `next`, never on a page's size.** A real 21-line log read at
 * `limit=3` ended on a *full* page with no `next` (finding 51), so the traversal
 * below deliberately mixes a full page, a short page and a full last one.
 *
 * **Neither loop may hang on a deployment that behaves unlike the probe.** Both
 * exits — a terminal job short-circuiting its poll, and the `next` relation going
 * away — are single observations on a single deployment, so both loops carry a
 * bound and both bounds are exercised here. A stream that never settles is the
 * worst failure this module has available to it, because the user is left
 * watching a spinner over a program that finished.
 *
 * **The cursor is the deployment's numbering.** A page holding an item with no
 * string `line` advances the cursor by more than it yields, and a reader that
 * advanced by what it yielded would re-read a line — or, on a one-item page, stop
 * advancing entirely and busy-wait.
 *
 * **Overflow has to be visible from both ends.** A consumer reading the stream
 * sees a marker at the hole; a caller that only awaits `done` sees a total. Either
 * one alone is a log that lies to somebody.
 *
 * **Cancelling is not the same as failing.** `cancellation.ts` keeps `cancelled`
 * out of `ComputeProblem` on purpose, so a cancelled run settles as a *success*
 * carrying `outcome: "cancelled"`, and the aborted poll's own failure — which
 * reads as an unreachable deployment — must not be what the caller is told. The
 * window that is easy to get wrong is the drain: the job is over there but `done`
 * has not settled, and a cancel arriving then must send nothing at all.
 */

const SESSION_ID = "3f2b1c0a-7d4e-4a91-b6c2-1e5f8a0d9c34-ses0000";
const JOB_ID = "A1B2C3D4-E5F6-4A5B-8C9D-0E1F2A3B4C5D";
const JOB_PATH = `/compute/sessions/${SESSION_ID}/jobs/${JOB_ID}`;

/** The four job relations this module navigates by, as finding 46 sends them. */
function jobLinks(): readonly Link[] {
  return [
    { method: "GET", rel: "self", href: JOB_PATH },
    { method: "GET", rel: "state", href: `${JOB_PATH}/state` },
    {
      method: "GET",
      rel: "log",
      href: `${JOB_PATH}/log`,
      type: "application/vnd.sas.collection",
    },
    // Fully formed, query string included, and `type` explicitly null.
    { method: "PUT", rel: "cancel", href: `${JOB_PATH}/state?value=canceled` },
  ];
}

function job(links?: readonly Link[]): ComputeJob {
  return { id: JOB_ID, state: "running", links: links ?? jobLinks() };
}

type Reply = ComputeResult<ComputeResponse>;

/** A log collection page, with or without the relation that continues it. */
function page(items: readonly unknown[], init?: { next?: string }): Reply {
  return {
    ok: true,
    value: {
      status: 200,
      notModified: false,
      contentType: "application/vnd.sas.collection+json",
      text: "",
      body: {
        // A running total of the whole job, not this page (finding 47). Nothing
        // reads it, and it is deliberately unrelated to `items.length` here.
        count: 99,
        items,
        links: [
          { rel: "self", method: "GET", href: `${JOB_PATH}/log` },
          ...(init?.next === undefined
            ? []
            : [{ rel: "next", method: "GET", href: init.next }]),
        ],
      },
    },
  };
}

/** Log items, one per string. */
function items(...texts: readonly string[]): readonly unknown[] {
  return texts.map((line) => ({ line, type: "normal", version: 1 }));
}

const EMPTY = page([]);

/** The `text/plain` state resource — a bare word, no trailing newline. */
function state(word: string): Reply {
  return {
    ok: true,
    value: {
      status: 200,
      notModified: false,
      contentType: "text/plain;charset=UTF-8",
      text: word,
      body: undefined,
    },
  };
}

/** A `204`, which is what a cancel answers. */
const ACCEPTED: Reply = {
  ok: true,
  value: { status: 204, notModified: false, text: "", body: undefined },
};

/** The fresh self-GET `cancelJob` now makes before its `PUT` (Finding 75) —
 * a job's own representation, carrying whatever `ETag` this reply names.
 * Body content is never read for it here; only `.etag` is. */
function selfEtag(etag: string): Reply {
  return {
    ok: true,
    value: {
      status: 200,
      notModified: false,
      contentType: "application/vnd.sas.compute.job+json",
      text: "{}",
      body: {},
      etag,
    },
  };
}

function rejected(status: number): Reply {
  return {
    ok: false,
    reason: `the compute service answered HTTP ${String(status)}`,
    problem: {
      code: "compute-rejected",
      error: { status, message: "Not Found" },
    },
  };
}

/**
 * What the client returns when a request it sent never came back — the shape a
 * timeout takes, since the timeout aborts the transport and the abort is caught
 * as a rejection.
 */
function unreachable(): Reply {
  return {
    ok: false,
    reason: "could not reach the compute service",
    problem: {
      code: "compute-unreachable",
      detail: "PUT /compute/sessions/s/jobs/j/state?value=canceled — aborted",
    },
  };
}

/**
 * One scripted request: what it answers, how much of the poll window it used,
 * and whether it answers at all until the test says so.
 */
interface Step {
  readonly reply: Reply;
  /**
   * Fake milliseconds consumed. The pump reads the clock either side of a poll,
   * so this is what decides "fast" — a real test would otherwise have to wait out
   * a ten-second window to exercise a timing branch.
   */
  readonly elapsedMs?: number;
  /** Answer nothing until `release` is called. `reply` is then ignored. */
  readonly hold?: boolean;
}

/** The window the pump is working against, and the two sides of its midpoint. */
const WINDOW_MS = 10_000;
const FAST_MS = Math.floor(WINDOW_MS * FAST_EMPTY_FRACTION) - 1;
const SLOW_MS = WINDOW_MS - 1;

function slow(reply: Reply): Step {
  return { reply, elapsedMs: SLOW_MS };
}
function fast(reply: Reply): Step {
  return { reply, elapsedMs: 0 };
}

function scripted(steps: readonly Step[]): {
  readonly client: ComputeClient;
  readonly requests: readonly ComputeRequest[];
  readonly now: () => number;
  readonly release: (reply: Reply) => void;
} {
  let clock = 0;
  const requests: ComputeRequest[] = [];
  const held: ((reply: Reply) => void)[] = [];

  const client: ComputeClient = {
    send: (request) => {
      const step = steps[requests.length];
      requests.push(request);
      assert.ok(
        step !== undefined,
        `the pump sent request ${String(requests.length)} and the script had ${String(steps.length)} steps`,
      );
      clock += step.elapsedMs ?? 0;
      if (step.hold === true) {
        return new Promise<Reply>((resolve) => held.push(resolve));
      }
      return Promise.resolve(step.reply);
    },
  };

  return {
    client,
    requests,
    now: () => clock,
    release: (reply) => {
      const resolve = held.shift();
      assert.ok(resolve !== undefined, "nothing was being held");
      resolve(reply);
    },
  };
}

/** The shortest script that reaches a terminal state: empty, done, drained. */
const FINISHES: readonly Step[] = [
  fast(EMPTY),
  fast(state("completed")),
  fast(EMPTY),
];

async function collect(events: AsyncIterable<LogEvent>): Promise<LogEvent[]> {
  const out: LogEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

/** Just the text, for the tests that are about order rather than about events. */
function texts(events: readonly LogEvent[]): string[] {
  return events
    .filter((event) => event.kind === "line")
    .map((event) => event.line.line);
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

/**
 * Lets the pump run until it is waiting on something.
 *
 * A held step parks the pump on a promise nothing will resolve, but only once it
 * has *reached* that step. The tests that hold the first request can assert
 * straight away, because `streamJobLog` gets that far before it returns; anything
 * further in needs the microtask queue drained first, and a timer is the only
 * thing that reliably comes after all of it.
 */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function at(
  requests: readonly ComputeRequest[],
  index: number,
): ComputeRequest {
  const request = requests[index];
  assert.ok(
    request !== undefined,
    `the pump made only ${String(requests.length)} requests`,
  );
  return request;
}

describe("streamJobLog", () => {
  describe("running without a consumer", () => {
    it("settles done when nothing ever iterates events", async () => {
      const script = scripted([fast(page(items("one", "two"))), ...FINISHES]);

      const stream = streamJobLog(script.client, job(), { now: script.now });
      const result = await stream.done;

      assert.ok(result.ok, "a completed run was reported as a failure");
      assert.ok(result.value.outcome === "terminal");
      assert.equal(result.value.state, "completed");
    });

    it("finishes the whole script before the first iteration", async () => {
      const script = scripted([
        fast(page(items("one"))),
        fast(page(items("two"))),
        ...FINISHES,
      ]);

      const stream = streamJobLog(script.client, job(), { now: script.now });
      await stream.done;

      // Every request was made while nothing was reading. A consumer that had
      // been driving the loop could not have got here.
      assert.equal(script.requests.length, 5);
      // And the output survived the wait rather than being dropped on the floor.
      assert.deepEqual(texts(await collect(stream.events)), ["one", "two"]);
    });
  });

  describe("the poll", () => {
    it("always sends a timeout, and starts at the beginning of the log", async () => {
      const script = scripted([...FINISHES]);

      await streamJobLog(script.client, job(), { now: script.now }).done;

      const first = at(script.requests, 0);
      assert.equal(parameter(first, "start"), "0");
      // ADR-0017 makes this structural: without it the loop is a busy-wait that
      // looks correct (finding 48).
      assert.equal(parameter(first, "timeout"), "10");
    });

    it("advances the cursor by the items sent, not by the lines parsed", async () => {
      // Three items, one of which has no string `line` and is dropped by the
      // reader. The cursor belongs to the deployment's numbering, so the next
      // poll starts at 3 — advancing by the two lines we kept would re-read one.
      const script = scripted([
        fast(page([{ line: "one" }, { version: 1 }, { line: "two" }])),
        ...FINISHES,
      ]);

      const stream = streamJobLog(script.client, job(), { now: script.now });
      await stream.done;

      assert.equal(parameter(at(script.requests, 1), "start"), "3");
      assert.deepEqual(texts(await collect(stream.events)), ["one", "two"]);
    });
  });

  describe("deciding when to ask the job's state", () => {
    it("asks after an empty page that came back fast", async () => {
      // A terminal job answered a `timeout=10` poll in 0.26 s (finding 50), so a
      // fast empty page is the cheap hint that the job may be over.
      const script = scripted([
        { reply: EMPTY, elapsedMs: FAST_MS },
        fast(state("completed")),
        fast(EMPTY),
      ]);

      const result = await streamJobLog(script.client, job(), {
        now: script.now,
      }).done;

      assert.ok(result.ok);
      assert.equal(at(script.requests, 1).link.rel, "state");
    });

    it("does not ask after an empty page that used its window", async () => {
      // A live but silent job blocks the full window (finding 48). Asking then
      // would be one wasted request per window for the length of the run.
      const script = scripted([
        slow(EMPTY),
        slow(EMPTY),
        { reply: EMPTY, elapsedMs: FAST_MS },
        fast(state("completed")),
        fast(EMPTY),
      ]);

      const result = await streamJobLog(script.client, job(), {
        now: script.now,
      }).done;

      assert.ok(result.ok);
      assert.equal(at(script.requests, 1).link.rel, "log");
      assert.equal(at(script.requests, 2).link.rel, "log");
      assert.equal(at(script.requests, 3).link.rel, "state");
    });

    it("asks anyway once the counter runs out", async () => {
      // The safety net. Termination depends on a finished job short-circuiting
      // its poll, which is one measurement on one deployment; a deployment that
      // let the window run its course instead would produce a stream that never
      // ends, and this is what stops it.
      const windows = Array.from(
        { length: MAX_WINDOWS_WITHOUT_STATE_READ },
        () => slow(EMPTY),
      );
      const script = scripted([
        ...windows,
        fast(state("completed")),
        fast(EMPTY),
      ]);

      const result = await streamJobLog(script.client, job(), {
        now: script.now,
      }).done;

      assert.ok(result.ok);
      assert.equal(
        at(script.requests, MAX_WINDOWS_WITHOUT_STATE_READ).link.rel,
        "state",
      );
    });

    it("restarts the counter whenever output arrives", async () => {
      // A job that is producing output is demonstrably alive, so the state has
      // nothing to add and the counter has nothing to protect against.
      const before = Array.from(
        { length: MAX_WINDOWS_WITHOUT_STATE_READ - 1 },
        () => slow(EMPTY),
      );
      const script = scripted([
        ...before,
        slow(page(items("still here"))),
        ...before,
        { reply: EMPTY, elapsedMs: FAST_MS },
        fast(state("completed")),
        fast(EMPTY),
      ]);

      const result = await streamJobLog(script.client, job(), {
        now: script.now,
      }).done;

      assert.ok(result.ok);
      const states = script.requests.filter(
        (request) => request.link.rel === "state",
      );
      assert.equal(states.length, 1, "the counter was not reset by the output");
    });

    it("keeps polling when the state is not terminal", async () => {
      const script = scripted([
        { reply: EMPTY, elapsedMs: FAST_MS },
        fast(state("running")),
        ...FINISHES,
      ]);

      const result = await streamJobLog(script.client, job(), {
        now: script.now,
      }).done;

      assert.ok(result.ok);
      assert.equal(script.requests.length, 5);
    });

    it("reads the clock itself when the caller does not supply one", async () => {
      // `now` omitted, which is the way every caller outside this file will use
      // it. The scripted replies return immediately, so the real `Date.now`
      // measures a poll that took no time and the fast-empty path is reached
      // without the injected clock the rest of these tests lean on.
      const script = scripted([...FINISHES]);

      const result = await streamJobLog(script.client, job()).done;

      assert.ok(result.ok);
      assert.ok(result.value.outcome === "terminal");
      assert.equal(result.value.state, "completed");
    });
  });

  describe("the drain", () => {
    it("follows next past a short page and stops on a full one", async () => {
      // Finding 51: a 21-line log at `limit=3` gave seven pages and the last was
      // full with no `next`. A reader keyed on page size stops one page early,
      // and only on the logs where the line count happens to divide.
      const script = scripted([
        { reply: EMPTY, elapsedMs: FAST_MS },
        fast(state("completed")),
        fast(page(items("a", "b", "c"), { next: `${JOB_PATH}/log?start=3` })),
        fast(page(items("d"), { next: `${JOB_PATH}/log?start=4` })),
        fast(page(items("e", "f", "g"))),
      ]);

      const stream = streamJobLog(script.client, job(), {
        now: script.now,
        limit: 3,
      });
      const result = await stream.done;

      assert.ok(result.ok);
      assert.deepEqual(texts(await collect(stream.events)), [
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "g",
      ]);
      // Followed as sent, rather than rebuilt.
      assert.equal(at(script.requests, 3).link.href, `${JOB_PATH}/log?start=3`);
    });

    it("re-reads from the cursor before following anything", async () => {
      // The page that triggered the state check was empty, so it carried the
      // cursor and nothing else. Anything written between that poll and the
      // state coming back terminal exists only at the cursor.
      const script = scripted([
        fast(page(items("one", "two"))),
        { reply: EMPTY, elapsedMs: FAST_MS },
        fast(state("completed")),
        fast(page(items("last words"))),
      ]);

      const stream = streamJobLog(script.client, job(), { now: script.now });
      await stream.done;

      assert.equal(parameter(at(script.requests, 3), "start"), "2");
      assert.deepEqual(texts(await collect(stream.events)), [
        "one",
        "two",
        "last words",
      ]);
    });

    it("stops following next before the requests can run away", async () => {
      // The drain's only ordinary exit is the deployment ceasing to send the
      // relation, and that it does so is one observation of one log (finding
      // 51). A `next` that pointed at itself — or that a rewriting proxy kept
      // alive — would otherwise be an unbounded request storm behind a `done`
      // that never settles.
      const looping = page([], { next: `${JOB_PATH}/log?start=0` });
      const script = scripted([
        { reply: EMPTY, elapsedMs: FAST_MS },
        fast(state("completed")),
        ...Array.from({ length: MAX_DRAIN_PAGES + 1 }, () => fast(looping)),
      ]);

      const result = await streamJobLog(script.client, job(), {
        now: script.now,
      }).done;

      // A failure, not a quietly truncated log: stopping early and saying
      // nothing is the hole-with-no-marker this module refuses to produce.
      assert.ok(!result.ok, "an endless log was reported as a finished one");
      assert.equal(result.problem.code, "response-malformed");
      // The poll, the state, the read that opens the drain, and then the bound.
      assert.equal(script.requests.length, MAX_DRAIN_PAGES + 3);
    });

    it("reports a failure on the read that opens the drain", async () => {
      // That first read is the one carrying anything written between the last
      // empty page and the state coming back terminal — which is where a failing
      // program says why it failed.
      const script = scripted([
        { reply: EMPTY, elapsedMs: FAST_MS },
        fast(state("completed")),
        fast(rejected(503)),
      ]);

      const result = await streamJobLog(script.client, job(), {
        now: script.now,
      }).done;

      assert.ok(!result.ok, "a drain that never started was reported as a log");
      assert.equal(script.requests.length, 3);
    });

    it("abandons the drain when the caller's signal is aborted", async () => {
      // The caller's signal still reaches here — `cancel()` does not, because
      // the job is already over. An abort means the window is closing, so the
      // tail of the log is not worth another request.
      const controller = new AbortController();
      const script = scripted([
        { reply: EMPTY, elapsedMs: FAST_MS },
        fast(state("completed")),
        { reply: EMPTY, hold: true },
      ]);

      const stream = streamJobLog(script.client, job(), {
        now: script.now,
        signal: controller.signal,
      });
      await flush();
      controller.abort();
      script.release(rejected(404));
      const result = await stream.done;

      assert.ok(result.ok, "an abandoned drain was reported as a failure");
      assert.equal(result.value.outcome, "cancelled");
      assert.equal(script.requests.length, 3);
    });

    it("abandons it part-way through the pages too", async () => {
      const controller = new AbortController();
      const script = scripted([
        { reply: EMPTY, elapsedMs: FAST_MS },
        fast(state("completed")),
        fast(page(items("a"), { next: `${JOB_PATH}/log?start=1` })),
        { reply: EMPTY, hold: true },
      ]);

      const stream = streamJobLog(script.client, job(), {
        now: script.now,
        signal: controller.signal,
      });
      await flush();
      assert.equal(
        script.requests.length,
        4,
        "the drain did not reach page two",
      );
      controller.abort();
      script.release(rejected(404));
      const result = await stream.done;

      assert.ok(result.ok);
      assert.equal(result.value.outcome, "cancelled");
      // What was already read is still handed over. Cancelling ends the reading,
      // it does not discard it.
      assert.deepEqual(texts(await collect(stream.events)), ["a"]);
    });
  });

  describe("overflow", () => {
    it("drops the oldest lines and marks the hole where it is", async () => {
      const script = scripted([
        fast(page(items("1", "2", "3", "4", "5"))),
        ...FINISHES,
      ]);

      const stream = streamJobLog(script.client, job(), {
        now: script.now,
        maxBufferedLines: 3,
      });
      const result = await stream.done;
      const events = await collect(stream.events);

      assert.deepEqual(events[0], { kind: "dropped", lines: 2, characters: 2 });
      assert.deepEqual(texts(events), ["3", "4", "5"]);
      // The other half of the answer, for a caller that never iterates.
      assert.ok(result.ok);
      assert.deepEqual(result.value.dropped, { lines: 2, characters: 2 });
    });

    it("trims on characters even when the line count is fine", async () => {
      const script = scripted([
        fast(page(items("aaaa", "bbbb", "cccc"))),
        ...FINISHES,
      ]);

      const stream = streamJobLog(script.client, job(), {
        now: script.now,
        maxBufferedCharacters: 10,
      });
      const result = await stream.done;
      const events = await collect(stream.events);

      assert.deepEqual(events[0], { kind: "dropped", lines: 1, characters: 4 });
      assert.deepEqual(texts(events), ["bbbb", "cccc"]);
      assert.ok(result.ok);
      assert.deepEqual(result.value.dropped, { lines: 1, characters: 4 });
    });

    it("coalesces repeated overflows into one marker and one total", async () => {
      // A runaway program must not have the log it is truncating replaced by a
      // list of complaints about truncating it — and the running total must not
      // count a line again when its marker is moved.
      const script = scripted([
        fast(page(items("1", "2", "3"))),
        fast(page(items("4", "5"))),
        ...FINISHES,
      ]);

      const stream = streamJobLog(script.client, job(), {
        now: script.now,
        maxBufferedLines: 2,
      });
      const result = await stream.done;
      const events = await collect(stream.events);

      assert.equal(
        events.filter((event) => event.kind === "dropped").length,
        1,
        "the markers did not coalesce",
      );
      assert.deepEqual(events[0], { kind: "dropped", lines: 3, characters: 3 });
      assert.deepEqual(texts(events), ["4", "5"]);
      assert.ok(result.ok);
      assert.deepEqual(result.value.dropped, { lines: 3, characters: 3 });
    });

    it("reports nothing dropped when nothing was", async () => {
      const script = scripted([fast(page(items("one"))), ...FINISHES]);

      const result = await streamJobLog(script.client, job(), {
        now: script.now,
      }).done;

      assert.ok(result.ok);
      assert.deepEqual(result.value.dropped, { lines: 0, characters: 0 });
    });
  });

  describe("cancelling", () => {
    it("settles done as cancelled and tells the deployment, after first reading a fresh ETag to cancel with (Finding 75)", async () => {
      const script = scripted([
        { reply: EMPTY, hold: true },
        fast(selfEtag('"abc"')),
        fast(ACCEPTED),
      ]);

      const stream = streamJobLog(script.client, job(), { now: script.now });
      const cancelling = stream.cancel();

      // The self GET went out while the poll was still open — the second
      // request exists before the first has answered. It reads a fresh ETag
      // before anything is sent to actually stop the job: the job's own
      // ETag goes stale within about a second (Finding 75), so this is read
      // right before the `PUT` rather than carried from anywhere earlier.
      assert.equal(script.requests.length, 2);
      const selfRequest = at(script.requests, 1);
      assert.equal(selfRequest.link.rel, "self");
      assert.equal(selfRequest.signal, undefined);

      assert.ok((await cancelling).ok);

      // Now the cancel itself, sent once the self GET answered. Query
      // intact, the fresh ETag as `If-Match`, nothing in the body.
      assert.equal(script.requests.length, 3);
      const sent = at(script.requests, 2);
      assert.equal(sent.link.rel, "cancel");
      assert.equal(sent.link.href, `${JOB_PATH}/state?value=canceled`);
      assert.equal(sent.etag, '"abc"');
      assert.equal(sent.body, undefined);

      // The aborted poll fails, and how it fails is exactly what must not reach
      // the caller: a dropped connection reads as an unreachable deployment.
      script.release(rejected(404));
      const result = await stream.done;

      assert.ok(result.ok, "a cancelled run was reported as a failure");
      assert.equal(result.value.outcome, "cancelled");
    });

    it("sends one cancellation sequence however many times it is called", async () => {
      const script = scripted([
        { reply: EMPTY, hold: true },
        fast(selfEtag('"abc"')),
        fast(ACCEPTED),
      ]);

      const stream = streamJobLog(script.client, job(), { now: script.now });
      const [first, second] = await Promise.all([
        stream.cancel(),
        stream.cancel(),
      ]);

      assert.ok(first.ok);
      assert.ok(second.ok);
      // The held poll, plus one self GET and one cancel PUT — not two of
      // either, despite `cancel()` being called twice concurrently.
      assert.equal(script.requests.length, 3);

      script.release(rejected(404));
      await stream.done;
    });

    it("aborts the poll but puts no signal on the self GET or the message that stops the job", async () => {
      const script = scripted([
        { reply: EMPTY, hold: true },
        fast(selfEtag('"abc"')),
        fast(ACCEPTED),
      ]);

      const stream = streamJobLog(script.client, job(), { now: script.now });
      await stream.cancel();

      // The abort goes first, and it is what settles `done` — the user pressed
      // Cancel and is waiting on that, not on the deployment's acknowledgement.
      assert.equal(
        at(script.requests, 0).signal?.aborted,
        true,
        "the in-flight poll was left running",
      );
      // Neither the self GET (Finding 75) nor the cancel itself carries one.
      // Passing the pump's — the obvious tidy-up, since every other call in the
      // module takes it — would abort the one request whose entire purpose is
      // to stop the job, leaving the program to run to completion unattended.
      assert.equal(at(script.requests, 1).signal, undefined);
      assert.equal(at(script.requests, 2).signal, undefined);

      script.release(rejected(404));
      await stream.done;
    });

    it("reports a job it cannot tell to stop, and still settles", async () => {
      // The two halves of `cancel` answer different questions: the result is
      // about the request to the deployment, `done` is about the run. A job
      // whose representation carries no `cancel` relation fails the first and
      // must not fail the second — the user asked for the run to end, and it has.
      const script = scripted([{ reply: EMPTY, hold: true }]);
      const withoutCancel = job(
        jobLinks().filter((link) => link.rel !== "cancel"),
      );

      const stream = streamJobLog(script.client, withoutCancel, {
        now: script.now,
      });
      const result = await stream.cancel();

      assert.ok(!result.ok, "a job with no cancel relation reported success");
      assert.equal(result.problem.code, "link-missing");

      script.release(rejected(404));
      const ended = await stream.done;

      assert.ok(ended.ok, "an unsendable cancel failed the stream");
      assert.equal(ended.value.outcome, "cancelled");
    });

    it("settles when the deployment never answers the cancel", async () => {
      // The cancel request carries no signal of its own, which reads as
      // unbounded and is not: the client composes a timeout into every request
      // and combines it with the caller's, so a `PUT` into a black hole fails at
      // that timeout as `compute-unreachable`. What must not happen is `cancel()`
      // never settling — a caller waiting on it would have no way to recover,
      // since concurrent callers share the one memoised promise.
      const script = scripted([
        { reply: EMPTY, hold: true },
        fast(selfEtag('"abc"')),
        fast(unreachable()),
      ]);

      const stream = streamJobLog(script.client, job(), { now: script.now });
      const result = await stream.cancel();

      assert.ok(!result.ok, "an unanswered cancel reported success");
      assert.equal(result.problem.code, "compute-unreachable");

      script.release(rejected(404));
      const ended = await stream.done;

      // And the run still ends as cancelled. The request is about the
      // deployment; `done` is about the run, and the user's run is over either
      // way.
      assert.ok(ended.ok, "an unanswered cancel failed the stream");
      assert.equal(ended.value.outcome, "cancelled");
    });

    it("settles as cancelled even when the state read says otherwise", async () => {
      // The cancel arrives while the state request is in flight, and the state
      // comes back terminal. The user's decision is the older one and wins: this
      // run ended because it was cancelled, whatever the job did in the meantime.
      const script = scripted([
        { reply: EMPTY, elapsedMs: FAST_MS },
        { reply: EMPTY, hold: true },
        fast(selfEtag('"abc"')),
        fast(ACCEPTED),
      ]);

      const stream = streamJobLog(script.client, job(), { now: script.now });
      await flush();
      assert.equal(at(script.requests, 1).link.rel, "state");

      assert.ok((await stream.cancel()).ok);
      script.release(state("completed"));
      const result = await stream.done;

      assert.ok(result.ok);
      assert.equal(result.value.outcome, "cancelled");
      assert.equal(script.requests.length, 4, "a cancelled run drained anyway");
    });

    it("does nothing once the job is terminal, drain or no drain", async () => {
      // The window between the terminal state and `done` settling is the drain,
      // and the job is already over throughout it. A cancel here would send a
      // pointless `PUT` — a `404` on a reaped session, which `cancelJob` reads
      // as `session-gone` and would report as a failure — *and* abandon the tail
      // of a log that is already complete on the server, with nothing to count.
      const script = scripted([
        { reply: EMPTY, elapsedMs: FAST_MS },
        fast(state("completed")),
        { reply: EMPTY, hold: true },
      ]);

      const stream = streamJobLog(script.client, job(), { now: script.now });
      await flush();
      assert.equal(script.requests.length, 3, "the drain had not begun");

      const result = await stream.cancel();
      assert.ok(result.ok);
      assert.equal(script.requests.length, 3, "a cancel went out mid-drain");

      script.release(page(items("last words")));
      const ended = await stream.done;

      assert.ok(ended.ok);
      assert.equal(
        ended.value.outcome,
        "terminal",
        "the run really did finish",
      );
      assert.deepEqual(texts(await collect(stream.events)), ["last words"]);
    });

    it("does nothing at all once the run has settled", async () => {
      // ADR-0015 requires this to succeed, and doing nothing has to be literal:
      // a `PUT` at a job whose session the reaper has taken is a 404, which
      // `cancelJob` reads as `session-gone` and would report as a failure.
      const script = scripted([...FINISHES]);

      const stream = streamJobLog(script.client, job(), { now: script.now });
      await stream.done;
      const result = await stream.cancel();

      assert.ok(result.ok);
      assert.equal(script.requests.length, 3, "a settled stream sent a cancel");
    });

    it("ends the events iteration too", async () => {
      const script = scripted([
        { reply: EMPTY, hold: true },
        fast(selfEtag('"abc"')),
        fast(ACCEPTED),
      ]);

      const stream = streamJobLog(script.client, job(), { now: script.now });
      const collecting = collect(stream.events);
      await stream.cancel();
      script.release(rejected(404));
      await stream.done;

      // A consumer parked on an empty buffer is woken by the close rather than
      // left waiting for a line that is never coming.
      assert.deepEqual(await collecting, []);
    });

    it("treats the caller's own signal as cancellation, silently", async () => {
      // An abort says the caller has stopped caring, and it may have stopped
      // caring because the window is closing — which is not the moment to open
      // a new request.
      const controller = new AbortController();
      const script = scripted([{ reply: EMPTY, hold: true }]);

      const stream = streamJobLog(script.client, job(), {
        now: script.now,
        signal: controller.signal,
      });
      controller.abort();
      script.release(rejected(404));
      const result = await stream.done;

      assert.ok(result.ok);
      assert.equal(result.value.outcome, "cancelled");
      assert.equal(script.requests.length, 1, "an abort sent a cancel");
    });

    it("never starts when the caller's signal is already aborted", async () => {
      const script = scripted([]);

      const result = await streamJobLog(script.client, job(), {
        now: script.now,
        signal: AbortSignal.abort(),
      }).done;

      assert.ok(result.ok);
      assert.equal(result.value.outcome, "cancelled");
      assert.equal(script.requests.length, 0);
    });
  });

  describe("failures", () => {
    it("reports a failed poll and stops", async () => {
      const script = scripted([fast(rejected(503))]);

      const result = await streamJobLog(script.client, job(), {
        now: script.now,
      }).done;

      assert.ok(!result.ok, "a failed poll was reported as a completed run");
      assert.equal(script.requests.length, 1);
    });

    it("reports a failed state read and stops", async () => {
      const script = scripted([
        { reply: EMPTY, elapsedMs: FAST_MS },
        fast(rejected(503)),
      ]);

      const result = await streamJobLog(script.client, job(), {
        now: script.now,
      }).done;

      assert.ok(!result.ok);
      assert.equal(script.requests.length, 2);
    });

    it("reports a failure part-way through the drain", async () => {
      const script = scripted([
        { reply: EMPTY, elapsedMs: FAST_MS },
        fast(state("completed")),
        fast(page(items("a"), { next: `${JOB_PATH}/log?start=1` })),
        fast(rejected(503)),
      ]);

      const result = await streamJobLog(script.client, job(), {
        now: script.now,
      }).done;

      assert.ok(!result.ok, "a truncated drain was reported as a whole log");
    });

    it("ends the events iteration when the run fails", async () => {
      const script = scripted([fast(page(items("one"))), fast(rejected(503))]);

      const stream = streamJobLog(script.client, job(), { now: script.now });
      const collecting = collect(stream.events);
      await stream.done;

      assert.deepEqual(texts(await collecting), ["one"]);
    });

    it("refuses a job with no log relation", async () => {
      const script = scripted([]);
      const withoutLog = job(jobLinks().filter((link) => link.rel !== "log"));

      const result = await streamJobLog(script.client, withoutLog, {
        now: script.now,
      }).done;

      assert.ok(!result.ok);
      assert.equal(result.problem.code, "link-missing");
    });
  });

  describe("caller defects", () => {
    // Thrown from the call rather than settled through `done`, as in `job.ts`: a
    // bound of zero is a mistake at the call site, and reporting it the same way
    // as an unreachable deployment would put the two in one channel. Throwing
    // also means a defective call never starts a poll loop.
    const bad: readonly (readonly [string, LogStreamOptions])[] = [
      ["limit", { limit: 0 }],
      ["timeoutSeconds", { timeoutSeconds: 0 }],
      ["maxBufferedLines", { maxBufferedLines: 0 }],
      ["maxBufferedCharacters", { maxBufferedCharacters: -1 }],
      ["limit", { limit: 1.5 }],
    ];

    for (const [name, options] of bad) {
      const value = String(Object.values(options)[0]);
      it(`refuses a ${name} of ${value}`, () => {
        const script = scripted([]);
        assert.throws(
          () => streamJobLog(script.client, job(), options),
          (error: unknown) =>
            error instanceof TypeError && error.message.includes(name),
        );
        assert.equal(script.requests.length, 0);
      });
    }
  });
});
