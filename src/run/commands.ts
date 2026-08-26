// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Slice 3d-i's commands: `selectRunTarget`, `Run File`, `Run Selection`,
 * `Cancel`, `Reset Python state`.
 *
 * This is the first module that ever constructs a `ProcPythonBackend` from a
 * live `ComputeConnection` — nothing before this slice turned a session into
 * something that can run Python. One backend is held per profile, reused
 * across runs for as long as the underlying `ComputeConnection` object is the
 * same one `ComputeSessionManager` hands back; a reconnect (a new session, a
 * new dialect resolution) gets a fresh backend rather than one carrying the
 * old session's fileref/run counters.
 *
 * ADR-0011 governs everything about *which* target a run goes to and how the
 * target is chosen; this module is what a chosen target actually does. Two
 * context keys this module owns and nothing else does:
 *
 *  - `pythonOnViya.runTarget` — `"local"` or `"viya"`, gating `package.json`'s
 *    `editor/title/run` and `editor/context` entries (ADR-0011).
 *  - `pythonOnViya.running` — whether *this window* currently has a run or a
 *    reset in flight, gating Cancel's enablement. Only one can be in flight
 *    at a time in a window (the backend is serial and this module only ever
 *    starts a second one after the first's promise settles), so a single
 *    module-scoped flag is the whole state, the same shape
 *    `pythonOnViya.connected` uses in `compute/commands.ts`.
 */

import * as vscode from "vscode";

import type { ExecutionHandle, Program } from "../backend/backend";
import { localiseBackendProblem } from "../backend/messages";
import type { BackendProblem } from "../backend/problems";
import { ProcPythonBackend, type SubmissionGuard } from "../backend/procPython";
import type {
  ComputeConnection,
  ComputeSessionManager,
} from "../compute/sessionManager";
import type { ProfileStore } from "../profile/store";
import { RunOutputChannel } from "./outputChannel";
import { runTargetPickEntries } from "./target";
import type { RunTargetStore } from "./targetStore";

/** Gates `editor/title/run` and `editor/context` (ADR-0011). */
export const RUN_TARGET_CONTEXT_KEY = "pythonOnViya.runTarget";
/** Gates the Cancel command's `enablement`. */
export const RUNNING_CONTEXT_KEY = "pythonOnViya.running";

/** What this module needs from `ProfileStore`, narrowed the same way every
 * other command module narrows it. */
export type RunCommandProfiles = Pick<
  ProfileStore,
  "names" | "get" | "setActiveName"
>;

/** What this module needs from `ComputeSessionManager`: connecting the
 * active profile, and the per-profile submission guard `procPython.ts`'s
 * `SubmissionGuard` is a narrowed port onto. */
export type RunCommandSessions = Pick<
  ComputeSessionManager,
  "connect" | "isBusy" | "startSubmission" | "endSubmission"
>;

/** One backend per profile, held for as long as the connection it was built
 * from is still the live one. */
interface CachedBackend {
  readonly connection: ComputeConnection;
  readonly backend: ProcPythonBackend;
}

/**
 * The ports this module would otherwise reach for on the `vscode` namespace
 * directly. Same reasoning as `ComputeSessionDeps`: an integration test
 * cannot open a real editor, drive a real quick pick, or click a real
 * progress notification's Cancel button, so each is injectable and defaults
 * to the real thing.
 */
export interface RunCommandDeps {
  /** Defaults to `vscode.window.activeTextEditor`. */
  activeTextEditor?: (() => vscode.TextEditor | undefined) | undefined;
  /** Defaults to `vscode.window.showQuickPick`. */
  showQuickPick?:
    | (<T extends vscode.QuickPickItem>(
        items: readonly T[],
        options: vscode.QuickPickOptions,
      ) => Thenable<T | undefined>)
    | undefined;
  /** Defaults to `vscode.window.withProgress`. */
  withProgress?:
    | (<T>(
        location: vscode.ProgressLocation,
        title: string,
        cancellable: boolean,
        run: (
          progress: vscode.Progress<{ message?: string }>,
          token: vscode.CancellationToken,
        ) => Promise<T>,
      ) => Thenable<T>)
    | undefined;
  /** Defaults to `vscode.window.showInformationMessage`. */
  inform?: ((message: string) => void) | undefined;
  /** Defaults to `vscode.window.showErrorMessage`. */
  report?: ((message: string) => void) | undefined;
  /** Defaults to a fresh `RunOutputChannel`. Supplying one hands its
   * lifecycle to the caller — this module then leaves it off
   * `context.subscriptions`, so a test can inspect it after the fact without
   * it being disposed out from under it at suite teardown. */
  outputChannel?: RunOutputChannel | undefined;
}

/**
 * The five commands' behaviour, as callable functions — no
 * `vscode.commands.registerCommand` call among them.
 *
 * Command ids are process-global for the whole test host, and the real
 * extension claims all five of this module's at activation (`onStartupFinished`
 * — see `extension.ts`'s own comment on that). Every other command module in
 * this codebase tests guard behaviour by exercising the underlying class
 * directly (`ComputeSessionManager`, `SessionStore`, …) rather than by trying
 * to register a second, fake-wired copy of an already-claimed command id —
 * `registerCommand` throws "command already exists" the moment it tries. This
 * function is `commands.ts`'s equivalent seam: a test builds handlers with its
 * own fakes and calls them directly, and `registerRunCommands` below is the
 * thin shell that wires the same handlers to the real registry exactly once,
 * at real activation.
 */
export interface RunCommandHandlers extends vscode.Disposable {
  readonly outputChannel: RunOutputChannel;
  runFile(): Promise<void>;
  runSelection(): Promise<void>;
  cancelRun(): Promise<void>;
  resetPythonState(): Promise<void>;
  selectRunTarget(): Promise<void>;
}

export function createRunCommandHandlers(
  sessions: RunCommandSessions,
  profiles: RunCommandProfiles,
  targets: RunTargetStore,
  log: vscode.LogOutputChannel,
  deps: RunCommandDeps = {},
): RunCommandHandlers {
  const outputChannel = deps.outputChannel ?? new RunOutputChannel();
  const backends = new Map<string, CachedBackend>();
  /** The one run this window can have in flight, so the Cancel command can
   * find its handle without the progress notification being the only thing
   * that knows it. `undefined` whenever no `execute()` is outstanding — never
   * set for a `reset()`, which produces no handle; see `cancelRun`'s own
   * comment for how that case is handled instead. */
  let currentRun:
    { backend: ProcPythonBackend; handle: ExecutionHandle } | undefined;

  const syncTargetContext = (): void => {
    void vscode.commands.executeCommand(
      "setContext",
      RUN_TARGET_CONTEXT_KEY,
      targets.kind(),
    );
  };
  const syncRunningContext = (value: boolean): void => {
    void vscode.commands.executeCommand(
      "setContext",
      RUNNING_CONTEXT_KEY,
      value,
    );
  };
  const targetChangeSubscription = targets.onDidChange(syncTargetContext);
  syncTargetContext();
  syncRunningContext(false);

  const activeEditor = (): vscode.TextEditor | undefined =>
    (deps.activeTextEditor ?? (() => vscode.window.activeTextEditor))();

  const pick = async <T extends vscode.QuickPickItem>(
    items: readonly T[],
    options: vscode.QuickPickOptions,
  ): Promise<T | undefined> => {
    const show = deps.showQuickPick;
    if (show !== undefined) return await show(items, options);
    return await vscode.window.showQuickPick([...items], options);
  };

  const showProgress = async <T>(
    location: vscode.ProgressLocation,
    title: string,
    cancellable: boolean,
    run: (
      progress: vscode.Progress<{ message?: string }>,
      token: vscode.CancellationToken,
    ) => Promise<T>,
  ): Promise<T> => {
    const show = deps.withProgress;
    if (show !== undefined)
      return await show(location, title, cancellable, run);
    return await vscode.window.withProgress(
      { location, title, cancellable },
      run,
    );
  };

  const inform = (message: string): void => {
    const show = deps.inform;
    if (show !== undefined) {
      show(message);
      return;
    }
    void vscode.window.showInformationMessage(message);
  };

  const report = (message: string): void => {
    const show = deps.report;
    if (show !== undefined) {
      show(message);
      return;
    }
    void vscode.window.showErrorMessage(message);
  };

  const guardFor = (profileId: string): SubmissionGuard => ({
    isBusy: () => sessions.isBusy(profileId),
    startSubmission: () => sessions.startSubmission(profileId),
    endSubmission: () => {
      sessions.endSubmission(profileId);
    },
  });

  /**
   * Connects the active profile and returns the backend for it, reusing one
   * already built from the same `ComputeConnection`. `undefined` means
   * `sessions.connect()` already reported why — a dead token, an untrusted
   * folder, no profile — and there is nothing further to say here.
   */
  const backendFor = async (): Promise<CachedBackend | undefined> => {
    const connection = await sessions.connect();
    if (connection === undefined) return undefined;

    const cached = backends.get(connection.profileId);
    if (cached?.connection === connection) {
      // Idempotent and I/O-free (`ExecutionBackend.connect()`'s own
      // contract) — always re-marking a cached backend connected is what
      // makes it safe to hand back one `cancelRun` closed underneath a
      // `reset()`: closing sets `connected = false` and there is no other
      // hook that would otherwise notice and reconnect it.
      await cached.backend.connect();
      return cached;
    }

    if (cached?.backend.busy) {
      // A reconnect landed while the old backend still had a run or a reset
      // in flight (a new `ComputeConnection` for the same profile — a
      // reattach, a new dialect resolution). Overwriting the cache entry
      // below would otherwise orphan it: `cancelRun`'s reset-interrupt path
      // only ever looks at what `backends` holds *now*, so the old backend
      // would keep running with nothing left able to reach it. Closing it
      // here is the same "cancel whatever is in flight, then disconnect"
      // `close()` already does for every other caller of it.
      await cached.backend.close();
    }

    const backend = new ProcPythonBackend(
      connection.client,
      connection.session,
      connection.generation.dialect,
      guardFor(connection.profileId),
      (reason) => {
        log.warn(reason);
      },
    );
    // Never performs I/O (ExecutionBackend's own contract) — this only marks
    // the backend ready to accept `execute()`/`reset()` calls.
    await backend.connect();

    const entry: CachedBackend = { connection, backend };
    backends.set(connection.profileId, entry);
    return entry;
  };

  const reportNotReady = (reason: "local" | "no-profile"): void => {
    report(
      reason === "local"
        ? vscode.l10n.t(
            "The run target is Local Python. Switch the run target to a SAS Viya profile to run this on Viya.",
          )
        : vscode.l10n.t(
            "No SAS Viya connection profile is selected. Select a run target before running.",
          ),
    );
  };

  const reportProblem = (problem: BackendProblem): void => {
    report(localiseBackendProblem(problem));
  };

  /** Builds a {@link Program} from the whole document, or from a non-empty
   * selection. `undefined` for an empty selection — there is nothing to run.
   *
   * `selection === undefined` is the *whole-file* call (`runNow(true)` passes
   * no selection at all, deliberately, regardless of what is highlighted in
   * the editor) — that is the only case that falls back to the whole
   * document. A defined-but-empty `Selection` is `runNow(false)`'s own "the
   * user ran Run Selection with nothing selected" case, and must return
   * `undefined` rather than silently running the whole file — the two were
   * folded into the same branch until this was caught by
   * `commands.test.ts`'s "tells the user to select code" guard actually
   * running end to end for the first time. */
  const buildProgram = (
    document: vscode.TextDocument,
    selection: vscode.Selection | undefined,
  ): Program | undefined => {
    if (selection === undefined) {
      return {
        bytes: new TextEncoder().encode(document.getText()),
        origin: { uri: document.uri, lineOffset: 0 },
      };
    }
    if (selection.isEmpty) return undefined;
    const text = document.getText(selection);
    if (text.trim() === "") return undefined;
    return {
      bytes: new TextEncoder().encode(text),
      origin: { uri: document.uri, lineOffset: selection.start.line },
    };
  };

  const baseName = (uri: vscode.Uri): string => {
    const segments = uri.path.split("/");
    return segments[segments.length - 1] ?? uri.path;
  };

  const runNow = async (whole: boolean): Promise<void> => {
    const readiness = targets.readiness();
    if (!readiness.ok) {
      reportNotReady(readiness.reason);
      return;
    }

    const editor = activeEditor();
    if (editor?.document.languageId !== "python") {
      inform(vscode.l10n.t("Open a Python file to run it on SAS Viya."));
      return;
    }

    const program = buildProgram(
      editor.document,
      whole ? undefined : editor.selection,
    );
    if (program === undefined) {
      inform(vscode.l10n.t("Select some code to run."));
      return;
    }

    const built = await backendFor();
    if (built === undefined) return;
    const { backend, connection } = built;

    if (backend.busy) {
      reportProblem({ code: "busy", running: "a run in this window" });
      return;
    }

    const description = whole
      ? baseName(editor.document.uri)
      : vscode.l10n.t("the selection in {0}", baseName(editor.document.uri));

    syncRunningContext(true);
    try {
      const executed = await backend.execute(program, {
        freshNamespace: whole,
      });
      if (!executed.ok) {
        reportProblem(executed.problem);
        return;
      }

      outputChannel.reveal();
      outputChannel.writeRunHeader(connection.profileName, description);
      const handle = executed.value;
      currentRun = { backend, handle };

      // `ProgressLocation.Notification`, not `Window`: VS Code's own contract
      // is that only a notification's progress supports a cancel button — a
      // `Window`-located `cancellable: true` renders no button at all, so the
      // token below would never fire from the UI (only the Command Palette's
      // own Cancel command would ever reach it). Found on review.
      await showProgress(
        vscode.ProgressLocation.Notification,
        vscode.l10n.t("Running {0} on SAS Viya…", description),
        true,
        async (_progress, token) => {
          const subscription = token.onCancellationRequested(() => {
            void backend.cancel(handle);
          });
          try {
            await drainOutputs(handle, outputChannel);
          } finally {
            subscription.dispose();
          }
        },
      );

      const settled = await handle.done;
      if (!settled.ok) {
        outputChannel.writeFailure(settled.problem);
      } else {
        outputChannel.writeOutcome(settled.value);
      }
    } finally {
      currentRun = undefined;
      syncRunningContext(false);
    }
  };

  const cancelRun = async (): Promise<void> => {
    if (currentRun !== undefined) {
      await currentRun.backend.cancel(currentRun.handle);
      return;
    }
    // No `execute()` handle in flight, but a `reset()` might be — it
    // produces none, so the only way the seam lets a caller interrupt one is
    // `close()`, which cancels whatever is running and then disconnects.
    // `backendFor()` always re-marks a reused backend connected first, which
    // is what makes closing it here safe for whatever this window asks for
    // next.
    //
    // Scoped to the *currently active* profile's own cached backend, not "any
    // busy one in the map" — a window can hold a cached backend per profile
    // it has ever run against, and a Cancel invoked while parked on profile B
    // must not reach in and close a stray run still going on profile A.
    const status = targets.status();
    const profileId =
      status.kind === "viya" && status.profileName !== undefined
        ? profiles.get(status.profileName)?.id
        : undefined;
    const cached =
      profileId === undefined ? undefined : backends.get(profileId);
    if (cached?.backend.busy) {
      await cached.backend.close();
      return;
    }
    inform(vscode.l10n.t("Nothing is running."));
  };

  const resetPythonState = async (): Promise<void> => {
    const readiness = targets.readiness();
    if (!readiness.ok) {
      reportNotReady(readiness.reason);
      return;
    }

    const built = await backendFor();
    if (built === undefined) return;
    const { backend, connection } = built;

    if (backend.busy) {
      reportProblem({ code: "busy", running: "a run in this window" });
      return;
    }

    syncRunningContext(true);
    outputChannel.reveal();
    outputChannel.writeResetHeader(connection.profileName);
    try {
      // Window, not Notification: this one is not cancellable (a reset has
      // no handle of its own — see `cancelRun`'s comment), so there is no
      // button whose absence would be misleading.
      const result = await showProgress(
        vscode.ProgressLocation.Window,
        vscode.l10n.t("Resetting the Python interpreter…"),
        false,
        async () => await backend.reset(),
      );
      if (!result.ok) {
        outputChannel.writeFailure(result.problem);
      } else {
        outputChannel.writeResetSucceeded();
      }
    } finally {
      syncRunningContext(false);
    }
  };

  const selectRunTarget = async (): Promise<void> => {
    const entries = runTargetPickEntries(profiles.names(), targets.status());
    // Conditional spreads, not `description: maybeUndefined` — the same
    // reason `profile/commands.ts`'s `askValidated` builds its options this
    // way: `exactOptionalPropertyTypes` treats an explicit `undefined` as a
    // different thing from an absent key, and `vscode.QuickPickItem`'s
    // optional fields want the key absent, not present and empty.
    const items = entries.map((entry) => {
      const endpoint =
        entry.kind === "viya" && entry.profileName !== undefined
          ? profiles.get(entry.profileName)?.endpoint
          : undefined;
      return {
        label:
          entry.kind === "local"
            ? `$(vm-outline) ${vscode.l10n.t("Local Python")}`
            : `$(server) ${entry.profileName ?? ""}`,
        ...(endpoint === undefined ? {} : { description: endpoint }),
        ...(entry.current ? { detail: vscode.l10n.t("Currently in use") } : {}),
        entry,
      };
    });

    const picked = await pick(items, {
      title: vscode.l10n.t("Select Run Target"),
      placeHolder: vscode.l10n.t("Where should Python code run?"),
    });
    if (picked === undefined) return;

    if (picked.entry.kind === "local") {
      await targets.setKind("local");
      return;
    }
    if (picked.entry.profileName !== undefined) {
      await profiles.setActiveName(picked.entry.profileName);
    }
    await targets.setKind("viya");
  };

  return {
    outputChannel,
    runFile: () => runNow(true),
    runSelection: () => runNow(false),
    cancelRun,
    resetPythonState,
    selectRunTarget,
    dispose: () => {
      targetChangeSubscription.dispose();
      if (deps.outputChannel === undefined) outputChannel.dispose();
    },
  };
}

export function registerRunCommands(
  context: vscode.ExtensionContext,
  sessions: RunCommandSessions,
  profiles: RunCommandProfiles,
  targets: RunTargetStore,
  log: vscode.LogOutputChannel,
  deps: RunCommandDeps = {},
): void {
  const handlers = createRunCommandHandlers(
    sessions,
    profiles,
    targets,
    log,
    deps,
  );

  context.subscriptions.push(
    handlers,
    vscode.commands.registerCommand("pythonOnViya.selectRunTarget", () =>
      handlers.selectRunTarget(),
    ),
    vscode.commands.registerCommand("pythonOnViya.runFile", () =>
      handlers.runFile(),
    ),
    vscode.commands.registerCommand("pythonOnViya.runSelection", () =>
      handlers.runSelection(),
    ),
    vscode.commands.registerCommand("pythonOnViya.cancelRun", () =>
      handlers.cancelRun(),
    ),
    vscode.commands.registerCommand("pythonOnViya.resetPythonState", () =>
      handlers.resetPythonState(),
    ),
  );

  log.debug("registered the run commands");
}

/** Streams a handle's outputs into the channel until it ends. Separate
 * function so `runNow`'s `withProgress` callback reads as "drain, then wait
 * for the outcome" rather than a loop buried inside a bigger one. */
async function drainOutputs(
  handle: ExecutionHandle,
  outputChannel: RunOutputChannel,
): Promise<void> {
  for await (const output of handle.outputs) {
    outputChannel.writeOutput(output);
  }
}
