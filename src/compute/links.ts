// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Links — how every Compute request after the first one is addressed.
 *
 * **This module must never import `vscode`.**
 *
 * The Compute service is hypermedia-driven. A representation arrives carrying a
 * `links` array, and each entry says what may be done next, by which method, at
 * which URL, with which media types:
 *
 * ```json
 * { "rel": "execute", "method": "POST",
 *   "href": "/compute/sessions/<id>/jobs",
 *   "type": "application/vnd.sas.compute.job.request",
 *   "responseType": "application/vnd.sas.compute.job" }
 * ```
 *
 * That is why ADR-0010 could reject a generated client without much regret. A
 * generated client's contribution is 136 URL builders; the service hands us the
 * URLs. What it does *not* hand us is the two rules below, which are properties
 * of the responses rather than of any specification — which is also why upstream
 * had to hand-write this layer to sit alongside its generated one.
 *
 * Everything here is grounded in `PROBE-FINDINGS.md` findings 13 and 14, taken
 * from a live Viya 4 deployment on 2026-08-14.
 */

/**
 * One entry of a `links` array, narrowed to what this project reads.
 *
 * `type` and `responseType` are `string | null | undefined`. The `undefined` arm
 * is observed — finding 14 records that a link with no media type **omits the
 * key**, and that a `DELETE` link therefore has no `type` at all, so a
 * declaration of `string` would type-check, read correctly, and throw on the one
 * call made while tearing down after an earlier failure.
 *
 * The `null` arm is **defensive breadth, not an observation.** An earlier reading
 * of the probe recorded an explicit `"type": null` on context summaries; that was
 * a `jq` artifact — projecting `{rel, type}` prints `null` for a key that is
 * merely absent — and re-checking with `has("type")` found no such link on this
 * deployment. It is kept because JSON permits it, it costs one union member, and
 * a media type that is `null` and one that is absent mean the same thing to every
 * reader below. Do not restate it as something the service does.
 */
export interface Link {
  readonly rel: string;
  readonly href: string;
  readonly method?: string | undefined;
  readonly type?: string | null | undefined;
  readonly responseType?: string | null | undefined;
}

/**
 * Thrown when a link's `href` does not address the deployment we are talking to.
 *
 * A type rather than a message, for the reason `NoSuchSessionError` is: the
 * caller has to tell this apart from an ordinary request failure, and the only
 * other discriminator would be a sentence.
 *
 * This is a security control, not a validation nicety. Every request built from
 * a link carries the user's bearer token in an `Authorization` header. An `href`
 * of `https://elsewhere.example/collect`, or a protocol-relative
 * `//elsewhere.example/collect`, would send that token to a host named by
 * whatever answered the previous request. It is the same disclosure
 * `transport.ts` refuses redirects to avoid, arriving through a different door,
 * and the mitigation is the same: refuse to follow a location that leaves the
 * deployment, and say so.
 *
 * Nothing observed on a real deployment has ever returned an absolute `href`.
 * That is the argument for rejecting them rather than resolving them — a shape
 * the service does not use is a shape we lose nothing by refusing.
 */
export class ForeignLinkError extends Error {}

/**
 * The links of a representation, keeping only the entries that are usable.
 *
 * Takes `unknown` because it is handed the output of `JSON.parse` on a response
 * body. An entry without a string `rel` and a string `href` cannot be found or
 * followed, so it is dropped rather than carried along as a half-link that fails
 * later at a point with less context.
 *
 * Absent, malformed, or non-array `links` yields an empty array. The caller
 * discovers the problem as "the relation I need is not here", which is the same
 * message it would need for a representation whose links were fine but lacked
 * that relation — one failure to describe instead of two.
 */
export function readLinks(representation: unknown): readonly Link[] {
  if (typeof representation !== "object" || representation === null) return [];
  const raw: unknown = (representation as { links?: unknown }).links;
  if (!Array.isArray(raw)) return [];

  const links: Link[] = [];
  for (const entry of raw as readonly unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = entry as Record<string, unknown>;
    const { rel, href, method, type, responseType } = candidate;
    if (typeof rel !== "string" || typeof href !== "string") continue;
    if (rel === "" || href === "") continue;

    links.push({
      rel,
      href,
      ...(typeof method === "string" ? { method } : {}),
      ...(typeof type === "string" || type === null ? { type } : {}),
      ...(typeof responseType === "string" || responseType === null
        ? { responseType }
        : {}),
    });
  }
  return links;
}

/**
 * The first link with this relation, or `undefined`.
 *
 * **One lookup with one signature.** Upstream has two functions both called
 * `getLink` — `getLink(links, rel)` in `rest/common.ts` and
 * `getLink(links, method, relationship)` in `rest/util.ts` — which differ in
 * arity and in meaning, so which one a call site gets depends on which module it
 * imported. That is a name collision waiting to be resolved wrongly by an
 * auto-import.
 *
 * Returns `undefined` rather than throwing because a missing relation is
 * frequently a legitimate answer: it is how the service says an operation is not
 * available on this resource in this state, and in a version-branching layer it
 * is how a deployment says it does not support something at all. The caller has
 * the context needed to decide whether absence is a failure.
 */
