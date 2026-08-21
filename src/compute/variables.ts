// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Session variables — the read `SYSCC` needs, and nothing else.
 *
 * **This module must never import `vscode`.**
 *
 * ADR-0014 settled that a program's success is read from `SYSCC`, not from the
 * job's terminal state: finding 33 measured a job reporting `completed` having
 * executed nothing at all, after a poisoned session swallowed its statements as
 * string content. `SYSCC` is `1012` for an unhandled Python exception, `3000` for
 * a SAS-side syntax error, `0` otherwise (finding 37) — and it is live session
 * state, not a snapshot: a `%let` set inside a job showed up here immediately,
 * with no reset sent by the client. `SYSERR` and `SYSERRORTEXT` read the same
 * way, and slice 3a's diagnostics come from them.
 *
 * ## Why this follows a link and filters, rather than composing a path
 *
 * Finding 37 measured `GET /compute/sessions/{id}/variables/SYSCC` working, but
 * never established whether that path is one the deployment hands back as a
 * link or one this project would have to compose by hand — and ADR-0010
 * forbids the latter. Finding 60 (probed 2026-08-21, before this module was
 * written) settled it: the session's `variables` relation is a real link, each
 * collection item carries its own `self` href built exactly that way, and — more
 * usefully — a name filter on the collection returns the value **inline**, so
 * reading one variable is one request rather than a filter-then-follow. That is
 * the shape this module uses; the single-item `self` link is never followed.
 *
 * ## The filter is the same escape `contexts.ts` already uses
 *
 * `quoteFilterValue` is imported rather than restated, because finding 22
 * already measured the apostrophe as the only character a Viya filter literal
 * has to escape, and every variable name this module is ever asked to read
 * (`SYSCC`, `SYSERR`, `SYSERRORTEXT`) is an unquoted SAS name that could not
 * contain one anyway — the shared function is what stops a future caller from
 * growing a second, untested interpolation for a case that cannot occur today.
 */

import {
  type ComputeClient,
  type ComputeFailure,
  type ComputeResponse,
  type ComputeResult,
} from "./client";
import { quoteFilterValue } from "./contexts";
import { findLink } from "./links";
import { asSessionGone, type ComputeSession } from "./session";

/** The relation on a session that lists its variables. `GET`, a collection. */
export const VARIABLES_REL = "variables";

export interface ReadVariableOptions {
  signal?: AbortSignal | undefined;
}

/**
 * Reads one session variable's value.
 *
 * Follows the session's `variables` relation and filters it by name — one
 * request, since finding 60 measured the filtered item carrying `value`
 * inline. Returns `undefined` rather than a failure when the filter matches
 * nothing: `SYSCC`, `SYSERR` and `SYSERRORTEXT` are guaranteed to exist on
 * every session (finding 37), so an absent match is a surprise worth handing
 * back to the caller to judge rather than one this module decides is fatal on
 * a probe that only ever tried a name known to exist.
 */
export async function readVariable(
  client: ComputeClient,
  session: ComputeSession,
  name: string,
  options?: ReadVariableOptions,
): Promise<ComputeResult<string | undefined>> {
  const link = findLink(session.links, VARIABLES_REL);
  if (link === undefined) {
    return linkMissing(session.id, VARIABLES_REL);
  }

  const filter = encodeURIComponent(`eq(name,${quoteFilterValue(name)})`);
  const result = await client.send({
    link: { ...link, href: withQuery(link.href, `filter=${filter}`) },
    signal: options?.signal,
  });
  if (!result.ok) return asSessionGone(result);

  const items = readItems(result.value);
  if (items === undefined) {
    return malformed(result.value, name, 'and it carried no "items" array');
  }

  // Re-checked by name rather than trusted from position: the filter is the
  // deployment's to honour, and an item that turned up under a name filter it
  // does not match would be a false "found" this module has no business acting
  // on. Nothing has ever measured that happening; the check costs one string
  // comparison against a page that is one item long.
  const matched = items.find((item) => readName(item) === name);
  if (matched === undefined) {
    return { ok: true, value: undefined };
  }

  const value = readValue(matched);
  if (value === undefined) {
    return malformed(
      result.value,
      name,
      `and the matching item carried no string "value"`,
    );
  }
  return { ok: true, value };
}

/** Adds a query parameter to an href, keeping any query already there. */
function withQuery(href: string, parameter: string): string {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}${parameter}`;
}

/** The `items` of a collection body, or `undefined` if there is no array there. */
function readItems(response: ComputeResponse): readonly unknown[] | undefined {
  const body: unknown = response.body;
  if (typeof body !== "object" || body === null) return undefined;
  const items: unknown = (body as { items?: unknown }).items;
  return Array.isArray(items) ? (items as readonly unknown[]) : undefined;
}

/** An item's `name`, or `undefined` if it is not a string. */
function readName(item: unknown): string | undefined {
  if (typeof item !== "object" || item === null) return undefined;
  const name: unknown = (item as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

/** An item's `value`, or `undefined` if it is not a string. */
function readValue(item: unknown): string | undefined {
  if (typeof item !== "object" || item === null) return undefined;
  const value: unknown = (item as { value?: unknown }).value;
  return typeof value === "string" ? value : undefined;
}

/** The failure for a session that carried no `variables` link. */
function linkMissing(sessionId: string, rel: string): ComputeFailure {
  return {
    ok: false,
    reason: `the compute session carried no "${rel}" link in the response this account read`,
    problem: {
      code: "link-missing",
      rel,
      resource: `compute session "${sessionId}"`,
    },
  };
}

/** The failure for a 2xx that was not a variables collection. */
function malformed(
  response: ComputeResponse,
  name: string,
  defect: string,
): ComputeFailure {
  return {
    ok: false,
    reason: `the compute service did not answer with a variables collection`,
    problem: {
      code: "response-malformed",
      detail: `a filtered read for variable "${name}" answered HTTP ${String(response.status)} as ${response.contentType ?? "an unknown type"}, ${defect}`,
    },
  };
}
