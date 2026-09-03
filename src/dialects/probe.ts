// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Stage-1 capability probing — asking the deployment which generation it is.
 *
 * **This module must never import `vscode`.**
 *
 * `PRODUCTION_PLAN.md` §2.3 splits probing in two. Stage 1 is **HTTP-derived**:
 * one navigation from `/deploymentData` to the cadence resource, before any code
 * has been submitted anywhere. Stage 2 is runtime-derived — what the Python
 * environment inside the session actually has — and lands in 3e. This file is all
 * of stage 1.
 *
 * ## Two requests, because the relation is the answer
 *
 * ADR-0010 names "the presence or absence of a link relation" as how a version
 * difference should be expressed, so this navigates rather than composing
 * `/deploymentData/cadenceVersion` directly the way upstream's `getViyaCadence`
 * does (finding 45). {@link DEPLOYMENT_DATA_PATH} is the one composed path — the
 * second in the project, after `CONTEXTS_PATH` — and the ADR sanctions it on the
 * same terms: navigation has to start somewhere, and the deployment root is the
 * only base we hold.
 *
 * The relation is not selected by `rel` alone. Finding 44: `cadenceVersion`
 * appears **twice** in that document, distinguished only by media type, so the
 * lookup is {@link findLinkOfType}.
 *
 * ## Why `absent` is so much harder to earn than a 404
 *
 * The whole design turns on finding 42. Two 404s were provoked on a live Viya 4
 * and they are not alike: a routed service asked for a path it does not have
 * answers `404` with a `vnd.sas.error+json` document and a message; a path no
 * service is routed to at all is answered by the **ingress**, with no body, no
 * media type and no message. A corporate proxy, a VPN portal, or a mistyped host
 * produces something in that same family.
 *
 * So a bare 404 is not evidence of anything. Keyed on the status alone, anything
 * sitting between the editor and the deployment could manufacture a confident,
 * wrong reading of the response — and a wrongly chosen dialect presents as a
 * dozen unrelated bugs, which is the failure the whole `reason`-carrying design
 * of `./resolve` exists to prevent. `absent` therefore requires a 404 that
 * **arrived with a Viya error document**, or a link document that genuinely does
 * not offer the relation. Everything else is `unreadable`, with the detail
 * attached so the output channel can say what actually happened.
 *
 * ## The precondition this cannot check for itself
 *
 * Sean's wiring decision for 2b-ii is that the probe runs *after* a compute
 * session connects, and that is load-bearing rather than incidental: a live
 * session is proof that the host is a reachable Viya that our token works
 * against, which is exactly the control that makes a Viya-shaped 404 a statement
 * about the endpoint rather than about the network. Run from a colder position —
 * some later slice probing before connecting — the same 404 would have to
 * classify as `unreadable`.
 *
 * That is a documented precondition and not a parameter. A `sessionConnected`
 * flag would add a branch that no caller sets and no test could justify beyond
 * covering itself, which is a worse trade than a paragraph.
 *
 * ## Viya 3.5 removed, 2026-09-03
 *
 * `absent` used to be read one level further, in `./resolve`, as "this deployment
 * is Viya 3.5" — the endpoint here is a Viya 4 addition, so its considered
 * absence was as close to a version number as 3.5 offered. No Viya 3.5
 * deployment was ever available to this project to confirm that reading, and
 * [ADR-0022](../../docs/adr/0022-drop-viya-35-support.md) drops 3.5 as a
 * supported generation rather than continue carrying an inference nobody could
 * check. This probe's own job does not change: it still tells `./resolve`
 * exactly what it found, `absent` included: `./resolve` is what now treats
 * `absent` as inconclusive rather than as a positive identification.
 */

import {
  type ComputeClient,
  type ComputeFailure,
  type ComputeResponse,
  type ComputeResult,
} from "../compute/client";
import { findLinkOfType, readLinks, type Link } from "../compute/links";
import type { ViyaError } from "../compute/problems";
import type { CadenceSignal } from "./resolve";

/**
 * The deployment-data entry point. Composed, and the only path here that is.
 *
 * Root-relative and already carrying its service prefix, exactly as every href
 * the service itself produces does (finding 13), so it goes through
 * `resolveHref` on the same terms as a link we were handed.
 */
export const DEPLOYMENT_DATA_PATH = "/deploymentData";

/** The relation from the entry point to the cadence resource. */
export const CADENCE_REL = "cadenceVersion";

