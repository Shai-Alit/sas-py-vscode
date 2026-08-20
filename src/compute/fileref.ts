// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Filerefs — the upload primitive ADR-0014's mechanism runs on.
 *
 * **This module must never import `vscode`.**
 *
 * ADR-0014 settled that Python reaches the interpreter as an uploaded file run
 * with `proc python infile=<fileref>;`, never inlined, because inlining can
 * silently poison the session (finding 31). This module is the upload half of
 * that mechanism and nothing else: create a fileref, write its content. It does
 * not compose `infile=<fileref>;` or touch a job — that belongs to slice `3a`,
 * on top of exactly these two calls, the same boundary `job.ts` draws around
 * `PROC PYTHON` itself.
 *
 * ## Why this exists before 3a
 *
 * `RUNBOOK.md`'s "Before 3a" item is the submission-fidelity corpus, and the
 * corpus's job changed on 2026-08-16 (findings 31–36) from proving an escaper to
 * proving this upload is byte-for-byte: what the interpreter reads must be
 * exactly what the editor held, across CRLF, tabs, non-ASCII content, an empty
 * file and a file with no trailing newline. That is a claim about this module,
 * not about `PROC PYTHON`, so it is provable — and worth proving — before the
 * rest of 3a exists.
 *
 * ## The one non-obvious step: a fresh `ETag` before every write
 *
 * Finding 36 measured `PUT …/content` with no `If-Match` answering
 * `428 Precondition Required`, and with the `ETag` from a `GET` of the fileref
 * itself (not of its content) answering `201`. So {@link writeFilerefContent}
 * always issues that `GET` first, rather than reusing the `ETag` the create
 * response carried. That costs one request compared with the shortcut
 * `session.ts` takes for a session's first state read — where finding 21 showed
 * the create response's `ETag` and the first state read's `ETag` were
 * byte-identical, so no extra `GET` is needed there — and the shortcut is not
 * repeated here because nothing has measured whether a fileref's create-response
 * `ETag` and its `self` `ETag` agree the same way. This function only ever needs
 * to prove one write per fileref for the corpus; a caller that writes the same
 * fileref twice pays for a second `GET`, which is the safe side of an unverified
 * shortcut to be on.
 *
 * ## A 404 from a fileref is read as the session being gone
 *
 * Every call here maps its failures through `asSessionGone`, so a `404` on the
 * `assign` `POST`, on the `self` `GET` or on the content `PUT` reaches the caller
 * as `session-gone`. That is a **reading rather than a fact**, and it is the same
 * one `job.ts` makes for the same reason — see its own doc comment. **No probe
 * has ever seen a `404` from a fileref resource**: finding 57 says so in as many
 * words, having gone looking, and finding 36 records none either. So nothing
 * establishes which of the two producers a real one would have.
 *
 * The reading is load-bearing on one precondition: **nothing in this extension
 * deassigns or deletes a fileref.** A fileref lives inside a session, is created
 * by this module and by nothing else, and finding 57 measured its backing file
 * under the session's own run directory — so while that holds, "the fileref is
 * not there" and "the session is not there" have one cause between them. The
 * moment a slice follows `deassign` or `delete`, the second producer exists and
 * both of those call sites have to be revisited, because the cost of getting it
 * wrong is not a bad message: a caller handed `session-gone` starts a new
 * session, which discards the interpreter namespace ADR-0012 exists to keep.
 */

import {
  type ComputeClient,
  type ComputeFailure,
  type ComputeResponse,
  type ComputeResult,
} from "./client";
import { findLink, type Link, readLinks } from "./links";
import { asSessionGone, type ComputeSession } from "./session";

/** The relation on a session that creates a fileref in it. `POST`. */
export const ASSIGN_REL = "assign";

/** The relation on a fileref that re-reads it, for a fresh `ETag`. `GET`. */
export const FILEREF_SELF_REL = "self";

/** The relation on a fileref that writes its content. `PUT`. */
export const FILEREF_UPLOAD_REL = "upload";

/**
 * A fileref, reduced to what {@link writeFilerefContent} needs.
 *
 * `links` is kept whole, as in every other representation this project reads:
 * finding 36 recorded seven relations (`self`, `alternate`, `deassign`,
 * `content`, `upload`, `append`, `delete`) and finding 57 recorded the media
 * type each one advertises. This module follows exactly two. The other five are
 * left on the wire until a caller needs them — `deassign`/`delete` in particular
 * belong to whichever slice adds cleanup, not to this one, which only ever runs
 * once per corpus case today, and which the session-gone reading above depends
 * on continuing to be true.
 */
export interface Fileref {
  readonly id: string;
  readonly links: readonly Link[];
}

export interface CreateFilerefOptions {
  signal?: AbortSignal | undefined;
}

export interface WriteFilerefContentOptions {
  signal?: AbortSignal | undefined;
}

/**
 * Creates a fileref in a session.
 *
 * Follows the session's `assign` relation. `name` becomes both the request's
 * `name` and `path` fields. Finding 36 recorded the response `id` equal to the
 * requested `name` but elided the values it sent, so it establishes nothing
 * about a divergent pair; finding 57 is what makes sending the same value for
 * both defensible rather than arbitrary. It measured `path: "case1"` resolving
 * to `filePath` `…/compsrv/default/<session-uuid>/case1` — a bare relative path
 * lands inside the session's own run directory, so it is scoped to the session
 * whether or not it matches `name`, and it goes away with the session.
 *
 * `name` must be a valid SAS fileref name — the string 3a's
 * `infile=<fileref>;` will interpolate unquoted — which this function does not
 * validate: the corpus and the live tier compose names known to be valid. **3a
 * owns that validation**, because 3a is the slice that first composes a name
 * from something a user controls; until then every caller is in this
 * repository.
 *
 * @throws {TypeError} if `name` is empty. A caller defect, as in `createJob`:
 *   nothing on the wire produces an empty fileref name.
 */
