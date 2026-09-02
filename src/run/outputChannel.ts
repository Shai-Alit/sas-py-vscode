// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The plain output channel a run, a cancel or a reset writes to.
 *
 * Deliberately its own channel, separate from the `output` `LogOutputChannel`
 * `extension.ts` already creates for the extension's own diagnostics (info,
 * warn, error, shown by `pythonOnViya.showOutputChannel`). That one is a
 * *log* — timestamped, levelled, about the extension's own behaviour. This
 * one is a *transcript* of a running program: streamed stdout, in the order
 * it arrived, meant to read like a terminal rather than a log file. Mixing
 * the two would put a user's `print()` output between two lines about
 * whether a session reattached.
 *
 * ADR-0011: "every run names its target in the output channel as its first
 * line, so the record of where code ran outlives the status bar's current
 * state." That is {@link RunOutputChannel.writeRunHeader}/
 * {@link RunOutputChannel.writeResetHeader} below.
 *
 * Text-only, per 3d-i's own plan text. `text/html` and `image/png` outputs
 * are reported as having arrived, not rendered — 3d-ii's result panel is
 * where they are actually shown. See `./render`'s own doc comment for why
 * that split is drawn there and not here.
 */

import * as vscode from "vscode";

import { localiseBackendProblem } from "../backend/messages";
import type {
  ExecutionOutcome,
  RichOutput,
  Traceback,
} from "../backend/backend";
import type { BackendProblem } from "../backend/problems";
import { alreadyStreamedAsTraceback } from "../backend/tracebackDiagnostics";
import { renderRichOutput } from "./render";

/**
 * The one port this class would otherwise reach for on the `vscode`
 * namespace directly. Injectable for the same reason
 * `ComputeSessionDeps.createClient` is: `vscode.OutputChannel` has no public
 * way to read back what was written to it, so a test that wants to assert on
 * the transcript has to supply its own channel double.
 */
export interface RunOutputChannelDeps {
  createChannel?: ((name: string) => vscode.OutputChannel) | undefined;
}

export class RunOutputChannel implements vscode.Disposable {
  private readonly channel: vscode.OutputChannel;

  constructor(deps: RunOutputChannelDeps = {}) {
    // Wrapped, not passed bare: `vscode.window.createOutputChannel` is
    // overloaded (a plain name, a language id, or log-channel options), and
    // the wrapper pins the fallback to the exact one-argument shape
    // `RunOutputChannelDeps.createChannel` declares.
    const create =
      deps.createChannel ??
      ((name: string) => vscode.window.createOutputChannel(name));
    this.channel = create(vscode.l10n.t("Python on Viya: Output"));
  }

  /**
   * Reveals the channel without moving focus away from the editor — a run is
   * something to watch alongside your code, not something that should pull
   * you out of it.
   */
  reveal(): void {
    this.channel.show(true);
  }

  /** ADR-0011's first line: which profile this run is on. `description` names
   * what is running, e.g. a file name or "the selection in app.py". */
  writeRunHeader(profileName: string, description: string): void {
    this.channel.appendLine(
      vscode.l10n.t(
        'Running {0} on SAS Viya profile "{1}"…',
        description,
        profileName,
      ),
    );
  }

  /** Same first-line rule, for a reset rather than a run. */
  writeResetHeader(profileName: string): void {
    this.channel.appendLine(
      vscode.l10n.t(
        'Resetting the Python interpreter on SAS Viya profile "{0}"…',
        profileName,
      ),
    );
  }

  /**
   * Writes one streamed output. `text/plain` lines are appended verbatim —
   * they already carry their own trailing newline (`logFilter.ts`) — so the
   * channel reads exactly like the program's own stdout. Anything this slice
   * cannot render as text gets one localised line saying so; see `./render`.
   */
  writeOutput(output: RichOutput): void {
    for (const line of renderRichOutput(output)) {
      if (line.kind === "raw") {
        this.channel.append(line.text);
        continue;
      }
      this.channel.appendLine(
        line.mime === "image/png"
          ? vscode.l10n.t(
              "[an image was produced — the result panel to view it ships in a later slice]",
            )
          : vscode.l10n.t(
              "[an HTML table was produced — the result panel to view it ships in a later slice]",
            ),
      );
    }
  }

  /**
   * The run's own conclusion — succeeded, or raised with diagnostics.
   *
   * `streamedTraceback` is the structured `Traceback` this run streamed as its
   * trailing `RichOutput`, if any (`commands.ts`'s `drainOutputs` captures it).
   * A diagnostic whose message {@link alreadyStreamedAsTraceback} recognises as
   * that traceback's own is not echoed again here: its content already reached
   * this channel line by line as the raw log's `normal`-typed output (a
   * multi-line message as its separate lines, not the single joined string a
   * `PythonDiagnostic` carries), and repeating it under "Finished with an
   * error." is the redundancy Finding 74 named (Phase 5d-iii).
   *
   * What still prints, because the helper returns `false` for it:
   *
   * - A SAS-side error (`SYSCC=3000`, message from `SYSERRORTEXT`): no
   *   structured traceback, `streamedTraceback` is `undefined`, and this line
   *   is the only place the user sees it.
   * - The synthesized `SYNTHESIZED_TRACEBACK_MESSAGE` stand-in: a header and
   *   frames but no exception line followed them, so `parseTraceback` made the
   *   message up — it never streamed, so it must still show.
   * - A `ModuleNotFoundError`, whose diagnostic has `withModuleNotFoundGuidance`
   *   appended, so it is a strict superset of the streamed message. The whole
   *   line prints — one repeated tail, then the "Show Environment" pointer.
   *   Printing only the un-streamed suffix was considered and left out: the
   *   equality check fails safe (a future change to how the message is built
   *   can only ever cause an unwanted echo, never a truncated fragment), and
   *   the pointer is the part that matters. Tightening this one common case is
   *   a possible follow-up.
   */
  writeOutcome(outcome: ExecutionOutcome, streamedTraceback?: Traceback): void {
    if (outcome.succeeded) {
      this.channel.appendLine(vscode.l10n.t("Finished."));
    } else {
      this.channel.appendLine(vscode.l10n.t("Finished with an error."));
      for (const diagnostic of outcome.diagnostics) {
        if (alreadyStreamedAsTraceback(diagnostic.message, streamedTraceback)) {
          continue;
        }
        this.channel.appendLine(diagnostic.message);
      }
    }
    this.channel.appendLine("");
  }

  /** A reset's own conclusion when it succeeds — it produces no
   * `ExecutionOutcome` for {@link writeOutcome} to describe. */
  writeResetSucceeded(): void {
    this.channel.appendLine(vscode.l10n.t("The Python interpreter was reset."));
    this.channel.appendLine("");
  }

  /** A run, cancel or reset that never reached an outcome at all. */
  writeFailure(problem: BackendProblem): void {
    this.channel.appendLine(localiseBackendProblem(problem));
    this.channel.appendLine("");
  }

  dispose(): void {
    this.channel.dispose();
  }
}
