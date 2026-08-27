// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * A session's working directory — list it, read one file's content, delete
 * one file. ADR-0019's mechanism for capturing matplotlib/pandas rich output.
 *
 * **This module must never import `vscode`.**
 *
 * Nothing here decides *which* files are worth surfacing as output, or what
 * they mean — that is `src/backend/richOutput.ts`'s pure diff/filter/decode
 * logic, kept separate for the same reason `logFilter.ts` is its own module.
 * This one owns exactly the wire mechanics finding 61 established: follow the
 * session's `getFiles` relation to the working directory's own properties,
 * follow *that* representation's `getDirectoryMembers` relation to the
 * listing, and — per item — follow `getFile` for content or `getFileProperties`
 * for an `ETag` to delete by. Every step is a link the deployment handed back,
 * never a path this project composed (ADR-0010): the listing item's own
 * `~fs~`-escaped path segment (finding 61) is exactly the kind of thing that
 * rule exists to keep out of this codebase.
 *
 * ## The relations, confirmed live rather than read off prose
 *
 * Findings 61/65/67 described this mechanism largely in prose — "the file's
 * own `getFileProperties`/`self` link", "`deleteFile` (`DELETE` on a file's
 * own link)" — without printing the literal `rel` strings a caller has to
 * search for. Finding 68 (`docs/phases/phase-3.md`, 2026-08-25, `verde`)
 * closes that gap by printing the full `links` array at both levels:
 *
 * - A session's `getFiles` relation resolves to the working directory's own
 *   properties representation, which itself carries `getDirectoryMembers`
 *   (a collection) alongside directory-management relations this module never
 *   follows (`getDirectoryProperties`, `deleteDirectory`, `renameDirectory`,
 *   `makeDirectory`, `createFile`, `copyDirectory`).
 * - A listing item carries **both** `self` and `getFileProperties`, at an
 *   identical href — confirmed byte-identical on the wire, not assumed
 *   synonyms. This module follows `getFileProperties` for its clearer name.
 * - A listing item's content relation is `getFile`, exactly as finding 61
 *   named it.
 * - A listing item's delete relation is **`deleteFile`** — not `self`, and
 *   not the bare `delete` `src/compute/fileref.ts` and `session.ts` both use
 *   for their own resources. Composing that name by analogy rather than
 *   confirming it live would have been a wrong guess.
 *
 * ## Size, not `ETag`, is the diff key — and why that is `richOutput.ts`'s
 * decision, not this module's
 *
 * Finding 67 confirmed a bare listing item carries `size` directly, with no
 * properties or content fetch needed to read it — which is what makes a
 * before/after directory diff cost one listing request per side rather than
 * one request per candidate file. This module surfaces `size` on every
 * {@link SessionFile} it returns for exactly that reason, but does not itself
 * decide what to do with it: ADR-0019's diff, whitelist and size-cap policy
 * all live in `richOutput.ts`, which is the pure, `vscode`-free module this
 * one was split from — same boundary `logFilter.ts` draws against
 * `procPython.ts`.
 *
 * ## Deleting reads a fresh `ETag` immediately before the `DELETE`, like
 * `fileref.ts`
 *
 * Finding 65 measured `deleteFile` answering `428 Precondition Required`
 * with no `If-Match`, and `204` once one is sent — and that the `ETag` is
 * available from a plain `GET` on the item's own properties link, with no
 * content fetch required, and never present in the JSON body, only the HTTP
 * header. {@link deleteSessionFile} therefore always issues that `GET` first
 * rather than accept an `ETag` a caller read earlier (from, say, an already-
 * fetched content response) — the same choice `fileref.ts`'s
 * `writeFilerefContent` makes and documents for the same reason: nothing has
 * measured whether an earlier read's `ETag` is still current by the time a
 * caller gets around to deleting, and a fresh read costs one request against
 * a file this backend is about to discard anyway.
 *
 * ## A 404 here is read as the session being gone
 *
 * Every call maps its failures through `asSessionGone`, the same reading
 * `fileref.ts` and `variables.ts` make and for the same reason: this project
 * has never observed a 404 from a file resource, and `PROC PYTHON`'s serial,
 * one-session-at-a-time execution (ADR-0015) means nothing but this module's
 * own `deleteSessionFile` call ever removes a file this backend wrote. While
 * that holds, "the file is not there" and "the session is not there" share
 * one cause. A future caller that deletes a file for a reason other than
 * "richOutput.ts already captured it" has to revisit this reading, exactly as
 * `fileref.ts`'s own doc comment warns for its callers.
 */

