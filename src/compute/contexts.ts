// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Compute contexts — finding the one a profile names, in a single call.
 *
 * **This module must never import `vscode`.**
 *
 * A compute context is a server-side template for a SAS session: which launcher
 * to use, which autoexec to run, which options to set. Everything this extension
 * does on Viya happens inside a session, and a session is created *from* a
 * context — so resolving the profile's context name to a startable thing is the
 * first request of every run, and the first place a misconfigured profile shows
 * itself.
 *
 * ## The one composed URL in the project
 *
 * ADR-0010 says the only URL we write down is the deployment root and everything
 * below it is navigated by link relation. That has to bottom out somewhere: the
 * contexts collection is the entry point, so {@link CONTEXTS_PATH} is the single
 * path this project composes. Every href after it comes from the service — the
 * `next` link when paging, and the `createSession` link a caller hands to
 * `session.ts`.
 *
 * It is deliberately *not* discovered by reading the API root first. That would
 * be one more round trip on every run, on a resource whose link relations have
 * not been observed, to avoid writing down a path that has been stable across
 * every Viya version in scope.
 *
 * ## Two traps, both from finding 15 and finding 16
 *
 * **The filter is a string literal and the escape is doubling the quote.**
 * Upstream interpolates the context name straight into
 * `eq(name,'…')` with no escaping at all, so a context named `Ford's context`
 * produces a `400` and a message about an invalid filter that names neither the
 * context nor the reason. Confirmed against the deployment: `''` is the escape,
 * a backslash is not, and both the backslash form and the bare form are a `400`
 * with `errorCode` 1104.
 *
 * **`count` is unusable and nothing here reads it.** The collection reports a
 * real `count` only when the page already holds everything, and `null` whenever
 * it does not — including on the last page of a traversal. Read as a number,
 * `null` is `0`, so a `count`-driven pager concludes there are no compute
 * contexts, which is the one answer that is never true. Paging terminates on the
 * **absence of a `next` link**, and `items` is authoritative for what is on the
 * page.
 */

import {
  type ComputeClient,
  type ComputeResponse,
  type ComputeResult,
} from "./client";
import { findLink, type Link, readLinks } from "./links";

/**
 * The contexts collection. The only path this project composes; see above.
 *
 * Root-relative and carrying the service prefix, exactly as every href the
 * service itself produces does (finding 13), so it goes through `resolveHref`
 * on the same terms as a link we were handed.
 */
export const CONTEXTS_PATH = "/compute/contexts";

/** The relation on a context that starts a session with it. */
export const CREATE_SESSION_REL = "createSession";

/**
 * The `Accept` for a collection, before {@link computeMediaType} adds `+json`.
 *
 * Named here rather than inlined because it is the media type the probe asked
 * for, and asking for one the deployment does not serve is a `406` that fails
 * the request outright (finding 6) rather than falling back to something usable.
 */
const COLLECTION_TYPE = "application/vnd.sas.collection";

/**
 * How many pages a traversal will follow before giving up.
 *
 * Paging is driven by an href the *server* chooses, so termination is the
 * server's decision, not ours. A deployment whose `next` link points back at the
 * page that produced it would spin here forever, holding a progress notification
 * open and re-sending the user's token once per round trip. A hundred pages is
 * far past any real deployment — thirteen contexts is a large installation — and
 * exceeding it is reported as a malformed response, because that is what it is.
 */
export const MAX_PAGES = 100;

/**
 * A compute context, reduced to what this extension uses.
 *
 * `links` rather than a resolved href, because the whole point of finding 15 is
 * that the *summary* item already carries a fully-formed `createSession` link —
 * `POST`, with both a request and a response media type — so `session.ts` can
 * follow it without the extra `GET /compute/contexts/{id}` upstream does. Keep
 * the links and that saving survives; keep an id and it is thrown away.
 */
export interface ComputeContext {
  readonly id: string;
  readonly name: string;
  readonly links: readonly Link[];
}

