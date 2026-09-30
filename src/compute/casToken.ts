// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Delivers a CAS access token into a Compute session as a plain file a
 * Python cell can `open()` by name — 8b's own mechanism, under a stable name
 * since 12n.
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
 * ## One stable name, rewritten in place (12n)
 *
 * Until 12n every call picked a fresh `CT` + six random digits, so no code
 * that read the file could be committed or shared. The name is now the
 * `pythonOnViya.cas.tokenFileref` setting, `CASTOKEN` by default, and a
 * second call in the same session rewrites the same file: `assign` answers
 * `400`/5402 for a held name (Finding 12.10), {@link findFileref} reads the
 * held fileref's full representation (Finding 12.23), and
 * `writeFilerefContent` rewrites it. Nothing is deassigned or deleted, so
 * `fileref.ts`'s never-deassign invariant holds.
 *
 * ## Never write into a fileref this module did not create
 *
 * A fileref the user's own SAS code assigned under the same name is listed
 * in the same collection, with the same `upload` link (Finding 12.25).
 * Rewriting it would put the token into whatever file the user named. So a
 * held fileref is rewritten only when it is one this module's own `assign`
 * produces: `accessMethod` `DISK`, `fileName` equal to the name, and
 * `filePath` equal to the session's `homeDirectory` plus the name
 * ({@link isOwnTokenFileref}). Anything else comes back as `held-elsewhere`
 * and nothing is written.
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
 */

import { type ComputeClient, type ComputeResult } from "./client";
import {
  createFileref,
  type Fileref,
  findFileref,
  isFilerefAlreadyAssigned,
  writeFilerefContent,
} from "./fileref";
import { type ComputeSession } from "./session";

/** The token fileref's name when `pythonOnViya.cas.tokenFileref` is unset. */
export const DEFAULT_CAS_TOKEN_FILEREF = "CASTOKEN";

/** A SAS fileref name: a letter or underscore, then up to seven letters,
 * digits or underscores. Checked after upper-casing. */
const SAS_FILEREF_NAME = /^[A-Z_][A-Z0-9_]{0,7}$/;

/** The names `procPython.ts` assigns: `PYnnnnnn` per run, and `PYVSTART`
 * for the startup snippet (ADR-0041). Kept here as literals rather than
 * imported, because `src/compute` does not import `src/backend`; a unit test
 * pins both against `procPython.ts`'s own exports, `FILEREF_NAME_PATTERN`
 * and `STARTUP_FILEREF_NAME`. */
const RESERVED_FILEREF_NAME = /^(PY\d{6}|PYVSTART)$/;

/** The `accessMethod` of a fileref `assign` creates with a relative `path`
 * (Finding 12.25). */
const OWN_ACCESS_METHOD = "DISK";

/**
 * The token fileref name for a setting's raw value, or `undefined` if it is
 * not one this module will write to.
 *
 * Upper-cased, so the file's name on disk, which follows the `path` sent
 * (Finding 12.25), does not change with the case the setting was typed in:
 * SAS resolves fileref names ignoring case (Finding 12.23), but the Python
 * side opens the file by its exact name. Surrounding whitespace is ignored;
 * an empty value means the default.
 */
export function normaliseCasTokenFilerefName(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return DEFAULT_CAS_TOKEN_FILEREF;
  const name = trimmed.toUpperCase();
  if (!SAS_FILEREF_NAME.test(name)) return undefined;
  if (RESERVED_FILEREF_NAME.test(name)) return undefined;
  return name;
}

export interface WriteCasTokenOptions {
  signal?: AbortSignal | undefined;
}

/** What {@link writeCasToken} did with the name it was given. */
export type CasTokenOutcome =
  /** The token is in the file the snippet opens by `filerefName`. */
  | { readonly kind: "written"; readonly filerefName: string }
  /** The session holds `filerefName` for a file this module did not create,
   * so nothing was written. */
  | { readonly kind: "held-elsewhere"; readonly filerefName: string };

/**
 * Writes `token`'s UTF-8 bytes into the fileref `name` in `session`,
 * creating it on first use and rewriting it in place afterwards.
 *
 * `name` must already have passed {@link normaliseCasTokenFilerefName}.
 *
 * Three Compute calls on first use (`assign`, then `writeFilerefContent`'s
 * `self` `GET` and `upload` `PUT`), and at least five on a rewrite (the
 * refused `assign`, a page or more of the `files` collection, the item's
 * `self`, then the same two). Neither path ever composes or submits a SAS
 * statement naming the token; only the Compute REST API's own fileref
 * resources are touched.
 */
export async function writeCasToken(
  client: ComputeClient,
  session: ComputeSession,
  name: string,
  token: string,
  options?: WriteCasTokenOptions,
): Promise<ComputeResult<CasTokenOutcome>> {
  const signal = options?.signal;

  let fileref: Fileref;
  const created = await createFileref(client, session, name, { signal });
  if (created.ok) {
    fileref = created.value;
  } else if (isFilerefAlreadyAssigned(created)) {
    const found = await findFileref(client, session, name, { signal });
    if (!found.ok) return found;
    if (found.value === undefined) {
      const detail = `the session reported the fileref "${name}" as already assigned, but its fileref list does not hold it`;
      return {
        ok: false,
        reason: detail,
        problem: { code: "response-malformed", detail },
      };
    }
    if (!isOwnTokenFileref(found.value, name, session.homeDirectory)) {
      return { ok: true, value: { kind: "held-elsewhere", filerefName: name } };
    }
    fileref = found.value;
  } else {
    return created;
  }

  const written = await writeFilerefContent(
    client,
    fileref,
    new TextEncoder().encode(token),
    { signal },
  );
  if (!written.ok) return written;
  return { ok: true, value: { kind: "written", filerefName: name } };
}

/**
 * Whether a held fileref is the file this module's own `assign` of `name`
 * produces: a `DISK` fileref whose file is `name`, directly inside the
 * session's own run directory (Finding 12.25).
 *
 * Every field has to be present and match. A session representation without
 * a `homeDirectory`, or a fileref without a `filePath`, reads as not ours:
 * refusing costs the user a rename, while guessing wrong writes a credential
 * into a file they chose.
 */
export function isOwnTokenFileref(
  fileref: Fileref,
  name: string,
  homeDirectory: string | undefined,
): boolean {
  if (homeDirectory === undefined || homeDirectory === "") return false;
  const directory = homeDirectory.replace(/\/+$/, "");
  return (
    fileref.accessMethod === OWN_ACCESS_METHOD &&
    fileref.fileName === name &&
    fileref.filePath === `${directory}/${name}`
  );
}
