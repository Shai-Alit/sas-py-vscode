// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Compute jobs — submit statements, ask whether they finished, read the log.
 *
 * **This module must never import `vscode`.**
 *
 * A job is one submission into a live session. `session.ts` starts the SAS
 * process; this starts work inside it and reads what came back. As there, every
 * function makes **one request** and reports what happened: no retry, no loop,
 * no timers. The loop that turns these into a stream is ADR-0017's pump, and it
 * lives in slice `2c-ii` on top of exactly these calls.
 *
 * ## What a job is neutral about
 *
 * {@link createJob} takes an array of SAS statements and does not read them.
 * That is ADR-0017 part 2 and it is a boundary rather than laziness: ADR-0014
 * decided Python is submitted as an **uploaded file** run with
 * `proc python infile=<fileref>;`, and that mechanism — the upload, its
 * `If-Match` round trip, the `restart` handling — belongs to slice `3a`. If this
 * module knew how to wrap Python, 3a's design would be frozen here, one slice
 * before the slice that has to make it.
 *
 * ## Three shapes that differ from a session's, and why each matters
 *
 * **The job's terminal state is the authority on completion, and there are five
 * of them.** {@link TERMINAL_STATES} keeps `done`, `canceled` and `warning`
 * alongside the two a live deployment has actually produced (finding 53),
 * because an unobserved extra member costs nothing and a missing one is a loop
 * that never exits. Upstream's equivalent, `ComputeJob.isDone()`, tests
 * `indexOf(state) === -1` and therefore answers `true` when the job is **not**
 * done; {@link isTerminal} is the same list read the right way round.
 *
 * **The log is paged by `start`, and there is no ETag on it at all**
 * (finding 48), so the cursor is the whole of the reader's state and there is no
 * conditional-request machinery here. Its long poll is the `timeout` query
 * parameter rather than `wait` plus `If-None-Match`, and it is real: measured
 * against a job silent for 25 seconds, `timeout=10` blocked for 10.27 s where
 * the same request without it returned empty in 0.56 s.
 *
 * **Expiry on the log is a `200` carrying `items: []`**, never a `304`
 * (finding 49). An empty page therefore means "nothing yet" and never
 * "end of log" — only the state says whether more is coming.
 *
 * ## A `404` from a job is read as the session being gone
 *
 * Every failure here goes through `session.ts`'s `asSessionGone`, and that is a
 * reading rather than a fact. Finding 53 measured the observed case and named
 * the ambiguity in the same breath: a log read after the session was deleted
 * answers `404` with a message naming the *session*, and the client "cannot tell
 * 'your session expired' from 'that job never existed' by status alone".
 *
 * The reading is taken anyway, because the alternative — a third problem code
 * meaning "one of two things" — is a code no caller could act on. It is safe
 * today for a reason that is worth writing down rather than relying on: **nothing
 * in this extension deletes a job**, so the second reading has no producer. The
 * slice that adds one has to revisit this, because recovering from `session-gone`
 * means building a new session, and that discards the Python namespace ADR-0012
 * exists to keep.
 *
 * ## What is deliberately not here
 *
 * No composed URL. A job is only ever reached by following `execute` from a
 * session and then its own relations, so this module adds nothing to the two
 * paths `contexts.ts` and `session.ts` compose between them.
 *
 * No state long poll. `?wait=` is inert on a state resource unless an
 * `If-None-Match` accompanies it (finding 28), the job state's expiry has never
 * been observed at all (finding 49), and ADR-0017 drives the loop from the log
 * instead — the state is consulted only when a poll comes back fast and empty.
 * {@link readJobState} is therefore one plain `GET` with no arm for a `304` it
 * cannot receive.
 *
 * No `count`. The log collection reports one and it is a live running total
 * (finding 47) — the opposite of `/compute/contexts`, where `count` is `null`
 * exactly when a pager would want it — but it is stale the moment it is read on
 * a running job, and nothing here has a use for it that `items` does not serve
 * better.
 */

