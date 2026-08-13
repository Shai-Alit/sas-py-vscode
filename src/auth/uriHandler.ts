// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The one URI handler this extension registers, and the dispatch behind it.
 *
 * VS Code allows exactly one handler per extension, so this cannot be owned by a
 * sign-in attempt — it has to outlive every attempt and hand each inbound
 * callback to whichever attempts are outstanding. Registration happens at
 * activation and the disposable goes on `context.subscriptions`, which is what
 * "disposed on deactivate" means in practice.
 *
 * ## Dispatch is by `state`, not by bookkeeping
 *
 * A consumer is offered the query and answers whether it took it. That is not a
 * roundabout way of asking "is this yours" — it is the state check, which is the
 * only trustworthy answer to that question, and it already lives in
 * `readCallback`. Two windows can be signing in to two deployments at once and
 * each will recognise its own callback because it issued the `state` in it.
 *
 * ## Nothing here logs the query
 *
 * The query string of a callback contains an authorization code. Codes are
 * short-lived and PKCE-bound, but a log is a file users paste into issues, and
 * "it was probably expired by then" is not a property worth relying on. The log
 * lines below say that a callback arrived and what happened to it, never what was
 * in it.
 *
 * Structure follows: client/src/connection/rest/auth.ts in
 * sassoftware/vscode-sas-extension (Apache-2.0). No code was copied. Upstream
 * registers its handler inside the sign-in function, so a second sign-in
 * registers a second handler; the ownership here is the fix for that.
 */

import * as vscode from "vscode";

/**
 * The path a callback must arrive on: `vscode://<publisher>.<name>/auth-callback`.
 *
 * Matching on the path rather than accepting every inbound URI keeps this from
 * swallowing links meant for features that do not exist yet. When one arrives on
 * a path nobody claims, the right answer is to leave it alone.
 */
export const CALLBACK_PATH = "/auth-callback";

/**
 * Offered a callback's query string; answers whether it consumed it.
 *
 * `false` means "not mine, or not something I can act on" — a wrong `state`, or a
 * query with no code in it. Returning `false` must leave the consumer waiting,
 * because the attempt it belongs to is still in flight.
 */
export type CallbackConsumer = (query: string) => boolean;

/**
 * Receives `vscode://` callbacks and offers them to the sign-in attempts waiting
 * for one.
 */
export class AuthUriHandler implements vscode.UriHandler, vscode.Disposable {
  /**
   * Insertion-ordered, and iterated in that order, so the oldest outstanding
   * attempt sees a callback first. With a state check on every consumer the order
   * cannot change which one wins; it only makes the behaviour deterministic
   * rather than incidental.
   */
  private readonly consumers = new Set<CallbackConsumer>();

  constructor(private readonly log: vscode.LogOutputChannel) {}

  /**
   * Registers a consumer for as long as the returned disposable is held.
   *
   * The caller disposes it when its attempt settles — including when it settles
   * by being cancelled, which is the case that leaks if it is forgotten.
   */
  listen(consumer: CallbackConsumer): vscode.Disposable {
    this.consumers.add(consumer);
    return new vscode.Disposable(() => {
      this.consumers.delete(consumer);
    });
  }

  handleUri(uri: vscode.Uri): void {
    if (uri.path !== CALLBACK_PATH) {
      // Not ours to interpret, and not an error. Logged at debug because a
      // stray link is a thing someone may eventually need to see.
      this.log.debug(`ignoring a link on an unrecognised path: ${uri.path}`);
      return;
    }

    // Copied before iterating: a consumer settles its attempt from inside this
    // call, which disposes its own registration and mutates the set.
    for (const consumer of [...this.consumers]) {
      if (consumer(uri.query)) {
        return;
      }
    }

    // Every consumer declined, or there were none. Both are ordinary: a callback
    // can arrive after its attempt timed out, after the user cancelled, or from a
    // link that was never ours. None of them is worth a modal.
    this.log.warn(
      vscode.l10n.t(
        "A sign-in response arrived with no sign-in waiting for it, so it was ignored.",
      ),
    );
  }

  dispose(): void {
    this.consumers.clear();
  }
}

/** Creates the handler and registers it for the lifetime of the extension. */
export function registerAuthUriHandler(
  context: vscode.ExtensionContext,
  log: vscode.LogOutputChannel,
): AuthUriHandler {
  const handler = new AuthUriHandler(log);
  context.subscriptions.push(
    handler,
    vscode.window.registerUriHandler(handler),
  );
  return handler;
}
