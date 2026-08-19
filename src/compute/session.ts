// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Compute sessions — create one, watch it, take it down.
 *
 * **This module must never import `vscode`.**
 *
 * A session is a SAS process on the deployment, and everything this extension
 * eventually does — run Python, read the log, list libraries — happens inside
 * one. Finding 21 is why this module is as small as it is: the session
 * representation arrives carrying **22 link relations**, which is the entire
 * session API, so there is nothing here to build URLs with. Create, follow
 * `state`, follow `cancel`, follow `delete`.
 *
 * ## Sessions die, and that is normal
 *
 * `attributes.sessionInactiveTimeout` is **900 seconds** (finding 18). Fifteen
 * idle minutes is lunch. So a session going away is an ordinary event on the
 * happy path rather than an error, which is why {@link asSessionGone} exists and
 * why {@link deleteSession} treats "already gone" as success.
 *
 * ## The one composed URL, and why it is now here
 *
 * {@link attachSession} composes `/compute/sessions/{id}`, the second and last
 * composed URL in the project. It was deliberately absent until a slice had a
 * reason to want it, and 2a-ii is that slice: **ADR-0012** persists a session id
 * so a reloaded window can get its Python namespace back, and there is no link to
 * follow because the representation that carried the links died with the previous
 * window. A stored id is all that survives, so an id is what this takes.
 *
 * ## What is deliberately not here
 *
 * No reclaim-by-listing. `GET /compute/sessions` filtered by `owner` and
 * `applicationName` does find every session this extension started for this user
 * (finding 25), and ADR-0012 rejects building on it: session names are not unique
 * (finding 26), so the filter returns candidates rather than an answer.
 *
 * No retry. Every function here makes one request and reports what happened; a
 * caller that wants to retry knows things this layer does not, such as whether
 * the user is still waiting.
 */

import {
  type ComputeClient,
  type ComputeFailure,
  type ComputeRequest,
  type ComputeResponse,
  type ComputeResult,
} from "./client";
import { type ComputeContext, CREATE_SESSION_REL } from "./contexts";
import { findLink, type Link, readLinks } from "./links";

/** The relation on a session that reads its state. `GET`, `text/plain`. */
export const STATE_REL = "state";

/** The relation that stops a running job. `PUT …/state?value=canceled`. */
export const CANCEL_REL = "cancel";

/** The relation that shuts the SAS process down. `DELETE`, `204`. */
export const DELETE_REL = "delete";

/**
 * The sessions collection, under which {@link attachSession} composes one id.
 *
 * The second and last composed path in the project, after `CONTEXTS_PATH`, and
 * root-relative for the same reason: it goes through `resolveHref` on exactly the
 * terms a server-sent href does.
 */
export const SESSIONS_PATH = "/compute/sessions";

/**
 * The media type of a single session, before {@link computeMediaType} adds
 * `+json`. The type the create call answered with (finding 21).
 */
const SESSION_TYPE = "application/vnd.sas.compute.session";

/**
 * The state a session is in when it is created (finding 18), and the only state
 * name this module knows.
 *
 * That is deliberate. Upstream keeps a seven-member `ComputeState` enum and a
 * couple of hand-maintained arrays of "done" states — one of which,
 * `ComputeJob.isDone()`, tests `indexOf(state) === -1` and therefore returns
 * `true` when the job is **not** done. It is dead code, which is the only reason
 * that has never bitten anyone.
 *
 * The probe has observed exactly one session state, so exactly one is named here.
 * {@link waitWhilePending} waits for this one to end and hands the caller whatever
 * came next; deciding whether `idle`, `error` or something a future Viya invents
 * is good news is the caller's business, made with more context than this module
 * has. A list of state names we have never seen would look like knowledge.
 */
export const PENDING_STATE = "pending";

/**
 * The name a created session carries, which is what an administrator sees in SAS
 * Environment Manager next to a running process.
 *
 * Not localised, on purpose: it is an identifier on the server side, it ends up
 * in someone else's monitoring view, and a session that calls itself different
 * things depending on the language the editor happens to be running in is
 * unsearchable. (Upstream sends `"mysess"`, described as `"This is a session"`.)
 */
export const SESSION_NAME = "python-on-viya";

/** The description sent alongside {@link SESSION_NAME}. Same reasoning. */
export const SESSION_DESCRIPTION = "Python on Viya — VS Code extension session";

/**
 * The request representation version sent when creating a session.
 *
 * `1` is what the probe sent to get its `201` (finding 21). It describes the
 * shape of the body *we* send, not the deployment's API version, so it changes
 * only if this body changes.
 */