import {
  type ComputeClient,
  type ComputeFailure,
  type ComputeResponse,
  type ComputeResult,
} from "./client";
import { findLink, type Link, readLinks } from "./links";
import {
  asSessionGone,
  type ComputeSession,
  WAIT_MARGIN_SECONDS,
} from "./session";

/** The relation on a session that submits a job into it. `POST`. */
export const EXECUTE_REL = "execute";

/** The relation on a job that reads its state. `GET`, `text/plain`. */
export const JOB_STATE_REL = "state";

/** The relation on a job that reads its own representation, `ETag` included.
 * `cancelJob` (Finding 75) follows this immediately before its `PUT`, since a
 * job's `ETag` is stale within a second of the create response that carried
 * one. */
export const JOB_SELF_REL = "self";

/**
 * The relation on a job that reads its log as a collection of typed lines.
 *
 * `log` and `logAsText` are the **same href**, differing only in `rel` and in
 * the media type they advertise (finding 46). Following the link — rather than
 * resolving it to a URL and choosing an `Accept` separately — is what keeps
 * those two apart, because the client derives the header from the link it was
 * given. Ask for the wrong one and the reply is a `text/plain` body, which
 * arrives here as a malformed response rather than as silently mis-parsed text.
 */
export const LOG_REL = "log";

/**
 * The relation on a job that stops it. `PUT`, and it carries its own query.
 *
 * The deployment sends it fully formed as `PUT …/state?value=canceled` with
 * `type: null` (finding 46), so this is a link to follow rather than a request to
 * build — the same shape as a session's `cancel` (finding 21) and for the same
 * reason. It is also, on a job, one of only two relations with a query string
 * already in the href, which is why anything appending to one of these has to
 * test for a `?` rather than assume none.
 *
 * There is deliberately **no `delete` relation constant**, though the job sends
 * one. See {@link cancelJob}.
 */
export const JOB_CANCEL_REL = "cancel";

/**
 * The states a job does not come back from.
 *
 * Upstream's list, kept whole. `error`, `completed` and, as of Phase 4's
 * Finding 76, `canceled` have all now been seen on a live deployment — a SAS
 * `ERROR:` gives `error` while the session it ran in still settles to `idle`
 * (finding 53), and a `cancelJob` that reached a fresh `ETag` in time reads
 * back `canceled`, lower-case, matching the comparison below. `done` and
 * `warning` alone remain inherited on trust. Trust is the right call for
 * those two: the cost of an extra member nothing ever emits is nil, and the
 * cost of a missing one is a poll loop that runs until something else stops
 * it.
 */
export const TERMINAL_STATES: readonly string[] = [
  "done",
  "canceled",
  "error",
  "warning",
  "completed",
];

/**
 * The name sent when creating a job.
 *
 * **Not echoed back.** Unlike a session's name (finding 24), the job
 * representation carries no `name` at all (finding 46), so this is invisible
 * everywhere we can currently see. It is sent because it is what the probe sent
 * to get its `201`, and dropping a field from a request that is known to work,
 * to save nothing, is not a trade worth making.
 */
export const JOB_NAME = "python-on-viya";

/**
 * How many lines to ask for in one page.
 *
 * The probe used 200 and 500 freely against small logs and never found a
 * ceiling — but it never looked for one either, so this is a value observed
 * working rather than a tuned one. A deployment that silently clamps it changes
 * nothing: the reader advances by the number of items it was actually sent.
 */
export const DEFAULT_LOG_LIMIT = 200;

/**
 * How long the deployment is asked to hold a log poll open, in seconds.
 *
 * Ten, because ten is the largest value ever observed running its full course
 * (10.27 s against a silent job; `timeout=5` elapsed at 5.37 s against the
 * same). `timeout=60` was accepted but was released by a log line at 6.34 s, so
 * a server that silently clamps large values would have produced an identical
 * measurement (finding 48) — which is why nothing here relies on a long ceiling
 * for correctness. An early empty return is indistinguishable from a short poll,
 * and both are handled the same way.
 */
export const DEFAULT_LOG_TIMEOUT_SECONDS = 10;

