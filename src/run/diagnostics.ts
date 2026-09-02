// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Phase 4d: a failed Python run's error in the Problems panel.
 *
 * A thin `vscode`-importing shell around one `DiagnosticCollection` — the
 * same shape `outputChannel.ts` / `resultPanel.ts` take around their own
 * `vscode` singletons. The position maths it stands on is 4c's pure
 * `src/backend/tracebackDiagnostics.ts` (`primaryPosition`,
 * `mapFrameToOrigin`); nothing here recomputes an offset.
 *
 * ## What gets published, and when
 *
 * `src/run/commands.ts` calls {@link RunDiagnostics.clearFor} at the start of
 * every run (keyed on the program's origin URI) and {@link
 * RunDiagnostics.publish} once, on a run that settled with `succeeded ===
 * false` **and** streamed a structured traceback. One `Diagnostic` is set,
 * at the innermost mappable (`<string>`) frame — the idiomatic
 * one-entry-per-error VS Code pattern this phase's 4c Runbook entry settled
 * on, not one `Diagnostic` per frame — with the rest of the `<string>` stack
 * carried as `relatedInformation` so a reader can still walk it.
 *
 * ## Why nothing is published when no frame maps
 *
 * `primaryPosition` returns `undefined` for a SAS-side failure with no
 * Python frames (`SYSCC=3000`), or a traceback whose frames are all library
 * or user-`<stdin>` code. There is no honest editor position for those, and
 * a `Diagnostic` planted at line 0 would point at code that is not the
 * problem. The output channel and the result panel already carry the failure
 * message in full; the Problems panel is for the positioned ones. This is
 * `tracebackDiagnostics.ts`'s own rule ("guessing a position … would be
 * worse than leaving it unmapped"), applied at the surface.
 */

import * as vscode from "vscode";

import type { ProgramOrigin, Traceback } from "../backend/backend";
import {
  mapFrameToOrigin,
  primaryPosition,
  STRING_FRAME_FILE,
} from "../backend/tracebackDiagnostics";

/**
 * The Problems panel's "source" column. A fixed tool identifier — the role
 * `tsserver` ("ts"), ESLint and Pylance all fill with a stable brand string.
 *
 * Deliberately **not** `vscode.l10n.t()`, and so deliberately outside what
 * `l10n:extract` sees — unlike the feature's other `"Python on Viya"`
 * literals (`extension.ts`, `statusBar.ts`), which are prose the user reads.
 * A `Diagnostic.source` that varied by locale would split Problems-panel
 * filtering, which keys on this exact text; a per-locale identifier there is
 * a bug, not a missing translation.
 */
const SOURCE = "Python on Viya";

/** `languages.createDiagnosticCollection`'s name — `phase-4.md`'s 4d entry
 * names this string exactly. Also the collection's `name`, which VS Code
 * shows nowhere the user looks but which `source` above covers. */
const COLLECTION_NAME = "pythonOnViya";

export interface RunDiagnosticsDeps {
  /** Defaults to `vscode.languages.createDiagnosticCollection`. Injectable
   * for symmetry with `RunOutputChannelDeps.createChannel` — the integration
   * tier can hand in a collection it retains a reference to and asserts on. */
  createCollection?:
    ((name: string) => vscode.DiagnosticCollection) | undefined;
}

export class RunDiagnostics implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;

  constructor(deps: RunDiagnosticsDeps = {}) {
    const create =
      deps.createCollection ??
      ((name: string) => vscode.languages.createDiagnosticCollection(name));
    this.collection = create(COLLECTION_NAME);
  }

  /**
   * Drops any diagnostic previously published for `uri`.
   *
   * Called at the start of every run, success or failure, so a run that now
   * passes — or one that fails somewhere with no traceback to map — leaves
   * nothing stale in the Problems panel.
   */
  clearFor(uri: vscode.Uri): void {
    this.collection.delete(uri);
  }

  /**
   * Publishes one `Diagnostic` for a failed run, at the innermost mappable
   * frame of `traceback`. A no-op when no frame maps — see this module's doc
   * comment.
   *
   * `message` is the already-composed diagnostic text: `src/run/commands.ts`
   * passes `ExecutionOutcome.diagnostics[0].message`, which 4c's
   * `withModuleNotFoundGuidance` has already appended the "Show Environment"
   * pointer to for a `ModuleNotFoundError`. This module does not re-derive it
   * from `traceback.message`.
   */
  publish(origin: ProgramOrigin, traceback: Traceback, message: string): void {
    const position = primaryPosition(traceback, origin);
    if (position === undefined) return;

    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(
        position.line,
        position.character,
        position.line,
        position.character,
      ),
      message,
      vscode.DiagnosticSeverity.Error,
    );
    diagnostic.source = SOURCE;

    const related = relatedFrames(origin, traceback);
    // Every `<string>` frame, the innermost (the diagnostic's own line)
    // included — for a recursion, that repeated ladder *is* the useful
    // information, and VS Code rendering one related child on the same line
    // as the diagnostic is the accepted cost of it. Attached only when there
    // is more than one: a lone `<string>` frame's single related entry would
    // add nothing but a duplicate of the diagnostic's location.
    if (related.length > 1) diagnostic.relatedInformation = related;

    this.collection.set(origin.uri, [diagnostic]);
  }

  dispose(): void {
    this.collection.dispose();
  }
}

/**
 * Every `<string>` frame of `traceback`, in the order Python printed them
 * (outermost first), as related-information entries pointing back into
 * `origin.uri`.
 *
 * Non-`<string>` frames are skipped: a library or user-`<stdin>` frame has
 * no location in the user's own file to point at, and
 * `DiagnosticRelatedInformation` has no "unlocated" form. The label mirrors
 * Python's own `line N, in name`, with the line already mapped to the
 * editor's (one-based, for display).
 */
function relatedFrames(
  origin: ProgramOrigin,
  traceback: Traceback,
): vscode.DiagnosticRelatedInformation[] {
  const related: vscode.DiagnosticRelatedInformation[] = [];
  for (const frame of traceback.frames) {
    if (frame.file !== STRING_FRAME_FILE) continue;
    const position = mapFrameToOrigin(frame, origin);
    if (position === undefined) continue;
    related.push(
      new vscode.DiagnosticRelatedInformation(
        new vscode.Location(
          origin.uri,
          new vscode.Position(position.line, position.character),
        ),
        vscode.l10n.t(
          "line {0}, in {1}",
          String(position.line + 1),
          frame.name,
        ),
      ),
    );
  }
  return related;
}