const SESSION_REQUEST_VERSION = 1;

/** How long the server is asked to hold a state poll open, in seconds. */
export const DEFAULT_WAIT_SECONDS = 10;

/**
 * Extra time allowed on top of the server's wait before the client gives up.
 *
 * The state poll asks the deployment to hold the connection for `wait` seconds
 * (finding 19), so the request timeout has to outlive that or the client aborts
 * every poll a moment before it was going to answer — a long poll that always
 * fails, and the failure looks like an unreachable service.
 */
export const WAIT_MARGIN_SECONDS = 15;

/**
 * How many state windows {@link waitWhilePending} will open before giving up.
 *
 * Thirty at the default ten-second window is five minutes, which is far beyond
 * any session start observed and still short enough that a user is not left
 * watching a spinner over a compute context that cannot launch.
 *
 * The bound also covers a case the deployment has not shown us. The wait is
 * honoured server-side **when a validator is sent**; a deployment that answered a
 * bare `?wait=N` immediately would turn this loop into a hot one, and this number
 * is what stops that being unbounded. See {@link readSessionState}.
 */
export const MAX_WAIT_WINDOWS = 30;

/**
 * A compute session, reduced to what the rest of the extension needs.
 *
 * `links` is the interesting field — 22 relations, and every later slice's
 * entry point (`execute`, `log`, `librefs`, `files`) is one of them, which is why
 * they are kept whole rather than picked over here.
 */
export interface ComputeSession {
  readonly id: string;
  /** As last read. A state is a fact about a moment, not a property of the session. */
  readonly state: string;
  /**
   * The `ETag` from the response that produced this session.
   *
   * Also the validator the `state` resource uses: the create call and the first
   * state read returned byte-identical ETags (finding 21), which is what lets a
   * poll start from a freshly created session with no extra round trip.
   */
  readonly etag?: string | undefined;
  /** `attributes.sessionInactiveTimeout` — 900 on the observed deployment. */
  readonly inactiveTimeoutSeconds?: number | undefined;
  readonly links: readonly Link[];
}

export interface CreateSessionOptions {
  /** SAS system options for the session environment, e.g. `PAGESIZE=MAX`. */
  options?: readonly string[] | undefined;
  /** Lines run before anything else. Slice 3a's session setup uses this. */
  autoExecLines?: readonly string[] | undefined;
  signal?: AbortSignal | undefined;
}

export interface StateOptions {
  /** Seconds the deployment is asked to hold the connection open. */
  waitSeconds?: number | undefined;
  /**
   * An `ETag` **from an earlier state reading**, turning the request into a long
   * poll that answers when the state changes.
   *
   * The session's own ETag works here — the two were identical at creation
   * (finding 21) — but pass the one the last reading returned when there is one,
   * because that is the value the resource itself is versioning.
   */
  ifNoneMatch?: string | undefined;
  signal?: AbortSignal | undefined;
}

/**
 * The answer to one state poll.
 *
 * `changed: false` is the `304`, and it carries **no state**, which is the whole
 * point. Upstream's equivalent recurses to fetch the state it just declined to
 * be sent, under its author's comment *"This is bad. We need to cache the last
 * state value."* Making the unchanged case structurally stateless means a caller
 * cannot accidentally do that: there is nothing to read, so it has to keep what
 * it already had.
 */
export type StateReading =
  | {
      readonly changed: true;
      readonly state: string;
      readonly etag?: string | undefined;
    }
  | { readonly changed: false };

/**
 * Creates a session from a resolved context.
 *
 * The response is a `201` carrying `Location`, an `ETag`, and the full
 * representation. `Location` is **not** used: the body already has the links, so
 * fetching the location would be a second round trip for something we were just
 * handed. If a deployment is ever seen answering `201` with an empty body, this
 * is where the fallback goes.
 */