import {
  type ComputeClient,
  type ComputeFailure,
  type ComputeResponse,
  type ComputeResult,
} from "./client";
import { findLink, readLinks, type Link } from "./links";
import { asSessionGone, type ComputeSession } from "./session";

/** The relation on a session that resolves to its working directory's own
 * properties representation. `GET`. */
export const GET_FILES_REL = "getFiles";

/** The relation on a directory's properties representation that lists its
 * members. `GET`, a collection. */
export const DIRECTORY_MEMBERS_REL = "getDirectoryMembers";

/** The relation on a listing item that reads its properties — and, more to
 * the point for {@link deleteSessionFile}, the `ETag` header a `DELETE`
 * needs. `GET`. Confirmed (finding 68) at an href identical to the same
 * item's `self` relation. */
export const FILE_PROPERTIES_REL = "getFileProperties";

/** The relation on a listing item that reads its content. `GET`. */
export const FILE_CONTENT_REL = "getFile";

/** The relation on a listing item that deletes it. `DELETE`. Confirmed
 * (finding 68) as its own distinct name, not `delete`. */
export const FILE_DELETE_REL = "deleteFile";

/**
 * One entry of a directory listing, reduced to what `richOutput.ts`'s diff
 * needs plus the links a caller follows next.
 *
 * `size` is `undefined` only if a future deployment's listing item omits it —
 * finding 67 measured it present on every item this project has seen. A
 * caller (`richOutput.ts`) that cannot read a candidate's size cannot apply
 * ADR-0019's cap to it and must decide what that means; this module does not
 * decide it on the caller's behalf.
 */
export interface SessionFile {
  readonly name: string;
  readonly size: number | undefined;
  readonly links: readonly Link[];
}

export interface ListSessionFilesOptions {
  signal?: AbortSignal | undefined;
}

/**
 * Lists the files in a session's own working directory.
 *
 * Two requests, always, regardless of how many files exist: `GET` the
 * session's `getFiles` relation for the directory's own properties (which
 * carries `getDirectoryMembers` among its links, not a listing itself —
 * finding 61), then `GET` that relation for the collection. Neither response's
 * links beyond the one relation each step needs are read; a caller wanting the
 * directory's own delete/rename/create relations is not a caller this slice
 * has.
 */
export async function listSessionFiles(
  client: ComputeClient,
  session: ComputeSession,
  options?: ListSessionFilesOptions,
): Promise<ComputeResult<readonly SessionFile[]>> {
  const filesLink = findLink(session.links, GET_FILES_REL);
  if (filesLink === undefined) {
    return linkMissing("compute session", session.id, GET_FILES_REL);
  }

  const directory = await client.send({
    link: filesLink,
    signal: options?.signal,
  });
  if (!directory.ok) return asSessionGone(directory);

  const directoryLinks = readLinks(directory.value.body);
  const membersLink = findLink(directoryLinks, DIRECTORY_MEMBERS_REL);
  if (membersLink === undefined) {
    return linkMissing(
      "session working directory",
      session.id,
      DIRECTORY_MEMBERS_REL,
    );
  }

  const members = await client.send({
    link: membersLink,
    signal: options?.signal,
  });
  if (!members.ok) return asSessionGone(members);

  const items = readItems(members.value);
  if (items === undefined) {
    return malformed(
      members.value,
      "a directory listing",
      'and it carried no "items" array',
    );
  }

  // Entries with no readable string `name` are dropped rather than failing
  // the whole listing — the same shape `readVariable` takes for an item
  // whose name does not match a filter, and for the same reason: nothing has
  // ever measured a listing item shaped this way, so this is defensive
  // breadth rather than a response to an observed deployment.
  const files: SessionFile[] = [];
  for (const item of items) {
    const name = readName(item);
    if (name === undefined) continue;
    files.push({ name, size: readSize(item), links: readLinks(item) });
  }
  return { ok: true, value: files };
}

export interface ReadFileContentOptions {
  signal?: AbortSignal | undefined;
  /** Overrides the transport's default response-body size cap
   * (`ComputeRequest.maxBodyBytes`) for this one fetch. `richOutput.ts` is the
   * only caller with a reason to *raise* it — ADR-0019's 10 MiB rich-output
   * cap. `backend/environment.ts`'s stage-2 probe also passes one explicitly
   * (`MAX_ENVIRONMENT_PROBE_BYTES`), but only to pin the transport's own
   * default rather than to loosen it. */
  maxBytes?: number | undefined;
}