/**
 * A submitted job, reduced to what the pump above it needs.
 *
 * `links` is kept whole for the same reason a session's is: the job API arrives
 * as ten relations (finding 46) and `state`, `log`, `cancel` and `delete` are
 * all read out of it rather than composed.
 *
 * Deliberately absent: `sessionId`, `creationTimeStamp` and `stateElapsedTime`
 * are left on the wire until something needs them, and the create response's
 * **`ETag` is not carried at all**. Nothing conditional is sent to a job — the
 * state read is unconditional by design (see the module note), and `cancel` and
 * `delete` follow `session.ts` in sending no validator — so holding one would be
 * keeping a value whose only use is a `412` we have arranged not to provoke.
 */
export interface ComputeJob {
  readonly id: string;
  /** As last read. `pending` at creation (finding 46), never terminal there. */
  readonly state: string;
  readonly links: readonly Link[];
}

export interface CreateJobOptions {
  signal?: AbortSignal | undefined;
}

/** One line of the log, as the collection sends it. */
export interface LogLine {
  /**
   * The text, **including the empty string**.
   *
   * Blank and whitespace-only lines are ordinary log content — six of the
   * twenty-one lines in finding 52's sample are one or the other — so the "drop
   * empty values" reflex that `readLinks` and `readContext` both apply is wrong
   * here, and applying it would quietly delete the log's vertical spacing.
   */
  readonly line: string;
  /**
   * `source`, `note`, `normal`, `error` — and whatever else a deployment sends.
   *
   * The vocabulary is a **floor, not a closed set** (finding 52), so this is a
   * `string` and nothing here switches on it: interpreting a type is 3b's filter,
   * and this module's job is to deliver it intact. Note in particular that `note`
   * is a catch-all covering continuation lines, whitespace and blanks rather than
   * a `NOTE:` prefix test — ten of the thirteen notes in the sample carry no such
   * prefix.
   *
   * Optional because an item that arrives without one is still a line worth
   * showing. Inventing a type for it would put a word into a vocabulary the
   * server owns.
   */
  readonly type?: string | undefined;
}

/**
 * One page of the log.
 *
 * `next` is the drain's terminator and the reason this is a page rather than an
 * array. It disappears on the last page **even when that page is full** — a
 * 21-line log read at `limit=3` gave seven pages, the last of them holding three
 * items and carrying no `next` (finding 51) — so a reader that stopped on a
 * short page would stop one page early, and only on the logs where that happens.
 */
export interface LogPage {
  readonly lines: readonly LogLine[];
  /**
   * How far the cursor moves — the number of items the deployment sent, which
   * is **not** always `lines.length`.
   *
   * The two differ when {@link readLine} drops an item that carries no string
   * `line`, and the difference has to be visible here or the caller cannot
   * advance correctly. Advancing by `lines.length` after a drop re-reads the
   * item after it, which shows the user a duplicated line; and a page whose one
   * item was dropped would leave the cursor where it was, on a `start` the
   * deployment answers immediately, which is the busy-wait
   * {@link LogPageOptions.timeoutSeconds} exists to prevent arriving through the
   * parser instead of through the query string.
   *
   * It is also what makes a server-side clamp on `limit` harmless: the reader
   * advances by what it was sent rather than by what it asked for.
   *
   * Meaningless after {@link followLogPage}, where the cursor is inside the
   * `next` href and the caller is not tracking one.
   */
  readonly advance: number;
  readonly next?: Link | undefined;
}

export interface LogPageOptions {
  /**
   * The line to start from. Advanced by the caller, by the page's
   * {@link LogPage.advance} — not by how many lines it could parse.
   *
   * Overshooting is not a failure mode to defend against: `start=71` against a
   * 21-line log answered `200` with zero items and echoed the cursor back
   * (finding 51).
   */
  start: number;
  /** Defaults to {@link DEFAULT_LOG_LIMIT}. */
  limit?: number | undefined;
  /**
   * Seconds the deployment is asked to hold the poll open. Defaults to
   * {@link DEFAULT_LOG_TIMEOUT_SECONDS}.
   *
   * **This parameter is always sent.** ADR-0017 makes it structural rather than
   * optional: a log poll without it returns `200` immediately every time, so a
   * loop built on one looks correct, passes review, and becomes a request storm
   * against somebody's corporate network. That is finding 19's unpassed `wait`
   * happening a second time, and it is designed out here instead of documented
   * around. A value that is not a positive integer is refused for the same
   * reason — a `timeout` computed to zero is the busy-wait wearing a disguise.
   */
  timeoutSeconds?: number | undefined;
  signal?: AbortSignal | undefined;
}