export async function createSession(
  client: ComputeClient,
  context: ComputeContext,
  options?: CreateSessionOptions,
): Promise<ComputeResult<ComputeSession>> {
  const link = findLink(context.links, CREATE_SESSION_REL);
  if (link === undefined) {
    // `resolveContext` already refuses a context without this link, but a
    // context can also arrive from `listContexts`, and a check here costs one
    // comparison rather than a `POST` to `undefined`.
    return {
      ok: false,
      reason: `the compute context "${context.name}" carried no "${CREATE_SESSION_REL}" link in the response this account read`,
      problem: {
        code: "link-missing",
        rel: CREATE_SESSION_REL,
        resource: `compute context "${context.name}"`,
      },
    };
  }

  const result = await client.send({
    link,
    body: {
      version: SESSION_REQUEST_VERSION,
      name: SESSION_NAME,
      description: SESSION_DESCRIPTION,
      attributes: {},
      environment: {
        options: options?.options ?? [],
        autoExecLines: options?.autoExecLines ?? [],
      },
    },
    signal: options?.signal,
  });
  if (!result.ok) return result;

  const session = readSession(result.value);
  if (session === undefined) return malformed(result.value, NOT_A_SESSION);
  return { ok: true, value: session };
}

/**
 * Re-reads a session by id, for a window that has one stored.
 *
 * This is the reconnect path ADR-0012 describes, and the stored id is a **hint**:
 * the only way to find out whether a session is still there is to ask for it, so
 * this is the ask. A `404` means it is not — the session expired, was deleted,
 * lost its node, or the id was never real — and finding 29 measured all four as
 * the same response, which is why {@link asSessionGone} states no cause. A caller
 * that gets `session-gone` here creates a new session; that is the whole protocol.
 *
 * There is no cheaper check to do first. A `HEAD`, a state read, or a listing all
 * cost the same round trip and answer a narrower question, so probing before use
 * would only add a way for the answer to change in between.
 *
 * A success carries the full representation, links included, so a reattached
 * session is indistinguishable from a freshly created one everywhere else.
 */
export async function attachSession(
  client: ComputeClient,
  id: string,
  options?: { signal?: AbortSignal | undefined },
): Promise<ComputeResult<ComputeSession>> {
  const result = await client.send({
    link: sessionLink(id),
    signal: options?.signal,
  });
  if (!result.ok) return asSessionGone(result);

  const session = readSession(result.value);
  if (session === undefined) return malformed(result.value, NOT_A_SESSION);
  return { ok: true, value: session };
}

/**
 * Reads the session state once, optionally as a long poll.
 *
 * With `ifNoneMatch` set, the deployment holds the connection for `waitSeconds`
 * and answers `304` if nothing changed (finding 19) — one round trip per window,
 * no `setTimeout`, and the request timeout is stretched past the server's wait so
 * the client is not the thing that gives up first.
 *
 * The state resource is `text/plain`: the body is the bare word `pending`, seven
 * bytes with no trailing newline. It is trimmed anyway, because a deployment that
 * adds one should not change the meaning of a state.
 */
export async function readSessionState(
  client: ComputeClient,
  session: ComputeSession,
  options?: StateOptions,
): Promise<ComputeResult<StateReading>> {
  const link = findLink(session.links, STATE_REL);
  if (link === undefined) return linkMissing(session, STATE_REL);

  const waitSeconds = options?.waitSeconds ?? DEFAULT_WAIT_SECONDS;
  const request: ComputeRequest = {
    link: { ...link, href: withWait(link.href, waitSeconds) },
    ifNoneMatch: options?.ifNoneMatch,
    signal: options?.signal,
    timeoutMs: (waitSeconds + WAIT_MARGIN_SECONDS) * 1000,
  };

  const result = await client.send(request);
  if (!result.ok) return asSessionGone(result);

  if (result.value.notModified) return { ok: true, value: { changed: false } };

  const state = result.value.text.trim();
  if (state === "") {
    return malformed(result.value, "and the state resource was empty");
  }
  return {
    ok: true,
    value: {
      changed: true,
      state,
      ...(result.value.etag === undefined ? {} : { etag: result.value.etag }),
    },
  };
}

/**
 * Waits for a newly created session to stop being `pending`, and reports what it
 * became.
 *
 * Returns the first state that is not {@link PENDING_STATE} — it does not judge
 * it. A session that comes up in `error` is a real answer to "is it ready", and
 * the caller is the one that knows whether to say so, retry, or take the session
 * down.
 *
 * The session's own state is checked before any request, so a session that is
 * already past `pending` costs nothing.
 */