/**
 * Which of the two `cadenceVersion` relations to follow.
 *
 * Finding 44 records both: this one and
 * `application/vnd.sas.app.registry.cadence.version`. Their hrefs are identical
 * today, so the choice is cosmetic *today* — which is the reason to make it
 * explicitly rather than by taking whichever the deployment listed first.
 * `contracts/viya4.yaml` records the same pair, and `check:contracts` refuses a
 * `via:` that names a relation without a media type.
 */
export const CADENCE_TYPE =
  "application/vnd.sas.deployment.data.cadence.version";

/**
 * What to ask the cadence resource for.
 *
 * `application/json`, not the versioned vendor type. Finding 43 confirms it is on
 * the resource's own list of acceptable types, and it comes back as a stable
 * `application/json; charset=utf-8` rather than a representation-versioned one.
 * This reads two fields and has no use for the representation version, so the
 * plain type is the one that will still parse when the vendor type reaches
 * `version=2`.
 */
const CADENCE_ACCEPT = "application/json";

/** What the entry point serves — already `+json`-suffixed, unusually. */
const DEPLOYMENT_DATA_TYPE = "application/vnd.sas.api+json";

/**
 * How long to wait for either request.
 *
 * Much tighter than the client's thirty-second default, because this is not a
 * request a user is waiting on the result of: it decorates a connection that has
 * already succeeded. Finding 40 measured 0.25–0.29 s across three runs, so ten
 * seconds is roughly thirty times the observed cost and still short enough that a
 * deployment which simply never answers cannot hold a connect sequence open.
 */
export const PROBE_TIMEOUT_MS = 10_000;

export interface ProbeOptions {
  /** Cancels the request in flight. Passed straight through to the client. */
  signal?: AbortSignal | undefined;
  /** Overrides {@link PROBE_TIMEOUT_MS} for both requests. */
  timeoutMs?: number | undefined;
}

/**
 * Asks the deployment for its cadence version.
 *
 * Never throws and never rejects — see the `catch` at the bottom. Every outcome,
 * including a broken transport and a deployment answering nonsense, arrives as
 * one of the three {@link CadenceSignal} arms, because a probe that can fail the
 * operation it was decorating is worse than no probe.
 *
 * @param client A compute client bound to the deployment root. It is named for
 *   its first user rather than its scope: `/deploymentData` is not a Compute
 *   service resource, but everything the client does here — resolve an href
 *   against the root, attach the bearer token, refuse a foreign link, read a
 *   Viya error document — is Viya-general, and a second client differing only in
 *   its name would be two places to fix the next transport defect.
 */
export async function probeCadence(
  client: ComputeClient,
  options: ProbeOptions = {},
): Promise<CadenceSignal> {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const send = async (link: Link): Promise<ComputeResult<ComputeResponse>> =>
    await client.send({ link, signal: options.signal, timeoutMs });

  try {
    const root = await send({
      rel: "deploymentData",
      href: DEPLOYMENT_DATA_PATH,
      method: "GET",
      responseType: DEPLOYMENT_DATA_TYPE,
    });

    if (!root.ok) return fromEntryPointFailure(root);

    // Not `readLinks` straight away. It takes `unknown` and answers `[]` for
    // anything it cannot read, so an HTML sign-in page from a portal — served
    // with a 200 and a content type the client did not parse — would arrive
    // here as "a document with no links", and be reported `absent`. The
    // absence of a relation only means something in a document that has them.
    if (!isLinkDocument(root.value.body)) {
      return {
        kind: "unreadable",
        detail: `${DEPLOYMENT_DATA_PATH} answered HTTP ${String(root.value.status)}, but not with a link document`,
      };
    }

    const link = findLinkOfType(
      readLinks(root.value.body),
      CADENCE_REL,
      CADENCE_TYPE,
    );
    if (link === undefined) {
      // A Viya service answered, with a document of the right shape, and it does
      // not offer this relation. ADR-0010's version signal, exactly as stated.
      return { kind: "absent" };
    }

    // `method` is `null` on every link in this document (finding 44), which
    // `readLinks` drops, so the verb has to come from the contract rather than
    // from the document. `responseType` overrides what the link advertises, for
    // the reason `CADENCE_ACCEPT` gives.
    const cadence = await send({
      ...link,
      method: "GET",
      responseType: CADENCE_ACCEPT,
    });

    if (!cadence.ok) {
      // Deliberately never `absent`, not even for a Viya 404. The entry point
      // has just told us this relation exists; a resource that is advertised and
      // then refuses to answer is a deployment in a state we do not understand,
      // and "I could not read it" is the only honest thing to say about it.
      return { kind: "unreadable", detail: cadence.reason };
    }

    return readCadence(cadence.value);
  } catch (error) {
    // **The one swallowed exception §2.3 sanctions, and the comment it requires.**
    //
    // Nothing above is expected to throw: the client turns transport failures
    // into `ComputeFailure`, and the only `throw` on its path is a
    // `ForeignLinkError` it catches itself. This is here for the residue — an
    // injected client that rejects, an `AbortSignal.any` that is not there, a
    // future refactor that adds a throwing call site — because the cost of being
    // wrong about that list is a rejected promise inside a connect sequence,
    // which fails a connection that had already succeeded. Probing is decoration;
    // decoration must not be able to break the thing it decorates.
    //
    // The message only, never the thrown value: a rejection from a transport can
    // carry the request that produced it, and that request holds a bearer token.
    return {
      kind: "unreadable",
      detail: `the cadence probe failed unexpectedly: ${messageOf(error)}`,
    };
  }
}