/**
 * Whether a job state is one it does not come back from.
 *
 * Compared case-insensitively after trimming. Every state observed is lower-case
 * and unpadded, so this costs nothing today; it is here because the failure it
 * guards against — a deployment answering `Completed` — is a stream that never
 * ends rather than a message that reads oddly, and that is not a failure to
 * discover in front of a user.
 */
export function isTerminal(state: string): boolean {
  return TERMINAL_STATES.includes(state.trim().toLowerCase());
}

/**
 * Submits statements into a session.
 *
 * Follows the session's `execute` relation, which arrives fully formed with both
 * media types on it (`…job.request` out, `…job` back), so the client derives
 * every header from the link rather than from anything written here.
 *
 * The reply is a `201` carrying `Location`, an `ETag` and the whole
 * representation. As with a session, `Location` is **not** followed: the body
 * already holds the links, so fetching it would be a round trip for something we
 * were just handed. The `state` in that body is `pending` (finding 46) — a
 * caller that reads the create response hoping to find a terminal state has to
 * poll regardless.
 *
 * @throws {TypeError} if `statements` is empty. A job with no code is a caller
 *   defect rather than a runtime condition, in the same way an empty session id
 *   is in `session.ts`: nothing on the wire produces it, so failing where it was
 *   composed beats reporting it as though the deployment had objected.
 */
export async function createJob(
  client: ComputeClient,
  session: ComputeSession,
  statements: readonly string[],
  options?: CreateJobOptions,
): Promise<ComputeResult<ComputeJob>> {
  if (statements.length === 0) {
    throw new TypeError("a compute job needs at least one statement");
  }

  const link = findLink(session.links, EXECUTE_REL);
  if (link === undefined) {
    return linkMissing("compute session", session.id, EXECUTE_REL);
  }

  const result = await client.send({
    link,
    // Exactly the body that was measured producing a `201` (finding 46). Note
    // that it carries no `version`, where a session request does: the shape of a
    // request we send is not ours to embellish on the strength of a neighbouring
    // resource doing something else.
    body: { name: JOB_NAME, code: [...statements] },
    signal: options?.signal,
  });
  if (!result.ok) return asSessionGone(result);

  const job = readJob(result.value);
  if (job === undefined) {
    return malformed(
      result.value,
      "a job representation",
      "and it was not a job representation with an id and a state",
    );
  }
  return { ok: true, value: job };
}

/**
 * Reads the job's state once.
 *
 * One plain `GET` of the `state` relation, which is `text/plain`: the body is a
 * bare word. It is trimmed, because a deployment that adds a newline should not
 * thereby invent a state name.
 *
 * **Unconditional, and that is the design rather than an omission.** The pump
 * above this asks for the state only when a log poll came back fast and empty
 * (ADR-0017), so what it wants is an immediate answer, not a held connection —
 * and a held one is not available anyway: `wait` is inert on a state resource
 * without an `If-None-Match` to validate against (finding 28), and the job
 * state's expiry behaviour has never been observed at all (finding 49). Sending
 * neither means there is no `304` arm here, and therefore nothing that could
 * grow into upstream's `getState()`, which answers a `304` by recursing into
 * itself to fetch the state it just asked not to be sent.
 */
export async function readJobState(
  client: ComputeClient,
  job: ComputeJob,
  options?: { signal?: AbortSignal | undefined },
): Promise<ComputeResult<string>> {
  const link = findLink(job.links, JOB_STATE_REL);
  if (link === undefined) {
    return linkMissing("compute job", job.id, JOB_STATE_REL);
  }

  const result = await client.send({ link, signal: options?.signal });
  if (!result.ok) return asSessionGone(result);

  const state = result.value.text.trim();
  if (state === "") {
    return malformed(
      result.value,
      "a job state",
      "and the state resource was empty",
    );
  }
  return { ok: true, value: state };
}

