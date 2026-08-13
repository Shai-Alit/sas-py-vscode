// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The two host-owned things the auth shell needs and an integration test cannot
 * be handed: a `SecretStorage` and a log channel.
 *
 * A `vscode.SecretStorage` only reaches an extension through
 * `ExtensionContext.secrets`, and a context is only given to `activate`. A test
 * runs *inside* the extension host but is not itself an extension, so there is no
 * supported way to obtain one. Exposing the context from `activate` purely so the
 * tests could reach it would put a test-only member on the extension's public
 * surface, which is a worse trade than this double.
 *
 * What the double still buys, and it is not nothing: these suites load the shell
 * modules under the host's own module resolution, call them with real
 * `vscode.Uri`, real `vscode.CancellationTokenSource`, and a real
 * `vscode.LogOutputChannel`, and reach the `vscode.l10n.t()` calls on their
 * warning paths — every one of which the unit tier cannot even import. The *real*
 * `context.secrets` is exercised the one way a test can reach it, by running the
 * sign-out command end to end; see `test/integration/auth/commands.test.ts`.
 *
 * This file imports `vscode`, so only the integration tier can load it.
 */

import * as vscode from "vscode";

/** An in-memory `SecretStorage` whose contents the test can read back. */
export interface MemorySecrets extends vscode.SecretStorage {
  /** The stored values, by key. Assert on the key namespace, not just the value. */
  readonly entries: Map<string, string>;
}

/**
 * A `SecretStorage` backed by a `Map`.
 *
 * The change event is real and is fired on both writes and deletes, because a
 * double that silently does not fire it would let a listener bug through.
 */
export function memorySecrets(): MemorySecrets & vscode.Disposable {
  const entries = new Map<string, string>();
  const emitter = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();

  return {
    entries,
    onDidChange: emitter.event,
    get(key: string): Thenable<string | undefined> {
      return Promise.resolve(entries.get(key));
    },
    store(key: string, value: string): Thenable<void> {
      entries.set(key, value);
      emitter.fire({ key });
      return Promise.resolve();
    },
    delete(key: string): Thenable<void> {
      entries.delete(key);
      emitter.fire({ key });
      return Promise.resolve();
    },
    dispose(): void {
      emitter.dispose();
    },
  };
}

/**
 * A `Memento` backed by a `Map`, for the state a test cannot otherwise reach.
 *
 * Same problem as `memorySecrets` and the same answer: `globalState` arrives on
 * an `ExtensionContext`, and a test is not an extension. `setKeysForSync` is a
 * no-op because nothing here syncs, but it has to exist — `globalState` on a
 * context is a `Memento` plus that one method, and the store's parameter type
 * asks for the real thing.
 *
 * `update(key, undefined)` deletes rather than storing `undefined`, which is what
 * the real memento does and what `ProfileStore` relies on to leave no key behind
 * once its list is empty.
 */
export function memoryMemento(): vscode.ExtensionContext["globalState"] {
  const entries = new Map<string, unknown>();

  return {
    keys: () => [...entries.keys()],
    get<T>(key: string, fallback?: T): T | undefined {
      const stored = entries.get(key);
      // The one assertion in this file, and it is the interface's, not ours:
      // `Memento.get<T>` promises a `T` for a store that holds anything. Every
      // implementation of it, VS Code's included, ends up here.
      return stored === undefined ? fallback : (stored as T);
    },
    update(key: string, value: unknown): Thenable<void> {
      if (value === undefined) entries.delete(key);
      else entries.set(key, value);
      return Promise.resolve();
    },
    setKeysForSync(): void {
      // Nothing in a test run syncs anywhere.
    },
  };
}

const channels = new Map<string, vscode.LogOutputChannel>();

/**
 * A real log channel, named so that anything it prints during a test run is
 * attributable to the suite that made it.
 *
 * Real rather than a spy on purpose: the shell logs through `vscode.l10n.t()`,
 * and a `t()` call with the wrong number of arguments is the kind of mistake that
 * only shows up when something actually renders it.
 *
 * **Do not dispose what this returns, and do not expect a fresh channel per
 * test.** A log channel's name is its identity to the host: it is derived into a
 * logger id and a log file, and the host caches the logger under it. Dispose one
 * and create another by the same name and you get the cached, already-disposed
 * logger back — the host prints "Trying to add a disposable to a DisposableStore
 * that has already been disposed of" once, and every write from then on throws
 * "Channel has been closed". A per-test create/dispose cycle therefore kills the
 * channel for the whole rest of the run, and the failures land on whatever logs
 * next rather than on the test that caused them.
 *
 * So the caching here is not an optimisation, it is the host's own model: one
 * channel per name, created on first use, alive for the run. That is also what an
 * extension does — `activate` creates its channel once — so the previous
 * arrangement was not modelling anything real anyway. The extension host disposes
 * these when the run ends.
 */
export function testLogChannel(name: string): vscode.LogOutputChannel {
  const existing = channels.get(name);
  if (existing !== undefined) return existing;

  const created = vscode.window.createOutputChannel(
    `Python on Viya test: ${name}`,
    { log: true },
  );
  channels.set(name, created);
  return created;
}

/** Resolves after `ms`, for the few assertions that are about nothing happening. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