/** Options shared by both lookups. */
export interface ContextOptions {
  /** Cancels the request in flight. Passed straight through to the client. */
  signal?: AbortSignal | undefined;
}

/**
 * Quotes a value for a Viya filter string literal.
 *
 * The escape is **doubling the apostrophe**, which is SQL's rule rather than
 * C's, and getting it wrong is not a silent difference: a backslash escape is a
 * `400` from the filter parser, indistinguishable at the call site from a
 * deployment that is simply broken.
 *
 * The apostrophe is the **only** character this has to escape, and that is
 * measured rather than assumed — probe finding 22. `(`, `)`, `,`, `"`, `\` and
 * whitespace are ordinary text once the literal is open, confirmed by composing
 * each of them with a term that does match, in both orders, so that a parser
 * ending the literal early could not have returned the right answer anyway.
 *
 * Percent-encoding is a separate escape and still required: `&` and `#` end a
 * query parameter in the URL before the filter parser ever sees them.
 * {@link contextsLink} does that, after this — see {@link contextFilter} for why
 * the order is the only one that works.
 *
 * Exported because it is the piece worth testing directly, and because
 * `session.ts` and anything later that filters by name must use this one rather
 * than growing its own interpolation.
 */
export function quoteFilterValue(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * The `filter` expression that matches a context by exact name.
 *
 * Not percent-encoded — {@link contextsLink} does that, because the doubling has
 * to happen **before** the encoding. Double first and `%27%27` reaches the
 * parser as the escaped quote it is; encode first and the doubling is applied to
 * text that no longer contains a quote to double.
 */
export function contextFilter(name: string): string {
  return `eq(name,${quoteFilterValue(name)})`;
}

/**
 * Resolves a context by name, in one request.
 *
 * Returns `no-such-context` when the collection answers with an empty `items`,
 * which is also what the deployment says when the context exists but this user
 * may not see it — the two are the same response by design, which is why the
 * message `describeComputeProblem` writes offers both readings.
 *
 * A `404` here is **not** turned into `no-such-context`. A 404 on the collection
 * means the Compute service is not at that path at all, which is a deployment
 * problem and not a naming one; relabelling it would send someone to check the
 * spelling of a setting that is spelled correctly.
 */
export async function resolveContext(
  client: ComputeClient,
  name: string,
  options?: ContextOptions,
): Promise<ComputeResult<ComputeContext>> {
  const filter = encodeURIComponent(contextFilter(name));
  const result = await client.send({
    link: contextsLink(`filter=${filter}`),
    signal: options?.signal,
  });
  if (!result.ok) return result;

  const items = readItems(result.value);
  if (items === undefined)
    return malformed(result.value, 'with no "items" array');

  const first = items[0];
  if (first === undefined) {
    return {
      ok: false,
      reason: `no compute context named "${name}" was returned by the deployment`,
      problem: { code: "no-such-context", name },
    };
  }

  // Deliberately the first of however many. Viya does not enforce that context
  // names are unique, so `eq(name,…)` can match more than one; taking the first
  // is at least deterministic, in the order the service chose, and the same
  // answer on every run. Failing instead would break a deployment that works
  // perfectly well in SAS Studio.
  // The filter said this item matched, so an item without a string `id` and
  // `name` is a shape change rather than one bad row to skip past — which is
  // why this is fatal here and merely dropped in `listContexts`.
  const context = readContext(first);
  if (context === undefined) {
    return malformed(
      result.value,
      "and the matching item carried no id and name",
    );
  }

  // Checked here rather than at session creation. If this link is absent the
  // one-call design does not apply to this deployment, and saying so while we
  // still know which context was being resolved is worth more than a failure
  // three steps later that can only say a link was missing.
  if (findLink(context.links, CREATE_SESSION_REL) === undefined) {
    return {
      ok: false,
      reason: `the compute context "${name}" does not offer a "${CREATE_SESSION_REL}" link`,
      problem: {
        code: "link-missing",
        rel: CREATE_SESSION_REL,
        resource: `compute context "${name}"`,
      },
    };
  }

  return { ok: true, value: context };
}

/**
 * Every context this user can see, following `next` to the end.
 *
 * For the picker in 2a-ii, and for telling someone which names their deployment
 * actually offers when the one in their profile is not among them.
 *
 * Items that cannot be read are **dropped rather than fatal**, on the same
 * reasoning as `readLinks`: one context with a missing name should not empty a
 * picker that has twelve good entries in it.
 */
export async function listContexts(
  client: ComputeClient,
  options?: ContextOptions,
): Promise<ComputeResult<readonly ComputeContext[]>> {
  const contexts: ComputeContext[] = [];
  let link: Link | undefined = contextsLink("");

  for (let page = 0; link !== undefined; page += 1) {
    if (page >= MAX_PAGES) {
      return {
        ok: false,
        reason:
          "the compute service never stopped paging the contexts collection",
        problem: {
          code: "response-malformed",
          detail: `the contexts collection still offered a "next" link after ${String(MAX_PAGES)} pages`,
        },
      };
    }

    const result = await client.send({ link, signal: options?.signal });
    if (!result.ok) return result;

    const items = readItems(result.value);
    if (items === undefined) {
      return malformed(result.value, 'with no "items" array');
    }

    for (const item of items) {
      const context = readContext(item);
      if (context !== undefined) contexts.push(context);
    }

    // The only termination condition. Nothing above reads `count`, which is
    // `null` on exactly the pages a pager would want it (finding 16), and
    // nothing counts items against a total for the same reason.
    link = findLink(readLinks(result.value.body), "next");
  }

  return { ok: true, value: contexts };
}

/**
 * A link for the contexts collection, so the client is entered the same way it
 * is entered everywhere else.
 *
 * `responseType` rather than `type`: on a `GET` the client prefers
 * `responseType` and falls back to `type`, and this request has no body to
 * describe. The query arrives already percent-encoded and is concatenated, never
 * re-encoded — the same rule `resolveHref` follows for a server-sent href.
 */
function contextsLink(query: string): Link {
  return {
    rel: "contexts",
    method: "GET",
    href: query === "" ? CONTEXTS_PATH : `${CONTEXTS_PATH}?${query}`,
    responseType: COLLECTION_TYPE,
  };
}

/** The `items` of a collection body, or `undefined` if there is no array there. */
function readItems(response: ComputeResponse): readonly unknown[] | undefined {
  const body: unknown = response.body;
  if (typeof body !== "object" || body === null) return undefined;
  const items: unknown = (body as { items?: unknown }).items;
  return Array.isArray(items) ? (items as readonly unknown[]) : undefined;
}

/**
 * One collection item as a {@link ComputeContext}, or `undefined`.
 *
 * `id` and `name` are both required: a context with no name cannot be matched
 * against a profile setting, and one with no id cannot be identified in a log or
 * a picker. Anything else the item carries — `attributes`, `createdBy`,
 * `version` — is left on the wire.
 */
function readContext(item: unknown): ComputeContext | undefined {
  if (typeof item !== "object" || item === null) return undefined;
  const candidate = item as { id?: unknown; name?: unknown };
  const { id, name } = candidate;
  if (typeof id !== "string" || typeof name !== "string") return undefined;
  if (id === "" || name === "") return undefined;
  return { id, name, links: readLinks(item) };
}

/**
 * The failure for a 2xx that was not a contexts collection.
 *
 * Describes the response **by status and media type** and says what was wrong
 * with it, never by quoting the body: this runs on a response we have already
 * decided we cannot read, and a payload of unknown provenance is not something
 * to put in a log.
 */
function malformed(
  response: ComputeResponse,
  defect: string,
): ComputeResult<never> {
  return {
    ok: false,
    reason: "the compute service did not answer with a contexts collection",
    problem: {
      code: "response-malformed",
      detail: `${CONTEXTS_PATH} answered HTTP ${String(response.status)} as ${response.contentType ?? "an unknown type"}, ${defect}`,
    },
  };
}