/**
 * Reads one page of the log, from a cursor.
 *
 * The whole of a reader's state is `start`; there is no ETag on this collection
 * to track (finding 48). A page that comes back empty means **nothing yet**, not
 * end of log — expiry is a `200` with `items: []` (finding 49) — so a caller
 * stops on the job's state and drains on `next`, never on an empty or short page.
 *
 * The wait costs nothing once the job is finished: a terminal job answered a
 * `timeout=10` tail poll in 0.26 s rather than sitting the window out
 * (finding 50), so the drain has no trailing stall in it and needs no
 * special-cased last read.
 *
 * @throws {TypeError} if `start`, `limit` or `timeoutSeconds` is not a
 *   non-negative (respectively positive) integer. Caller defects, as in
 *   {@link createJob}.
 */
export async function readLogPage(
  client: ComputeClient,
  job: ComputeJob,
  options: LogPageOptions,
): Promise<ComputeResult<LogPage>> {
  // Arguments before links, as in `createJob`: a caller defect is reported the
  // same way whichever job it was handed, rather than turning into a
  // `link-missing` failure on the jobs that happen to lack a `log` relation.
  const start = wholeNumber("start", options.start);
  const limit = positiveInteger("limit", options.limit ?? DEFAULT_LOG_LIMIT);
  const timeoutSeconds = positiveInteger(
    "timeoutSeconds",
    options.timeoutSeconds ?? DEFAULT_LOG_TIMEOUT_SECONDS,
  );

  const link = findLink(job.links, LOG_REL);
  if (link === undefined) return linkMissing("compute job", job.id, LOG_REL);

  return await readPage(client, {
    link: {
      ...link,
      href: withQuery(link.href, [
        `start=${String(start)}`,
        `limit=${String(limit)}`,
        `timeout=${String(timeoutSeconds)}`,
      ]),
    },
    signal: options.signal,
    // The client has to outlive the server's wait or it aborts every poll a
    // moment before it was going to answer — a long poll that always fails, and
    // whose failure reads as an unreachable deployment. Same margin as the
    // session state's, and imported rather than restated so the two cannot drift.
    timeoutMs: (timeoutSeconds + WAIT_MARGIN_SECONDS) * 1000,
  });
}

/**
 * Reads the page a {@link LogPage.next} link points at, exactly as sent.
 *
 * The drain, one page at a time. The href arrives fully formed — cursor, page
 * size and whatever else the deployment chose to put in its query — and is
 * followed rather than rebuilt, which is ADR-0010 applied to the one place where
 * rebuilding it would be easy and wrong.
 *
 * No timeout override, and that is a **precondition on the caller** rather than
 * a property of this function: it is for draining a job that has already reached
 * a terminal state, where the deployment answers immediately whatever the query
 * says (finding 50), so the client's ordinary request timeout is the right
 * bound. Followed mid-run it would still be correct — the href carries whatever
 * `timeout` the deployment chose to echo, and a poll held longer than
 * `DEFAULT_TIMEOUT_MS` would abort — which is why the drain is the only caller
 * and why {@link readLogPage}, not this, is what a poll loop uses.
 */
export async function followLogPage(
  client: ComputeClient,
  link: Link,
  options?: { signal?: AbortSignal | undefined },
): Promise<ComputeResult<LogPage>> {
  return await readPage(client, { link, signal: options?.signal });
}

