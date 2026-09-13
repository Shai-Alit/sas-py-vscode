// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Delivers a CAS access token into a Compute session as a plain file a
 * Python cell can `open()` by name — 8b's own mechanism.
 *
 * **This module must never import `vscode`.**
 *
 * Finding 8.5 (`docs/phases/phase-8.md`) proved the borrowed Compute access
 * token authenticates CAS too; Finding 8.6 proved the naive way to get it
 * into a cell — an inline `submit`/`endsubmit` block — echoes it into the
 * job log in plaintext. The fix reuses exactly the mechanism `fileref.ts`
 * already built for `PROC PYTHON` source (ADR-0014): `createFileref` then
 * `writeFilerefContent`, over the Compute REST API alone, with no SAS
 * statement ever submitted that names the token. A fileref's content lands
 * as a plain relative-path file inside the session's own run directory
 * (finding 57, `fileref.ts`'s own doc comment) — the same directory
 * `files.ts` lists for rich-output capture — so the Python side opens it by
 * that bare name, no path resolution or macro variable needed.
 *
 * ## Reused as-is, deliberately never deleted
 *
 * `fileref.ts`'s own doc comment states a load-bearing invariant: nothing in
 * this extension ever deassigns or deletes a fileref, which is what lets a
 * `404` elsewhere be read as "the session is gone" rather than "something
 * deleted this resource on purpose." This module keeps that invariant
 * intact rather than carving out an exception for the token file — a
 * developer decision (2026-09-13, `phase-8.md`'s 8b Decisions), not an
 * oversight: the token file persists in the session's run directory for the
 * life of the session, the same exposure window an already-borrowed token
 * has anyway, and the whole point of this project's own upload discipline
 * is that Python source is never deleted either.
 *
 * ## Naming: `CT` + six digits, mirroring `procPython.ts`'s `PYnnnnnn`
 *
 * A SAS fileref name is capped at eight characters, the same constraint
 * `procPython.ts`'s `PYnnnnnn` names satisfy. Unlike that module, this one
 * has no persistent per-session counter to seed — a command invocation is a
 * one-shot call, not a class instance a backend holds for a session's whole
 * life — so each attempt picks a fresh random six-digit suffix rather than
 * incrementing one, and retries under a new name on the same retriable
 * `4xx` `createFileref` can answer for a name already assigned in the
 * session (a stale token file from an earlier invocation, per the never-
 * delete invariant above). {@link isRetriableFilerefName} mirrors
 * `procPython.ts`'s own function of the same name and reasoning.
 */

import {
  type ComputeClient,
  type ComputeFailure,
  type ComputeResult,
} from "./client";
import { createFileref, writeFilerefContent } from "./fileref";
import { type ComputeSession } from "./session";

/** How many fileref names one call will try before giving up — mirrors
 * `procPython.ts`'s `MAX_FILEREF_ASSIGN_ATTEMPTS` and its reasoning: far
 * more than a random six-digit collision can realistically need, and still
 * a hard stop rather than a loop. */
export const MAX_CAS_TOKEN_ASSIGN_ATTEMPTS = 16;

export interface WriteCasTokenOptions {
  signal?: AbortSignal | undefined;
}

export interface CasTokenFileref {
  /** The fileref name the CAS-connect snippet opens by, exactly as assigned
   * — bare, no path, since the fileref's content lands directly in the
   * session's own run directory (finding 57). */
  readonly filerefName: string;
}

/**
 * Writes `token`'s UTF-8 bytes into a fresh fileref in `session`, retrying
 * under a new name on a retriable name collision.
 *
 * Two Compute calls per successful attempt, the same pair `procPython.ts`
 * makes per run: `createFileref` (an `assign` `POST`), then
 * `writeFilerefContent` (a `self` `GET` for a fresh `ETag`, then an `upload`
 * `PUT`) — see `fileref.ts`'s own doc comment for why the `ETag` read is not
 * skipped. Neither ever composes or submits a SAS statement naming the
 * token; only the Compute REST API's own fileref resources are touched.
 */
export async function writeCasToken(
  client: ComputeClient,
  session: ComputeSession,
  token: string,
  options?: WriteCasTokenOptions,
): Promise<ComputeResult<CasTokenFileref>> {
  const bytes = new TextEncoder().encode(token);

  let lastCollision: ComputeFailure | undefined;
  for (let attempt = 0; attempt < MAX_CAS_TOKEN_ASSIGN_ATTEMPTS; attempt += 1) {
    const name = randomFilerefName();
    const created = await createFileref(client, session, name, {
      signal: options?.signal,
    });
    if (!created.ok) {
      if (!isRetriableFilerefName(created)) return created;
      lastCollision = created;
      continue;
    }

    const written = await writeFilerefContent(client, created.value, bytes, {
      signal: options?.signal,
    });
    if (!written.ok) return written;

    return { ok: true, value: { filerefName: name } };
  }

  const detail =
    lastCollision === undefined
      ? `${String(MAX_CAS_TOKEN_ASSIGN_ATTEMPTS)} fileref names were all already assigned in the session`
      : `${lastCollision.reason} (${String(MAX_CAS_TOKEN_ASSIGN_ATTEMPTS)} names tried, all already assigned)`;
  return {
    ok: false,
    reason: detail,
    problem: { code: "response-malformed", detail },
  };
}

/** `CT` plus six random digits — eight characters, a valid SAS fileref name,
 * matching `procPython.ts`'s `PYnnnnnn` shape. Not sequential: see this
 * module's own doc comment for why a one-shot call has no counter to seed.
 *
 * `globalThis.crypto.getRandomValues`, not `node:crypto` — ADR-0003 confines
 * Node built-ins to a five-file allow-list (`eslint.config.mjs`) precisely so
 * a web extension host build never has to reimplement one, and the Web
 * Crypto global this project already targets covers this module's whole
 * need (a name unlikely to collide, nothing cryptographically load-bearing)
 * without joining that list. */
function randomFilerefName(): string {
  const buffer = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buffer);
  const value = buffer[0] ?? 0;
  const digits = (value % 1_000_000).toString().padStart(6, "0");
  return `CT${digits}`;
}

/**
 * Whether a failed `createFileref` is worth retrying under a different name.
 *
 * Identical reasoning to `procPython.ts`'s function of the same name: the
 * only per-call variable this module controls is the fileref `name`, so a
 * `4xx` from the `assign` `POST` (most often `400`, "the fileref … already
 * exists") means that name is unusable and a new one is the fix. A `404` is
 * already remapped to `session-gone` by `fileref.ts`, and neither that nor a
 * `5xx`/transport failure is something a new name would change.
 */
function isRetriableFilerefName(failure: ComputeFailure): boolean {
  const { problem } = failure;
  return (
    problem.code === "compute-rejected" &&
    problem.error.status >= 400 &&
    problem.error.status < 500
  );
}