/**
 * What a failure at the entry point means.
 *
 * The only place `absent` can be reached from a failure, and it takes both
 * conditions from finding 42: the status must be 404, **and** the body must have
 * been a Viya error document. Either one alone is not evidence.
 */
function fromEntryPointFailure(failure: ComputeFailure): CadenceSignal {
  const { problem } = failure;
  if (
    problem.code === "compute-rejected" &&
    problem.error.status === 404 &&
    isViyaErrorDocument(problem.error)
  ) {
    // A Viya service, routed and answering, saying it has no such path. On a
    // deployment we are already holding a session against, that is the
    // deployment-data service being genuinely absent.
    return { kind: "absent" };
  }
  return { kind: "unreadable", detail: failure.reason };
}

/**
 * Whether a Viya error came from Viya at all.
 *
 * `readViyaError` is total: handed an empty body, HTML, or JSON of some other
 * shape, it returns the status and nothing else. That makes "it parsed into at
 * least one recognised field" the available discriminator between the two 404s
 * in finding 42 — the routed service's document carries a `message`, the
 * ingress's non-document carries nothing.
 *
 * It is a one-way test, and deliberately the safe way round. A Viya error
 * document with every optional field empty would be misread as an intermediary
 * and reported `unreadable`, which costs a fallback to the Viya 4 dialect. The
 * opposite mistake costs a wrongly confident `absent`.
 */
function isViyaErrorDocument(error: ViyaError): boolean {
  return (
    error.message !== undefined ||
    error.errorCode !== undefined ||
    error.detail !== undefined ||
    error.correlator !== undefined
  );
}

/**
 * Whether a parsed body is a document that could carry link relations.
 *
 * An object with a `links` array. Not "has the relation we want" — the point is
 * to establish that the *absence* of a relation is a statement by the service,
 * rather than an artefact of never having received a service's document at all.
 */
function isLinkDocument(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  return Array.isArray((body as { links?: unknown }).links);
}

/**
 * Reads the cadence resource, or says why it could not be read.
 *
 * `cadenceVersion` is the one field that has to be there, and it is checked for
 * shape rather than taken on trust: finding 40 measured `2026.03`, which
 * `resolveDialectId`'s anchored `CADENCE` pattern already accepts, so validating
 * here would be a second copy of that rule. What is checked is that it is a
 * non-empty string — an empty one would resolve to the Viya 4 dialect with no
 * release, which is a real state (`createViya4Dialect("")`) but not one a
 * *successful* read should ever produce.
 */
function readCadence(response: ComputeResponse): CadenceSignal {
  const body: unknown = response.body;
  if (typeof body !== "object" || body === null) {
    return {
      kind: "unreadable",
      detail: `the cadence resource answered HTTP ${String(response.status)} with no readable body`,
    };
  }

  const record = body as Record<string, unknown>;
  const version = trimmedString(record.cadenceVersion);
  if (version === undefined) {
    return {
      kind: "unreadable",
      detail:
        "the cadence resource answered without a usable cadenceVersion field",
    };
  }

  const display = trimmedString(record.cadenceDisplayName);
  return {
    kind: "cadence",
    version,
    ...(display === undefined ? {} : { display }),
  };
}

/** A field's value if it is a string with something in it, else `undefined`. */
function trimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** The message of a thrown value, and nothing else it might be carrying. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