/**
 * Reads a file's content, as bytes, exactly as the deployment sent them.
 *
 * Follows the item's `getFile` relation and reads `ComputeResponse.rawBody`
 * — never `.text`, whose `Buffer.toString("utf8")` decode is lossy for a
 * PNG's bytes (see `client.ts`'s own doc comment on `rawBody`). A response
 * with no `rawBody` at all is reported as malformed rather than silently
 * treated as empty content: every transport this project runs provides one,
 * so its absence means something this module has no way to explain.
 */
export async function readFileContent(
  client: ComputeClient,
  file: SessionFile,
  options?: ReadFileContentOptions,
): Promise<ComputeResult<Uint8Array>> {
  const link = findLink(file.links, FILE_CONTENT_REL);
  if (link === undefined) {
    return linkMissing("session file", file.name, FILE_CONTENT_REL);
  }

  const result = await client.send({
    link,
    signal: options?.signal,
    maxBodyBytes: options?.maxBytes,
  });
  if (!result.ok) return asSessionGone(result);

  if (result.value.rawBody === undefined) {
    return malformed(
      result.value,
      "a file's content",
      "and the transport returned no raw bytes for it",
    );
  }
  return { ok: true, value: result.value.rawBody };
}

export interface DeleteSessionFileOptions {
  signal?: AbortSignal | undefined;
}

/**
 * Deletes a file, reading a fresh `ETag` immediately beforehand.
 *
 * Two requests, in order: a `GET` of the item's `getFileProperties` relation
 * for the `ETag` header (finding 65 — not present in the JSON body), then a
 * `DELETE` of its `deleteFile` relation carrying that `ETag` as `If-Match`.
 * See this module's own doc comment for why the `ETag` is always re-read
 * rather than accepted from an earlier response.
 */
export async function deleteSessionFile(
  client: ComputeClient,
  file: SessionFile,
  options?: DeleteSessionFileOptions,
): Promise<ComputeResult<void>> {
  const propertiesLink = findLink(file.links, FILE_PROPERTIES_REL);
  if (propertiesLink === undefined) {
    return linkMissing("session file", file.name, FILE_PROPERTIES_REL);
  }
  const deleteLink = findLink(file.links, FILE_DELETE_REL);
  if (deleteLink === undefined) {
    return linkMissing("session file", file.name, FILE_DELETE_REL);
  }

  const fresh = await client.send({
    link: propertiesLink,
    signal: options?.signal,
  });
  if (!fresh.ok) return asSessionGone(fresh);

  if (fresh.value.etag === undefined) {
    return malformed(
      fresh.value,
      "a file representation",
      "and the response carried no ETag to delete it with",
    );
  }

  const result = await client.send({
    link: deleteLink,
    etag: fresh.value.etag,
    signal: options?.signal,
  });
  if (!result.ok) return asSessionGone(result);
  return { ok: true, value: undefined };
}

/** The `items` of a collection body, or `undefined` if there is no array there. */
function readItems(response: ComputeResponse): readonly unknown[] | undefined {
  const body: unknown = response.body;
  if (typeof body !== "object" || body === null) return undefined;
  const items: unknown = (body as { items?: unknown }).items;
  return Array.isArray(items) ? (items as readonly unknown[]) : undefined;
}

/** An item's `name`, or `undefined` if it is not a non-empty string. */
function readName(item: unknown): string | undefined {
  if (typeof item !== "object" || item === null) return undefined;
  const name: unknown = (item as { name?: unknown }).name;
  return typeof name === "string" && name !== "" ? name : undefined;
}

/** An item's `size`, or `undefined` if it is not a number — finding 67's
 * confirmed field, read defensively rather than assumed always present. */
function readSize(item: unknown): number | undefined {
  if (typeof item !== "object" || item === null) return undefined;
  const size: unknown = (item as { size?: unknown }).size;
  return typeof size === "number" ? size : undefined;
}

/** The failure for a representation that carried no such relation. */
function linkMissing(
  resource: string,
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
      detail: `a session files request answered HTTP ${String(response.status)} as ${response.contentType ?? "an unknown type"}, ${defect}`,
    },
  };
}