export function findLink(
  links: readonly Link[],
  rel: string,
): Link | undefined {
  return links.find((link) => link.rel === rel);
}

/**
 * The HTTP method a link should be followed with.
 *
 * `GET` when unstated, which matches both HTTP's own default and every link
 * observed without one.
 */
export function linkMethod(link: Link): string {
  return link.method ?? "GET";
}

/**
 * Joins a deployment root to a link's `href`.
 *
 * ## Why this is concatenation rather than URL resolution
 *
 * Every `href` the service produces is relative to the deployment root and
 * **already carries the service prefix** — `/compute/sessions/<id>/jobs`, not
 * `/sessions/<id>/jobs`. Keep the root as the only stored base and a link is
 * followed by joining the two, exactly as sent.
 *
 * This is the single design choice that deletes upstream's acknowledged wart
 * rather than fixing it. Upstream sets its generated client's `basePath` to
 * `endpoint + "/compute"`, the client concatenates `basePath + href`, and the
 * prefix appears twice — so `rest/common.ts:118` removes one with
 * `link.href.replace("/compute", "")`, under its author's own `//TODO`. That
 * has first-occurrence-anywhere semantics, so any href legitimately containing
 * `/compute` further along is silently mutilated, and it is a regression: commit
 * `d226fdee` replaced an anchored `slice("/compute".length)` with it. There is
 * no equivalent line here because there is no second prefix to remove.
 *
 * `new URL(href, base)` is the obvious alternative and is rejected twice over.
 * It would resolve an absolute `href` to whatever host that href names, sending
 * the bearer token there — see {@link ForeignLinkError}. And it re-encodes: the
 * WHATWG query percent-encode set for `http`/`https` includes `'`, so the
 * context `rules` link,
 * `/authorization/rules?filter=eq(objectUri,'%2Fcompute%2F…')`, comes back with
 * its apostrophes rewritten as `%27`. Harmless after the server decodes it,
 * probably — but "probably" is doing real work in that sentence, and the
 * alternative is to send back precisely the bytes we were given.
 *
 * @param root A normalised deployment endpoint, as `src/profile/model.ts`
 *   produces: scheme, host, and any path prefix, with no trailing slash. It may
 *   legitimately carry a path, because `normaliseEndpoint` permits a deployment
 *   published under one, so this must not be reduced to a bare origin.
 * @throws {ForeignLinkError} if `href` is not a root-relative path.
 */
export function resolveHref(root: string, href: string): string {
  // `//host/path` is protocol-relative: it starts with a slash and addresses
  // another host entirely. It has to be rejected before the `startsWith("/")`
  // test would wave it through, which is the whole reason this check is first.
  if (href.startsWith("//")) {
    throw new ForeignLinkError(
      `the deployment returned a link to another host: ${href}`,
    );
  }
  if (!href.startsWith("/")) {
    throw new ForeignLinkError(
      `the deployment returned a link that is not a root-relative path: ${href}`,
    );
  }
  return `${root.replace(/\/+$/, "")}${href}`;
}

/** The vendor media-type family whose types arrive without a structured suffix. */
const SAS_VENDOR_PREFIX = "application/vnd.sas";

/**
 * The media type to actually send, given the one a link advertises.
 *
 * SAS Viya advertises its vendor types **bare** and then requires the
 * `+json` structured suffix on the wire. A link says
 * `application/vnd.sas.compute.job.request`; a request that sends that verbatim
 * as `Content-Type` is not sending what the service wants. So this appends
 * `+json`, which is the entire job of upstream's `computeMediaType()` and the
 * only reason that file depends on `media-typer`.
 *
 * We take no dependency for it. The rule is three predicates:
 *
 * | advertised | sent | why |
 * |---|---|---|
 * | `application/vnd.sas.compute.session` | `…session+json` | the case this exists for |
 * | `application/vnd.sas.api+json` | unchanged | already suffixed |
 * | `text/plain` | unchanged | the `state` and `getOption` links; suffixing it would be nonsense |
 * | `null` / absent / `""` | `undefined` | there is no type to send |
 *
 * Returning `undefined` rather than a fallback string is deliberate: the caller
 * must omit the header entirely, because a `Content-Type` invented by us is a
 * claim about a body we did not describe.
 *
 * Parameters are preserved. Nothing observed carries them on a *link* — they
 * appear on response `content-type` headers — but the function is total over
 * what it might be handed, and `…session; charset=utf-8` becoming
 * `…session+json; charset=utf-8` is the only sane reading of it.
 */
export function computeMediaType(
  type: string | null | undefined,
): string | undefined {
  if (type === null || type === undefined) return undefined;

  const [rawEssence = "", ...parameters] = type.split(";");
  const essence = rawEssence.trim();
  if (essence === "") return undefined;

  // Not ours to touch: `text/plain`, `application/json`, anything a future
  // deployment advertises from outside the SAS vendor tree.
  if (!essence.startsWith(SAS_VENDOR_PREFIX)) return type;

  // Already structured. `application/vnd.sas.api+json` is served by the root
  // resource, so this arm is reached in ordinary use rather than defensively.
  if (essence.includes("+")) return type;

  return [`${essence}+json`, ...parameters].join(";");
}