/**
 * Asks the deployment to stop the job.
 *
 * **Sends `If-Match`, read fresh immediately before the `PUT`.** An earlier
 * version of this comment claimed the deployment needed no validator here,
 * reasoning from `cancelSession`'s own three decisions — measured wrong,
 * Phase 4's Finding 75 (`docs/phases/phase-4.md`): a bare `PUT
 * …/state?value=canceled` answers **`428 Precondition Required`** on a live
 * Viya 4 deployment, every time, not the succeed-or-412 shape the old
 * comment assumed. The fix is not "carry the `ETag` from wherever the job
 * came from" — the same finding measured a job's `ETag` already stale one
 * second after its own `201` create response, so this function reads its
 * own fresh one off the `self` relation immediately before sending the
 * `PUT`, rather than trusting anything a caller might be holding.
 *
 * **Whether the job stops promptly is no longer unmeasured either.** Finding
 * 76 (same probe): the deployment accepts and echoes `canceled` as the
 * job's own state promptly, but that is not the same as preempting the
 * Python statement in flight — a 60-second loop cancelled ~6s in still ran
 * its full 60.01s before SAS tore the interpreter down. So this still
 * reports only whether the *request* was accepted, and a caller must still
 * not read a success here as the program having actually stopped —
 * `logStream.ts` does not; it settles its own stream on the user's intent
 * rather than on this reply, which is the only sound reading now that a
 * prompt stop is measured **not** to happen either.
 *
 * **There is no `deleteJob`, and its absence is load-bearing.** The job carries a
 * `delete` relation (finding 46) and nothing in this extension follows it. That
 * is what lets a `404` from a job resource be read as the session having gone
 * (finding 53): the reading is only sound while nothing here can have removed the
 * job itself. Adding a delete would invalidate that reasoning everywhere
 * {@link readJobState} and {@link readLogPage} depend on it, in exchange for
 * tidying up a resource the session's own teardown already takes with it.
 */
export async function cancelJob(
  client: ComputeClient,
  job: ComputeJob,
  options?: { signal?: AbortSignal | undefined },
): Promise<ComputeResult<void>> {
  const link = findLink(job.links, JOB_CANCEL_REL);
  if (link === undefined) {
    return linkMissing("compute job", job.id, JOB_CANCEL_REL);
  }

  const selfLink = findLink(job.links, JOB_SELF_REL);
  if (selfLink === undefined) {
    return linkMissing("compute job", job.id, JOB_SELF_REL);
  }
  // Finding 75: a fresh `ETag`, read right before the `PUT` rather than
  // carried from the job's own create response — that one is already stale
  // by the time a caller gets here (measured: it had changed within a
  // second). Any failure reading it is reported the same way any other
  // failure to reach the job is.
  const fresh = await client.send({ link: selfLink, signal: options?.signal });
  if (!fresh.ok) return asSessionGone(fresh);
  if (fresh.value.etag === undefined) {
    return malformed(
      fresh.value,
      "a job representation",
      "and it carried no ETag to cancel with",
    );
  }

  const result = await client.send({
    link,
    etag: fresh.value.etag,
    signal: options?.signal,
  });
  if (!result.ok) return asSessionGone(result);
  return { ok: true, value: undefined };
}

/** The one request both log readers make, and the one reading of its reply. */
async function readPage(
  client: ComputeClient,
  request: {
    link: Link;
    signal?: AbortSignal | undefined;
    timeoutMs?: number | undefined;
  },
): Promise<ComputeResult<LogPage>> {
  const result = await client.send(request);
  if (!result.ok) return asSessionGone(result);

  const body: unknown = result.value.body;
  const items: unknown =
    typeof body === "object" && body !== null
      ? (body as { items?: unknown }).items
      : undefined;
  if (!Array.isArray(items)) {
    // The most likely way to get here is asking for the wrong media type: `log`
    // and `logAsText` share an href, so a `text/plain` reply parses as no body
    // at all rather than as a collection with nothing in it.
    return malformed(result.value, "a log page", 'with no "items" array');
  }

  const lines: LogLine[] = [];
  for (const item of items as readonly unknown[]) {
    const parsed = readLine(item);
    if (parsed !== undefined) lines.push(parsed);
  }

  const next = findLink(readLinks(body), "next");
  return {
    ok: true,
    // `advance` is `items.length` and never `lines.length`: the cursor belongs
    // to the deployment's numbering, not to ours, and a dropped item still
    // occupied a position in it.
    value: {
      lines,
      advance: items.length,
      ...(next === undefined ? {} : { next }),
    },
  };
}

