// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * What this extension asks `vscode.authentication.getSession` for, and why.
 *
 * A module of its own, containing one type and one pure function, for a reason
 * worth stating: **the options handed to `getSession` are load-bearing, and
 * until this file existed nothing could see them**. The session manager injects
 * its authentication port one frame *above* the call, so every test asserted
 * which {@link AuthRequest} was chosen and none of them could assert what that
 * choice turned into. A defect lived in that gap for the length of slice 2a-iii
 * — see {@link getSessionOptions} — and moving the mapping down here, with a
 * type-only `vscode` import, puts it inside the coverage denominator where the
 * unit tier can state each arm as a case. ADR-0009's rule is mechanical: an
 * erased import is no import.
 */

import type * as vscode from "vscode";

/**
 * Which of the three ways to ask VS Code for a session is wanted.
 *
 * A union rather than the booleans `getSession` actually takes, because only
 * three of their combinations mean anything and several are rejected at run time
 * — `createIfNone` with `silent`, `forceNewSession` with either. Naming the three
 * cases puts that constraint in the type instead of in a comment nobody reads
 * twice.
 *
 * - `known` — the deployment is already signed in to and we know as whom.
 *   `createIfNone` plus the account, so an unexpired session comes straight back
 *   and an expired one is renewed without a picker.
 * - `new` — nothing is signed in to *this* deployment, and there is no account
 *   to name. The awkward case, because it is the one where the host will name an
 *   account for us if we let it.
 * - `silent` — behind a request already in flight, or a menu poll. Answers from
 *   what is held or not at all, and shows nothing either way.
 */
export type AuthRequest =
  | {
      readonly kind: "known";
      readonly account: vscode.AuthenticationSessionAccountInformation;
    }
  | { readonly kind: "new" }
  | {
      readonly kind: "silent";
      readonly account?:
        vscode.AuthenticationSessionAccountInformation | undefined;
    };

/**
 * The options for one request.
 *
 * Exhaustive `switch`, no `default`: a fourth {@link AuthRequest} arm should stop
 * compiling here rather than silently fall through to whichever of these looked
 * closest.
 *
 * ## Why `new` clears the session preference
 *
 * Found by hand against a live deployment on 2026-08-15, and it is the whole
 * reason this function is not inline. `getSession` does **not** pass our options
 * to our own provider unchanged. VS Code's `doGetSession`
 * (`vs/workbench/api/browser/mainThreadAuthentication.ts`) computes
 *
 * ```text
 * accountToCreate = options.account ?? matchingAccountPreferenceSession?.account
 * ```
 *
 * and hands *that* to `createSession`. So when we name nobody, the host names
 * somebody for us: the account it remembered from the last interactive
 * `getSession` that succeeded, stored by `updateAccountPreference`. Our provider
 * honours `options.account` above the active profile — deliberately, because
 * that is how the Accounts menu's *sign in again* row must behave — and it has
 * no way to tell a preference the host recalled from an account the user
 * clicked. The visible symptom was a browser opening on the previous
 * deployment's login page after switching profile.
 *
 * `clearSessionPreference` is the fix because `doGetSession` calls
 * `removeAccountPreference` *before* it reads the preference, so `accountToCreate`
 * falls back to `undefined` and the provider is left to decide from the active
 * profile. It is scoped to this extension and this provider, and we never want
 * that preference read: routing by profile is the job this extension does.
 *
 * The other two arms deliberately do without it. `known` already passes an
 * account, and the preference is not consulted when one is given. `silent` is a
 * poll — the Accounts menu calls it, repeatedly — and clearing a preference is a
 * write, so putting it there would make reading the menu mutate state.
 *
 * ## Why `new` still uses `forceNewSession`
 *
 * Unchanged, but its justification is narrower than it used to be. With another
 * deployment's account already present, `createIfNone` reaches
 * `selectSession` and offers a picker listing accounts that cannot serve this
 * profile; picking one is the mistake the account hint exists to stop.
 * `forceNewSession` skips the picker. It does **not** skip the substitution
 * above, which is what the previous version of this comment got wrong. Where
 * nothing at all is signed in the two are equivalent, as the API contract says,
 * so this one arm covers both.
 */
export function getSessionOptions(
  request: AuthRequest,
): vscode.AuthenticationGetSessionOptions {
  switch (request.kind) {
    case "known":
      return { createIfNone: true, account: request.account };
    case "new":
      return { forceNewSession: true, clearSessionPreference: true };
    case "silent":
      return {
        silent: true,
        ...(request.account === undefined ? {} : { account: request.account }),
      };
  }
}
