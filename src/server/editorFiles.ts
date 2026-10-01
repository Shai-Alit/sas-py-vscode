// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The lost-update guard for files an editor opens from the SAS Server view.
 *
 * **This module must never import `vscode`.** It is the half of
 * `serverFileSystem.ts` with a branch in it, kept here so the unit tier can
 * reach it, as `src/content/contentSession.ts` is for SAS Content.
 *
 * {@link ServerEditorFiles.read} records the `ETag` each read returned, keyed
 * by profile and path. {@link ServerEditorFiles.write} sends the tag of the
 * latest read or save, never a fresh one, so a save after someone else
 * changed the file is refused (`412`) rather than overwriting it. Upstream
 * sends an empty `If-Match`, which skips the check (Finding 13.26).
 *
 * The tag is per file, not per editor. Any read of the file replaces it, so
 * a read the editor did not make, such as **Compare with Saved**, can leave
 * a tag for newer bytes than a modified editor holds. VS Code's own check
 * before a save, which compares `stat`'s time and size, is then what stops
 * the overwrite. Manual item 13.53 checks it.
 *
 * - A file never read here, or read without an `ETag`, is refused
 *   `no-version` rather than written unconditionally.
 * - A save that succeeds carries its new tag into the next save. One that
 *   succeeds with no tag makes the next save `no-version`, rather than send
 *   a tag already used.
 * - A save that fails leaves the tag as it was: the editor still holds the
 *   same version, so a retry sends the same tag and gets the same answer.
 */

import { type ServerAdapter, type ServerResult } from "./adapter";
import { type ServerUriParts } from "./path";

/** What the guard needs from an adapter. */
export type EditorFileAdapter = Pick<ServerAdapter, "readFile" | "writeFile">;

export class ServerEditorFiles {
  /** By `profileId\npath`: the tag a read or save returned, or `null` when
   * it returned none. A profile id or path with a newline in it would only
   * collide with another built the same way. */
  private readonly versions = new Map<string, string | null>();

  constructor(
    private readonly adapterFor: (profileId: string) => EditorFileAdapter,
  ) {}

  async read(parts: ServerUriParts): Promise<ServerResult<Uint8Array>> {
    const result = await this.adapterFor(parts.profileId).readFile(parts.path);
    if (!result.ok) return result;
    this.versions.set(keyOf(parts), result.value.etag ?? null);
    return { ok: true, value: result.value.bytes };
  }

  async write(
    parts: ServerUriParts,
    bytes: Uint8Array,
  ): Promise<ServerResult<void>> {
    const key = keyOf(parts);
    const etag = this.versions.get(key);
    if (etag === undefined || etag === null) {
      return {
        ok: false,
        reason: `"${parts.path}" has no version tag to save against`,
        problem: { code: "no-version", path: parts.path },
      };
    }
    const result = await this.adapterFor(parts.profileId).writeFile(
      parts.path,
      bytes,
      etag,
    );
    if (!result.ok) return result;
    this.versions.set(key, result.value ?? null);
    return { ok: true, value: undefined };
  }
}

function keyOf(parts: ServerUriParts): string {
  return `${parts.profileId}\n${parts.path}`;
}
