// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Where a workspace's compute session id is kept between windows.
 *
 * `workspaceState` and nothing else: no decisions, no parsing, no policy about
 * what a stored binding means. All of that is in `binding.ts` —
 * `sessionBindingKey`, `serializeBinding`, `parseBinding`, `bindingMatches` —
 * and this file is only the place they are called from with a memento to hand.
 *
 * It takes that memento as a **narrow structural type** rather than importing
 * `vscode` at run time, which is why — unlike `auth/sessionStore.ts`, whose
 * shape it otherwise copies — it stays inside the coverage denominator and is
 * tested from the unit tier. ADR-0009's rule is mechanical and this is what it
 * mechanically says: nothing here needs a value from the `vscode` module, only
 * two of its interfaces, and an interface is erased before the code runs.
 * `Pick` rather than the whole `Memento` and the whole `LogOutputChannel`
 * because two methods and one method is the entire dependency.
 *
 * ## `workspaceState`, which is per *workspace*
 *
 * ADR-0012. The grain is the folder, because a session is where this folder's
 * code runs — the same grain and the same reasoning ADR-0011 used for the run
 * target. Two windows open on one folder therefore **share** one session, which is
 * a consequence stated out loud rather than defended: the store has no per-window
 * option, and a claim protocol on top of a last-writer-wins memento with no
 * cross-window change event would be racy in exactly the case it was built for.
 *
 * `globalState` was the alternative and lost: a scratch window would inherit the
 * production folder's namespace, and nobody would ever ask why a name resolved.
 *
 * ## Nothing here is a credential
 *
 * A session id is not secret, which is why this is a memento rather than
 * `SecretStorage`. It is not *nothing*, either — it names a SAS process on a
 * server — so it is written as an opaque string through the codec and never
 * logged: on the deployment probed, a session payload carries the user's email
 * address, and the id is the handle to that payload.
 */

import type * as vscode from "vscode";

import {
  parseBinding,
  serializeBinding,
  sessionBindingKey,
  type SessionBinding,
} from "./binding";

/** The two `Memento` methods a binding store uses. `workspaceState` satisfies it. */
export type BindingMemento = Pick<vscode.Memento, "get" | "update">;

/** The one log method a binding store uses. A `LogOutputChannel` satisfies it. */
export type BindingLog = Pick<vscode.LogOutputChannel, "debug">;

export class SessionBindingStore {
  constructor(
    private readonly state: BindingMemento,
    private readonly log: BindingLog,
  ) {}

  /**
   * The binding this workspace last wrote for a profile, if it can still be read.
   *
   * An entry that cannot be parsed is removed rather than left in place, on the
   * same reasoning as the session store: it is an older shape, a hand-edit, or a
   * truncated write, and none of those start parsing later.
   *
   * The log line is `debug`, not `warn`. Losing a session binding costs the user
   * a fresh interpreter and about seven seconds; a warning in the output channel
   * would give an ordinary, self-healing event the same weight as a failure to
   * reach the deployment.
   */
  read(profileId: string): SessionBinding | undefined {
    const raw: unknown = this.state.get(sessionBindingKey(profileId));
    if (raw === undefined) return undefined;

    const binding = parseBinding(raw);
    if (binding === undefined) {
      this.log.debug(
        "discarded an unreadable compute session binding for this workspace",
      );
      void this.clear(profileId);
      return undefined;
    }
    return binding;
  }

  /** Remembers the session this workspace is using with a profile. */
  async write(profileId: string, binding: SessionBinding): Promise<void> {
    await this.state.update(
      sessionBindingKey(profileId),
      serializeBinding(binding),
    );
  }

  /**
   * Forgets the binding, leaving no key behind.
   *
   * `undefined` rather than an empty string: a memento removes a key when it is
   * updated to `undefined`, and the house rule is that a store which has nothing
   * to say leaves nothing written down.
   */
  async clear(profileId: string): Promise<void> {
    await this.state.update(sessionBindingKey(profileId), undefined);
  }
}