export async function createFileref(
  client: ComputeClient,
  session: ComputeSession,
  name: string,
  options?: CreateFilerefOptions,
): Promise<ComputeResult<Fileref>> {
  if (name === "") {
    throw new TypeError("a fileref name cannot be empty");
  }

  const link = findLink(session.links, ASSIGN_REL);
  if (link === undefined) {
    return linkMissing("compute session", session.id, ASSIGN_REL);
  }

  const result = await client.send({
    link,
    body: { name, path: name },
    signal: options?.signal,
  });
  if (!result.ok) return asSessionGone(result);

  const fileref = readFileref(result.value);
  if (fileref === undefined) {
    return malformed(
      result.value,
      "a fileref representation",
      "and it was not a fileref representation with an id",
    );
  }
  return { ok: true, value: fileref };
}

/**
 * Writes a fileref's content, exactly as given.
 *
 * Two requests, in order: a `GET` of the fileref's `self` relation for a fresh
 * `ETag` — see this module's own doc comment for why that `GET` is not
 * skipped — then a `PUT` of its `upload` relation carrying `bytes` as the
 * request's `rawBody` and that `ETag` as `If-Match`. Neither request re-encodes
 * `bytes` in any way: `rawBody` reaches the transport unchanged, and that is the
 * entire property this function exists to have.
 *
 * A `428` on the `PUT` (finding 36's observed failure for a missing or stale
 * `If-Match`) arrives through the ordinary `ComputeResult` failure path as
 * `compute-rejected`, the same as any other status this layer does not
 * specifically interpret.
 *
 * One asymmetry worth naming: the `ETag` comes from the fresh `self` read, but
 * the `upload` href comes from the `fileref` the caller passed in, which may be
 * older. The fresh representation's own links are deliberately not preferred —
 * a fileref's href set is not something a re-read is expected to change, and
 * quietly following a *different* href than the caller's representation named
 * would make a moved resource look like a successful write. If a deployment is
 * ever measured relocating a fileref, this is the line to revisit.
 */
export async function writeFilerefContent(
  client: ComputeClient,
  fileref: Fileref,
  bytes: Uint8Array,
  options?: WriteFilerefContentOptions,
): Promise<ComputeResult<void>> {
  // Both relations are resolved before either request. Checking `upload` only
  // after the `self` read would spend a round trip to learn something the
  // representation already said, and the failure a caller gets is the same one
  // either way.
  const selfLink = findLink(fileref.links, FILEREF_SELF_REL);
  if (selfLink === undefined) {
    return linkMissing("fileref", fileref.id, FILEREF_SELF_REL);
  }

  const uploadLink = findLink(fileref.links, FILEREF_UPLOAD_REL);
  if (uploadLink === undefined) {
    return linkMissing("fileref", fileref.id, FILEREF_UPLOAD_REL);
  }

  const fresh = await client.send({ link: selfLink, signal: options?.signal });
  if (!fresh.ok) return asSessionGone(fresh);

  if (fresh.value.etag === undefined) {
    return malformed(
      fresh.value,
      "a fileref representation carrying an ETag",
      "and the response carried no ETag to write the content with",
    );
  }

  const result = await client.send({
    // No `Content-Type` is set here, and none needs to be: finding 57 measured
    // the `upload` relation advertising `application/octet-stream` in the link
    // itself. That is not a SAS vendor type, so `computeMediaType` passes it
    // through untouched and `client.ts` sends it verbatim — the link is followed
    // exactly as the deployment described it, which is the rule every other
    // link-follow in this codebase keeps. `client.ts`'s own octet-stream default
    // for a `rawBody` is the arm taken when a link carries no type at all, and
    // on this path it is never reached.
    link: uploadLink,
    rawBody: bytes,
    etag: fresh.value.etag,
    signal: options?.signal,
  });
  if (!result.ok) return asSessionGone(result);
  return { ok: true, value: undefined };
}

/**
 * A fileref representation, or `undefined` if the body was not one.
 *
 * Only `id` is required. `accessMethod`, `fileName`, `filePath` and `fileSize`
 * (finding 36) are left on the wire until something needs them.
 */
function readFileref(response: ComputeResponse): Fileref | undefined {
  const body: unknown = response.body;
  if (typeof body !== "object" || body === null) return undefined;

  const candidate = body as { id?: unknown };
  const { id } = candidate;
  if (typeof id !== "string" || id === "") return undefined;

  return { id, links: readLinks(body) };
}

/** The failure for a representation that carried no such relation. */
function linkMissing(
  resource: "compute session" | "fileref",
  id: string,
  rel: string,
): ComputeFailure {
  return {
    ok: false,
    reason: `the ${resource} carried no "${rel}" link in the response this account read`,
    problem: { code: "link-missing", rel, resource: `${resource} "${id}"` },
  };
}

/** The failure for a 2xx that was not the representation expected. */
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
      detail: `a fileref request answered HTTP ${String(response.status)} as ${response.contentType ?? "an unknown type"}, ${defect}`,
    },
  };
}
