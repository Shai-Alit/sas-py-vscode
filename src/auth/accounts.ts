// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * What the Accounts menu shows, and what counts as a change to it.
 *
 * **This module must never import `vscode`.**
 *
 * `authProvider.ts` is the `AuthenticationProvider` VS Code talks to; this file
 * is the part of it that can be reasoned about without an editor. The split is
 * the one described in `src/profile/model.ts` and followed by every slice since:
 * put the decisions where the unit tier can reach them, and leave the shell
 * holding only the calls it cannot avoid.
 *
 * ## Why the diff is here and not inline
 *
 * `onDidChangeSessions` is an event the editor acts on. Firing it when nothing
 * changed makes the Accounts menu flicker and, worse, invites every future
 * listener to re-derive state on a signal that carries no information. Firing it
 * when something *did* change and getting the arms wrong — an account reported
 * as added when it was relabelled — is the kind of thing that looks fine until a
 * user has two profiles.
 *
 * Deciding that inline in the provider would make "did anything actually change"
 * answerable only by launching an editor and watching. {@link diffSessions} makes
 * it a function over two arrays, so it is answered by unit tests instead.
 */

/**
 * One row in the Accounts menu, minus the credential.
 *
 * Deliberately not VS Code's `AuthenticationSession`: that type carries the
 * access token, and this is the value that gets compared, logged about, held in
 * arrays and passed to a pure function. Keeping the token out of the shape that
 * moves around means it cannot be accidentally included in any of that.
 */
export interface SessionSummary {
  /**
   * The session id, which is the profile's generated id.
   *
   * Decision 10: the profile *id*, never its name. A name is a user-editable
   * label, so keying on it means renaming a profile presents as signing out and
   * signing in as somebody else.
   */
  readonly id: string;
  /** From `accountId(endpoint, user.id)` in `./identity`. */
  readonly accountId: string;
  /** From `accountLabel(user)` in `./identity`. */
  readonly accountLabel: string;
}

/**
 * What changed between two readings of the session list.
 *
 * The three arms are VS Code's, and they are not interchangeable: `added` and
 * `removed` move rows in and out of the Accounts menu, `changed` updates one in
 * place.
 */
export interface SessionDiff {
  readonly added: readonly SessionSummary[];
  readonly removed: readonly SessionSummary[];
  readonly changed: readonly SessionSummary[];
}

/**
 * Compares two session lists by id.
 *
 * A session is *changed* rather than added-and-removed when its id survives but
 * the account behind it does not match — which happens for real, in two ways
 * worth handling properly. A profile can be repointed at a different deployment,
 * and an administrator can change a display name. The first is a genuinely
 * different account under the same profile; the second is the same account with
 * a new label. Both keep the profile id, so both belong in `changed`.
 *
 * Order is not significant and duplicate ids are not expected — profile ids are
 * generated and unique — so the last entry for an id wins rather than being
 * reported twice.
 */
export function diffSessions(
  before: readonly SessionSummary[],
  after: readonly SessionSummary[],
): SessionDiff {
  const wasThere = byId(before);
  const isThere = byId(after);

  const added: SessionSummary[] = [];
  const changed: SessionSummary[] = [];
  for (const [id, session] of isThere) {
    const previous = wasThere.get(id);
    if (previous === undefined) {
      added.push(session);
    } else if (!sameAccount(previous, session)) {
      changed.push(session);
    }
  }

  const removed: SessionSummary[] = [];
  for (const [id, session] of wasThere) {
    if (!isThere.has(id)) {
      removed.push(session);
    }
  }

  return { added, removed, changed };
}

/**
 * Is this diff worth firing an event for?
 *
 * The provider asks before firing rather than firing and letting listeners work
 * it out. An event with three empty arrays is indistinguishable from a real one
 * at the point a listener receives it.
 */
export function isEmptyDiff(diff: SessionDiff): boolean {
  return (
    diff.added.length === 0 &&
    diff.removed.length === 0 &&
    diff.changed.length === 0
  );
}

function sameAccount(a: SessionSummary, b: SessionSummary): boolean {
  return a.accountId === b.accountId && a.accountLabel === b.accountLabel;
}

function byId(
  sessions: readonly SessionSummary[],
): Map<string, SessionSummary> {
  return new Map(sessions.map((session) => [session.id, session]));
}
