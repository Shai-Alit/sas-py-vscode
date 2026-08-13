// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Where a signed-in session is kept between windows.
 *
 * `SecretStorage` and nothing else: no decisions, no parsing, no policy about
 * what is worth keeping. All of that is in `signIn.ts` — `toStoredSession`,
 * `serializeSession`, `parseStoredSession` — which the unit tier can reach. This
 * file exists because those functions need somewhere to be called from that has a
 * keychain, and that place needs `vscode`.
 *
 * ## Two secrets per profile, and they are not the same secret
 *
 * A profile can have a *client* secret, which the user typed and which
 * `src/profile/store.ts` keeps under `secretKey(profile)`. This file keeps the
 * *session* — the refresh token the deployment issued — under
 * `sessionSecretKey(profile.id)`. Different keys on purpose: signing out must
 * destroy the session without destroying configuration the user entered by hand,
 * and deleting a profile must destroy both.
 *
 * Both are keyed on the profile's generated `id` rather than its name, which is
 * ADR-0007's delta from upstream. Upstream keys on the name, so renaming a
 * profile silently orphans its stored credential and the next sign-in prompt
 * arrives with no explanation.
 */

import * as vscode from "vscode";

import {
  parseStoredSession,
  serializeSession,
  sessionSecretKey,
  toStoredSession,
  type StoredSession,
} from "./signIn";
import type { Tokens } from "./tokenEndpoint";

export class SessionStore {
  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  /**
   * The stored session for a profile, or `undefined` when there is none to use.
   *
   * An entry that cannot be read is deleted rather than left in place. It can
   * only be one of: a shape written by an older version, something hand-edited,
   * or a truncated write — and none of those will start parsing later, so leaving
   * it means logging the same complaint on every read until the user finds the
   * keychain themselves. What it is never worth is quoting: the value is a
   * credential even when it is malformed.
   */
  async read(profileId: string): Promise<StoredSession | undefined> {
    const raw = await this.secrets.get(sessionSecretKey(profileId));
    if (raw === undefined) {
      return undefined;
    }

    const session = parseStoredSession(raw);
    if (session === undefined) {
      this.log.warn(
        vscode.l10n.t(
          "The stored sign-in for this connection profile could not be read, so it was discarded. Sign in again.",
        ),
      );
      await this.clear(profileId);
      return undefined;
    }
    return session;
  }

  /**
   * Persists what is worth persisting from a token set.
   *
   * A grant with no refresh token clears the stored session instead of writing an
   * empty one. That is not an edge case being tidied away: some deployments are
   * configured not to issue refresh tokens, and the honest record of that is no
   * stored session at all, so the next window starts at the browser rather than
   * on a token that was never there.
   */
  async write(profileId: string, tokens: Tokens): Promise<void> {
    const session = toStoredSession(tokens);
    if (session === undefined) {
      await this.clear(profileId);
      return;
    }
    await this.secrets.store(
      sessionSecretKey(profileId),
      serializeSession(session),
    );
  }

  /** Forgets the stored session. The profile and its client secret are untouched. */
  async clear(profileId: string): Promise<void> {
    await this.secrets.delete(sessionSecretKey(profileId));
  }
}