export async function waitWhilePending(
  client: ComputeClient,
  session: ComputeSession,
  options?: StateOptions,
): Promise<ComputeResult<ComputeSession>> {
  const waitSeconds = options?.waitSeconds ?? DEFAULT_WAIT_SECONDS;
  let current = session;

  for (let window = 0; window < MAX_WAIT_WINDOWS; window += 1) {
    if (current.state !== PENDING_STATE) return { ok: true, value: current };

    const reading = await readSessionState(client, current, {
      waitSeconds,
      ifNoneMatch: current.etag,
      signal: options?.signal,
    });
    if (!reading.ok) return reading;

    // A `304` says the state is still what we hold, so there is nothing to
    // update and the next window simply asks again.
    if (reading.value.changed) {
      current = {
        ...current,
        state: reading.value.state,
        ...(reading.value.etag === undefined
          ? {}
          : { etag: reading.value.etag }),
      };
    }
  }

  const seconds = MAX_WAIT_WINDOWS * waitSeconds;
  return {
    ok: false,
    reason: `the compute session stayed "${current.state}" for ${String(seconds)} seconds`,
    problem: { code: "session-not-ready", state: current.state, seconds },
  };
}

/**
 * Cancels whatever the session is doing, without taking the session down.
 *
 * Follows the `cancel` link, which the deployment sends fully formed as
 * `PUT …/state?value=canceled` (finding 21) — including its query string, which
 * is why this is a one-line follow rather than a request builder.
 *
 * **No `If-Match`, and no retry loop.** Upstream sends the ETag it happens to
 * hold and, on the `412` that produces, re-reads the session and calls itself
 * again — unbounded, with no delay, on the path that is by definition already
 * going wrong. Sending no validator means there is no `412` to recover from.
 */
export async function cancelSession(
  client: ComputeClient,
  session: ComputeSession,
  options?: { signal?: AbortSignal | undefined },
): Promise<ComputeResult<void>> {
  const link = findLink(session.links, CANCEL_REL);
  if (link === undefined) return linkMissing(session, CANCEL_REL);

  const result = await client.send({ link, signal: options?.signal });
  if (!result.ok) return asSessionGone(result);
  return { ok: true, value: undefined };
}

/**
 * Shuts the session down, ending the SAS process.
 *
 * **A `404` is success.** This runs on teardown, often while something else has
 * already failed, and "the session you wanted gone is gone" is the outcome the
 * caller asked for. Reporting it as an error would put a second, misleading
 * failure in the log underneath the real one.
 *
 * No `If-Match` either: the deployment answered `204` without one (finding 18),
 * and an ETag we are not certain of turns a working teardown into a `412` that
 * leaves a SAS process running until the 900-second timeout reaps it.
 */
export async function deleteSession(
  client: ComputeClient,
  session: ComputeSession,
  options?: { signal?: AbortSignal | undefined },
): Promise<ComputeResult<void>> {
  const link = findLink(session.links, DELETE_REL);
  if (link === undefined) return linkMissing(session, DELETE_REL);

  const result = await client.send({ link, signal: options?.signal });
  if (result.ok) return { ok: true, value: undefined };
  if (isNotFound(result)) return { ok: true, value: undefined };
  return result;
}

/**
 * Re-reads a `404` from a session resource as "the session is gone".
 *
 * The client cannot make this call itself: it does not know whether a `404` meant
 * a missing session, a missing context, or a service that is not deployed at that
 * path — only the caller that built the request knows, which is why
 * `compute-rejected` is left deliberately unclassified there and narrowed here.
 *
 * **Only a `404`.** `problems.ts` originally described this as folding a `401`
 * in as well, on the reasoning that a dead session and a dead token are one
 * recoverable event. They are not: the remedy for one is to create another
 * session and the remedy for the other is to obtain another token, so a `401`
 * relabelled here would send a caller round a loop creating sessions with a
 * credential that cannot create them. Slice 1c's `WWW-Authenticate` analysis
 * already reaches the right answer for a `401`, and the client hands it over
 * intact.
 *
 * Exported because the job calls need exactly this reading of a `404`. Written
 * expecting slice 3a; `job.ts` arrived in 2c-i and took it, and the caveat that
 * came with it is recorded there — finding 53 established that a `404` on a job
 * resource cannot be told apart from a `404` on a dead session by status alone.
 */
export function asSessionGone(failure: ComputeFailure): ComputeFailure {
  const { problem } = failure;
  if (problem.code !== "compute-rejected" || problem.error.status !== 404) {
    return failure;
  }
  return {
    ok: false,
    reason: "the compute session is no longer available",
    problem: { code: "session-gone", error: problem.error },
  };
}

/** What {@link malformed} says when a 2xx body was not a session at all. */
const NOT_A_SESSION =
  "and it was not a session representation with an id and a state";

