// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * A VS Code cancellation token, as an `AbortSignal`.
 *
 * **This module must never import `vscode`.**
 *
 * `withProgress` hands a `CancellationToken` to the work it runs; every function
 * in `src/compute` takes an `AbortSignal`. Both mean "stop", and neither knows
 * about the other, so something has to sit between them. This is that, and it is
 * here rather than in the shell because the interesting part — that the listener
 * is removed whether or not cancellation happened — is worth a unit test, and
 * because a leak here is one per request rather than one per session.
 *
 * ## Structural, not imported
 *
 * {@link CancellationLike} is written out rather than taken from `vscode`, even
 * as an `import type`. A real `vscode.CancellationToken` satisfies it, and so
 * does a three-line fake in a test, which is the point: this module stays inside
 * the coverage denominator, the "never import `vscode`" rule above stays literally
 * true rather than true-with-an-exception, and nothing here can drift towards
 * using a member of the token that only the real host has.
 *
 * ## Cancellation is not a failure to report
 *
 * An aborted request comes back from the client as `compute-unreachable`, whose
 * message is "could not reach the compute service" — accurate for a dropped
 * connection and misleading for a user who pressed Cancel. So the rule for
 * callers is: on a failure, ask the token first, and if it was cancelled say
 * nothing. VS Code's progress UI has already told the user what happened, and
 * `cancelled` is deliberately not a {@link ComputeProblem} — a problem code exists
 * to be explained to someone, and this one would only ever be swallowed.
 *
 * That also settles the race where a request fails for a real reason at the
 * moment the user cancels: the user asked for it to stop, so stopping is the
 * honest answer, and the alternative is an error dialog about a request they had
 * already given up on.
 */

/** Something that disposes. `vscode.Disposable` is one; so is an object literal. */
export interface DisposableLike {
  dispose(): void;
}

/**
 * The part of `vscode.CancellationToken` this needs.
 *
 * The listener takes no argument and the extra `thisArgs`/`disposables`
 * parameters of a `vscode.Event` are left off, which is what makes a real token
 * assignable here: a function may always accept fewer arguments than it is given.
 */
export interface CancellationLike {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): DisposableLike;
}

/**
 * An `AbortSignal` and the subscription behind it.
 *
 * Two fields rather than a bare signal, because the caller has to be able to let
 * go. A token from `withProgress` lives as long as the progress item, so a
 * listener left attached after a request finishes outlives its own
 * `AbortController` — harmless once, and a slow leak across a session's worth of
 * runs.
 */
export interface AbortBridge extends DisposableLike {
  readonly signal: AbortSignal;
}

/**
 * The reason an abort carries when it came from the user.
 *
 * An `Error` rather than a string so that anything which logs a thrown value's
 * message — `client.ts` does — has something to print. It should not normally be
 * seen: a caller that follows the rule above discards the failure entirely.
 */
export function cancelledReason(): Error {
  return new Error("cancelled");
}

/**
 * Bridges a cancellation token to an `AbortSignal`.
 *
 * Always returns something disposable, including when the token was already
 * cancelled — a caller that had to check for that case first would eventually
 * forget, and the cost of the uniform shape is one no-op call.
 *
 * The bridge is one-way on purpose. Aborting the signal does not cancel the
 * token: the token belongs to VS Code, and a request that gave up on its own
 * timeout has not been cancelled by the user and must not tell the progress UI
 * that it was.
 */
export function abortOn(token: CancellationLike): AbortBridge {
  const controller = new AbortController();

  if (token.isCancellationRequested) {
    controller.abort(cancelledReason());
    return { signal: controller.signal, dispose: () => undefined };
  }

  const subscription = token.onCancellationRequested(() => {
    controller.abort(cancelledReason());
  });

  let disposed = false;
  return {
    signal: controller.signal,
    dispose: () => {
      // Idempotent because the natural way to use this is a `finally`, and the
      // natural way to get it wrong is a `finally` inside a `finally`.
      if (disposed) return;
      disposed = true;
      subscription.dispose();
    },
  };
}
