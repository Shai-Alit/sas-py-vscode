// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * What a workspace remembers about its compute session, and how it is written
 * down.
 *
 * **This module must never import `vscode`.**
 *
 * ADR-0012 decided that a window which reloads should get its Python namespace
 * back rather than a fresh interpreter, which means one thing has to survive the
 * reload: the session id. This module is the key naming and the codec for it,
 * kept apart from the store that reads and writes it for the same reason
 * `signIn.ts` is kept apart from `secretStorage` — the interesting part is the
 * shape and its rejections, and those are worth unit tests rather than a VS Code
 * host.
 *
 * ## The stored value is a hint
 *
 * Nothing here asserts the session exists. ADR-0012's whole protocol is: use the
 * id, catch the `404`, create another one. Finding 29 measured a dead session
 * answering `404` identically to one that never existed, so a validity flag would
 * be a value that cannot be kept true.
 *
 * ## Why the context name travels with the id, and the endpoint does not
 *
 * A session is created *from* a compute context, and it keeps that context's
 * environment for life. So a user who changes `computeContext` on their profile
 * and reloads would otherwise reattach to a session built from the old one, and
 * see their change do nothing at all — the invisible-contamination shape ADR-0012
 * rejects `globalState` for. Comparing the name on read costs a string compare
 * and makes the change take effect.
 *
 * The deployment endpoint gets no such treatment, because that case corrects
 * itself: an id from one deployment is not an id on another, so it answers `404`
 * and the reconnect turns into a create. A field only earns its place here when
 * the stale case would otherwise *succeed*.
 */

/** The `workspaceState` key prefix for a profile's compute session. */
const BINDING_KEY_PREFIX = "pythonOnViya.computeSession.";

/**
 * The schema version {@link serializeBinding} writes.
 *
 * A stored value outlives the extension that wrote it. An install from six months
 * ago is entitled to have written a different shape, and the alternative to a
 * version is guessing from the keys that happen to be present.
 */
export const BINDING_SCHEMA_VERSION = 1;

/**
 * The session a workspace last used with a profile.
 *
 * Deliberately not a {@link ComputeSession}. The links, the state and the ETag are
 * all facts about a live representation, and every one of them is stale the
 * moment the window closes; writing them down would produce a record that looks
 * usable and is not.
 */
export interface SessionBinding {
  readonly id: string;
  /** The compute context the session was created from. See the module note. */
  readonly context: string;
}

/**
 * The `workspaceState` key for a profile's session binding.
 *
 * Keyed on the profile's generated `id`, never its name — ADR-0007's rule, and
 * the same one `sessionSecretKey` follows. A name is a user-editable label, so
 * renaming a profile would otherwise orphan its session while leaving the SAS
 * process running until the 900-second timeout reaps it.
 *
 * Note the key is *not* `pythonOnViya.session.<id>`: that name is already the
 * refresh token's, in `SecretStorage`. Different stores cannot collide, but two
 * things called the same thing eventually get treated as one.
 */
export function sessionBindingKey(profileId: string): string {
  if (profileId.trim() === "") {
    throw new Error("a session binding needs a profile id");
  }
  return `${BINDING_KEY_PREFIX}${profileId}`;
}

export function serializeBinding(binding: SessionBinding): string {
  return JSON.stringify({
    v: BINDING_SCHEMA_VERSION,
    id: binding.id,
    context: binding.context,
  });
}

/**
 * Reads back what {@link serializeBinding} wrote, or `undefined` for anything
 * else.
 *
 * Every rejection is silent and returns the same thing. The ways this value can
 * be wrong — truncated, from an older schema, hand-edited, written by a different
 * extension into a key that happens to match — all have the same remedy, which is
 * to start a session; and a caller told *which* way it was wrong could not act
 * differently on it. Unlike the token codec, the reason is not secrecy: an id is
 * not a credential. It is that there is exactly one recovery.
 *
 * Stored as a string rather than an object even though `workspaceState` accepts
 * structured values, so that the codec is the only thing that has ever seen the
 * shape and a hand-edited `state.vscdb` cannot hand a caller a half-typed record.
 */
export function parseBinding(raw: unknown): SessionBinding | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }

  const record = parsed as Record<string, unknown>;
  if (record.v !== BINDING_SCHEMA_VERSION) return undefined;

  const { id, context } = record;
  if (typeof id !== "string" || id === "") return undefined;
  if (typeof context !== "string" || context === "") return undefined;

  return { id, context };
}

/**
 * Whether a stored binding is worth trying against the context now configured.
 *
 * A case sensitivity note, because it is a judgement rather than an oversight:
 * this compares exactly. Viya's own `eq(name,…)` filter is case-sensitive
 * (finding 15 resolved contexts by exact name), so two spellings that differ in
 * case are two different lookups to the deployment, and treating them as one here
 * would reattach to a session the configured name would not have found.
 */
export function bindingMatches(
  binding: SessionBinding,
  context: string,
): boolean {
  return binding.context === context;
}
