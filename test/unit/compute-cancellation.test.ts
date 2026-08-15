// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";

import {
  abortOn,
  cancelledReason,
  type CancellationLike,
  type DisposableLike,
} from "../../src/compute/cancellation";

/**
 * The bridge between a progress bar's Cancel button and an `AbortSignal`.
 *
 * Small enough that the only interesting question is what happens to the
 * *listener*, which is why most of what follows counts subscriptions rather than
 * checking that aborting aborts. A token from `withProgress` outlives the request
 * it was passed to, so a listener left attached is a leak that grows by one per
 * run and never shows up as anything but a slowly heavier window.
 *
 * The fake token below is the argument for `CancellationLike` being structural:
 * this is the whole contract, in nine lines, with no extension host.
 */

interface FakeToken extends CancellationLike {
  /** Fires cancellation, as pressing Cancel would. */
  cancel(): void;
  /** Listeners still attached. */
  readonly listeners: number;
}

function token(init?: { cancelled?: boolean }): FakeToken {
  const listeners = new Set<() => void>();
  let cancelled = init?.cancelled ?? false;

  return {
    get isCancellationRequested(): boolean {
      return cancelled;
    },
    onCancellationRequested(listener: () => void): DisposableLike {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
    cancel(): void {
      cancelled = true;
      for (const listener of [...listeners]) listener();
    },
    get listeners(): number {
      return listeners.size;
    },
  };
}

describe("abortOn", () => {
  it("leaves the signal alone while nothing has been cancelled", () => {
    const bridge = abortOn(token());

    assert.equal(bridge.signal.aborted, false);
  });

  it("aborts when the token is cancelled", () => {
    const source = token();
    const bridge = abortOn(source);

    source.cancel();

    assert.equal(bridge.signal.aborted, true);
  });

  it("aborts with a reason something can print", () => {
    const source = token();
    const bridge = abortOn(source);

    source.cancel();

    // `client.ts` logs a thrown value's message, so an abort reason that is a
    // bare string arrives in the log as "undefined".
    assert.ok(bridge.signal.reason instanceof Error);
    assert.equal(bridge.signal.reason.message, cancelledReason().message);
  });

  it("returns an already-aborted signal for a token that has been cancelled", () => {
    // The uniform shape: a caller that had to check for this case first would
    // eventually forget, and the request would go out after the user cancelled.
    const bridge = abortOn(token({ cancelled: true }));

    assert.equal(bridge.signal.aborted, true);
    assert.doesNotThrow(() => {
      bridge.dispose();
    });
  });

  it("detaches its listener when disposed", () => {
    const source = token();
    const bridge = abortOn(source);
    assert.equal(source.listeners, 1);

    bridge.dispose();

    assert.equal(source.listeners, 0);
  });

  it("disposes twice without complaint", () => {
    const source = token();
    const bridge = abortOn(source);

    bridge.dispose();
    bridge.dispose();

    assert.equal(source.listeners, 0);
  });

  it("does not abort a signal it has already let go of", () => {
    const source = token();
    const bridge = abortOn(source);

    bridge.dispose();
    source.cancel();

    // A request that finished successfully must not end up holding an aborted
    // signal, because the next thing to read `.aborted` would be right to
    // conclude the user cancelled.
    assert.equal(bridge.signal.aborted, false);
  });

  it("does not cancel the token when the signal is aborted elsewhere", () => {
    const source = token();

    abortOn(source);

    // The bridge is one-way: a request that gave up on its own timeout has not
    // been cancelled by the user, and telling the progress UI otherwise would
    // dismiss it as though they had pressed Cancel.
    assert.equal(source.isCancellationRequested, false);
  });
});