/**
 * A link for one session by id, so {@link attachSession} enters the client the
 * same way a followed relation does.
 *
 * The id is percent-encoded rather than trusted. It has come back out of
 * `workspaceState`, which is a file on disk that anything on the machine can
 * write, and an id containing `../` or a `?` would otherwise compose a request to
 * a path nobody chose. Every id observed is `[0-9a-f-]` and is unaffected by
 * encoding, so this costs nothing in the real case.
 *
 * `responseType` rather than `type`, matching `contextsLink`: there is no request
 * body to describe, and on a `GET` the client prefers `responseType` for `Accept`.
 *
 * Throws on an empty id, which is a caller defect rather than a runtime
 * condition — the store's parser rejects an empty id, so reaching here with one
 * means something composed a key by hand. `GET /compute/sessions` is the whole
 * collection, and a listing is not what anyone calling this asked for.
 */
function sessionLink(id: string): Link {
  if (id === "") throw new TypeError("a compute session id cannot be empty");
  return {
    rel: "self",
    method: "GET",
    href: `${SESSIONS_PATH}/${encodeURIComponent(id)}`,
    responseType: SESSION_TYPE,
  };
}

/** Whether a failure is the compute service reporting a `404`. */
function isNotFound(failure: ComputeFailure): boolean {
  return (
    failure.problem.code === "compute-rejected" &&
    failure.problem.error.status === 404
  );
}

/**
 * Adds `wait` to a state href, keeping any query the deployment already put there.
 *
 * This is the one place a server-sent href is *extended*. It is not rewritten —
 * every byte the deployment sent is still there, in order — and the separator is
 * chosen by looking, because finding 21 shows hrefs on both sides of that
 * question: `state` has no query and `cancel` arrives as
 * `…/state?value=canceled`, so assuming either would be wrong half the time.
 */
function withWait(href: string, seconds: number): string {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}wait=${String(seconds)}`;
}

/**
 * A session representation, or `undefined` if the body was not one.
 *
 * `id` and `state` are required; everything else the payload carries —
 * `applicationName`, `owner`, `serverId`, `creationTimeStamp`,
 * `sessionConditionCode` — is left on the wire until something needs it. Note
 * that `applicationName` is the OAuth client id and `owner` is the user's email
 * address, so not reading them is also the reason neither can end up in a log.
 */
function readSession(response: ComputeResponse): ComputeSession | undefined {
  const body: unknown = response.body;
  if (typeof body !== "object" || body === null) return undefined;

  const candidate = body as { id?: unknown; state?: unknown };
  const { id, state } = candidate;
  if (typeof id !== "string" || typeof state !== "string") return undefined;
  if (id === "" || state === "") return undefined;

  const timeout = readInactiveTimeout(body);
  return {
    id,
    state,
    ...(response.etag === undefined ? {} : { etag: response.etag }),
    ...(timeout === undefined ? {} : { inactiveTimeoutSeconds: timeout }),
    links: readLinks(body),
  };
}

/**
 * `attributes.sessionInactiveTimeout`, in seconds, when the deployment reports it.
 *
 * Read rather than assumed, even though every deployment seen says 900, because
 * it is a configurable and the number is one 2a-ii wants to put in front of the
 * user: "sessions here expire after 15 minutes" is worth saying, and saying it
 * wrongly is worse than not saying it.
 */
function readInactiveTimeout(body: object): number | undefined {
  const attributes: unknown = (body as { attributes?: unknown }).attributes;
  if (typeof attributes !== "object" || attributes === null) return undefined;
  const value: unknown = (attributes as { sessionInactiveTimeout?: unknown })
    .sessionInactiveTimeout;
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** The failure for a session representation that carried no such relation. */
function linkMissing(session: ComputeSession, rel: string): ComputeFailure {
  return {
    ok: false,
    reason: `the compute session carried no "${rel}" link in the response this account read`,
    problem: {
      code: "link-missing",
      rel,
      resource: `compute session "${session.id}"`,
    },
  };
}

/**
 * The failure for a 2xx that was not the representation expected.
 *
 * Describes the response by status and media type and says what was wrong with
 * it, never by quoting the body — a session payload contains the OAuth client id
 * and the user's email address, and this is the path where we have already
 * decided we cannot read what we were sent.
 */
function malformed(response: ComputeResponse, defect: string): ComputeFailure {
  return {
    ok: false,
    reason: "the compute service did not answer with a session representation",
    problem: {
      code: "response-malformed",
      detail: `a session request answered HTTP ${String(response.status)} as ${response.contentType ?? "an unknown type"}, ${defect}`,
    },
  };
}