/**
 * One collection item as a {@link LogLine}, or `undefined` if there is no line
 * in it.
 *
 * `line` must be a string and may be an empty one; an item carrying no string
 * `line` has no text to show and is dropped rather than rendered as a hole. A
 * non-string `type` is dropped from the line instead of dropping the line, on
 * the same reasoning that `listContexts` drops a bad row rather than emptying a
 * good picker: the text is what the user came for.
 */
function readLine(item: unknown): LogLine | undefined {
  if (typeof item !== "object" || item === null) return undefined;
  const candidate = item as { line?: unknown; type?: unknown };
  if (typeof candidate.line !== "string") return undefined;
  return {
    line: candidate.line,
    ...(typeof candidate.type === "string" ? { type: candidate.type } : {}),
  };
}

/**
 * A job representation, or `undefined` if the body was not one.
 *
 * `id` and `state` are required and nothing else is read. The representation is
 * six fields wide (finding 46) and the rest — `creationTimeStamp`, `sessionId`,
 * `stateElapsedTime`, `version` — are left on the wire; `stateElapsedTime` in
 * particular is a stopwatch on the *current* state, which makes it useful for a
 * progress message and misleading as a total.
 */
function readJob(response: ComputeResponse): ComputeJob | undefined {
  const body: unknown = response.body;
  if (typeof body !== "object" || body === null) return undefined;

  const candidate = body as { id?: unknown; state?: unknown };
  const { id, state } = candidate;
  if (typeof id !== "string" || typeof state !== "string") return undefined;
  if (id === "" || state === "") return undefined;

  return { id, state, links: readLinks(body) };
}

/**
 * Adds parameters to an href, keeping any query the deployment already put there.
 *
 * The separator is chosen by looking rather than assumed, because a job's links
 * sit on both sides of that question: `log` has no query and `cancel` arrives as
 * `…/state?value=canceled` (finding 46). Nothing is rewritten — every byte the
 * deployment sent is still there, in order — which is the same rule
 * `session.ts` follows when it adds `wait`.
 */
function withQuery(href: string, parameters: readonly string[]): string {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}${parameters.join("&")}`;
}

/** A count that may be zero, or a `TypeError` naming the argument. */
function wholeNumber(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(
      `${name} must be a whole number of lines, not ${String(value)}`,
    );
  }
  return value;
}

/** A count that may not be zero, or a `TypeError` naming the argument. */
function positiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(
      `${name} must be a positive whole number, not ${String(value)}`,
    );
  }
  return value;
}

/**
 * The failure for a representation that carried no such relation.
 *
 * Takes the noun as an argument because two different resources are read here —
 * `execute` is missing from a *session*, `state` and `log` from a *job* — and
 * `link-missing` carries `resource` precisely so the message says which thing was
 * being read. Deriving the noun from the relation instead would be one `rel`
 * away from telling someone their session has no log.
 */
function linkMissing(
  resource: "compute session" | "compute job",
  id: string,
  rel: string,
): ComputeFailure {
  return {
    ok: false,
    reason: `the ${resource} carried no "${rel}" link in the response this account read`,
    problem: { code: "link-missing", rel, resource: `${resource} "${id}"` },
  };
}

/**
 * The failure for a 2xx that was not the representation expected.
 *
 * Describes the response by status and media type and says what was wrong with
 * it, never by quoting the body. A log page is the one *response* in this
 * project made entirely of the user's own program output, so a failure path that
 * echoed it would put arbitrary program text — and whatever that program printed
 * — into a log line, on the path where we have already decided we cannot read
 * what we were sent.
 *
 * The statements {@link createJob} sends are the same material travelling the
 * other way, and they are not the same problem: a `400` quoting the offending
 * statement back into `details` is the user's own text returning to the user's
 * own window, which is `problems.ts`'s reasoning for having no redaction pass.
 * What would change that is a request body carrying something the user did not
 * type — a token, a path, a credential — and nothing here sends one.
 */
function malformed(
  response: ComputeResponse,
  subject: string,
  defect: string,
): ComputeFailure {
  return {
    ok: false,
    reason: `the compute service did not answer with ${subject}`,
    problem: {
      code: "response-malformed",
      detail: `a job request answered HTTP ${String(response.status)} as ${response.contentType ?? "an unknown type"}, ${defect}`,
    },
  };
}
