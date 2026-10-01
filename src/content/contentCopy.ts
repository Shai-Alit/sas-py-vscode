// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Paste a copied SAS Content item into a folder (13b) — the `vscode` shell
 * over `src/content/copy.ts`'s {@link copyItem}, which decides and does
 * everything on the server and is unit-tested. This file shows progress,
 * logs, reports and reveals the copy. `contentCommands.ts` holds the
 * clipboard and calls {@link pasteCopy} when what it holds was copied, not
 * cut ([ADR-0045](../../docs/adr/0045-content-copy-paste.md)).
 *
 * The progress and summary helpers are 13a's (`contentTransfer.ts`), so a
 * copy reports the way an upload or a download does: a cancellable
 * notification, every file attempted even when one fails, a cancel that
 * says how far it got, and a count of what was left out.
 */

import * as vscode from "vscode";

import { type ContentAdapter } from "./adapter";
import { type ContentCommandDeps } from "./contentCommands";
import {
  transferProblemMessage,
  withLeftOut,
  withTransferProgress,
} from "./contentTransfer";
import { copyItem, type CopyOutcome, type CopySkipReason } from "./copy";
import { describeContentProblem } from "./problems";
import { isContainer, resourceHrefOf, type ContentItem } from "./types";

/** Copy `item` into `target`, then report and reveal the copy. */
export async function pasteCopy(
  deps: ContentCommandDeps,
  adapter: ContentAdapter,
  item: ContentItem,
  target: ContentItem,
): Promise<void> {
  const outcome = await withTransferProgress(
    vscode.l10n.t('Copying "{0}" to "{1}"', item.name, target.name),
    (progress, signal) =>
      copyItem(adapter, item, target, signal, (path, index, total) => {
        progress.report({
          message: vscode.l10n.t(
            "{0} ({1} of {2})",
            path.join("/"),
            String(index + 1),
            String(total),
          ),
          increment: 100 / total,
        });
      }),
  );

  deps.refresh(target);
  log(deps, outcome);
  report(item, target, outcome);
  if (outcome.copyHref !== undefined && !outcome.cancelled) {
    await reveal(deps, adapter, target, outcome.copyHref);
  }
}

/** Every skip as a warning, and every failure's technical sentence. */
function log(deps: ContentCommandDeps, outcome: CopyOutcome): void {
  for (const skip of outcome.skipped) {
    deps.log.warn(
      vscode.l10n.t(
        'SAS Content: "{0}" was not copied: {1}',
        skip.path.join("/"),
        describeSkip(skip.reason),
      ),
    );
  }
  const failed = [
    ...outcome.failures,
    ...(outcome.stopped === undefined ? [] : [outcome.stopped]),
  ];
  for (const { path, failure } of failed) {
    deps.log.error(
      vscode.l10n.t(
        'SAS Content: copy of "{0}" failed: {1}',
        path.join("/"),
        describeContentProblem(failure.problem),
      ),
    );
  }
}

function report(
  item: ContentItem,
  target: ContentItem,
  outcome: CopyOutcome,
): void {
  const { name, copyHref, total, copied, failures, stopped, skipped } = outcome;
  const leftOut = skipped.length;

  if (outcome.cancelled) {
    let message: string;
    // Nothing exists yet, or a single file: there is no count worth giving.
    if (copyHref === undefined || !isContainer(item)) {
      message = vscode.l10n.t('Copy of "{0}" cancelled.', item.name);
    } else if (failures.length === 0) {
      message = vscode.l10n.t(
        'Copy of "{0}" cancelled. {1} of {2} files were copied into "{3}".',
        item.name,
        String(copied),
        String(total),
        name,
      );
    } else {
      message = vscode.l10n.t(
        'Copy of "{0}" cancelled. {1} of {2} files were copied into "{3}", and {4} could not be. See the Python on Viya log for details.',
        item.name,
        String(copied),
        String(total),
        name,
        String(failures.length),
      );
    }
    void vscode.window.showInformationMessage(withLeftOut(message, leftOut));
    return;
  }

  if (stopped !== undefined) {
    const reason = transferProblemMessage(stopped.failure.problem);
    const message =
      copyHref === undefined
        ? vscode.l10n.t('Could not copy "{0}". {1}', item.name, reason)
        : vscode.l10n.t(
            'Could not finish copying "{0}", because "{1}" could not be created. {2} What was copied before it is in "{3}".',
            item.name,
            stopped.path.join("/"),
            reason,
            name,
          );
    void vscode.window.showErrorMessage(withLeftOut(message, leftOut));
    return;
  }

  const first = failures[0];
  if (first !== undefined) {
    let message: string;
    if (!isContainer(item)) {
      message = vscode.l10n.t(
        'Could not copy "{0}". {1}',
        item.name,
        transferProblemMessage(first.failure.problem),
      );
    } else if (failures.length === 1) {
      message = vscode.l10n.t(
        'Copied {0} of {1} files into "{2}". Could not copy "{3}". {4}',
        String(copied),
        String(total),
        name,
        first.path.join("/"),
        transferProblemMessage(first.failure.problem),
      );
    } else {
      message = vscode.l10n.t(
        'Copied {0} of {1} files into "{2}". The rest could not be copied. See the Python on Viya log for details.',
        String(copied),
        String(total),
        name,
      );
    }
    void vscode.window.showErrorMessage(withLeftOut(message, leftOut));
    return;
  }

  if (!isContainer(item)) {
    // A file pasted under its own name needs no message: it is revealed,
    // the way a move is. A new name is worth saying.
    if (name !== item.name) {
      void vscode.window.showInformationMessage(
        vscode.l10n.t(
          'Pasted as "{0}", because "{1}" already has an item named "{2}".',
          name,
          target.name,
          item.name,
        ),
      );
    }
    return;
  }
  const summary =
    copied === 0 && leftOut === 0
      ? name === item.name
        ? vscode.l10n.t(
            'Copied "{0}" to "{1}". It has no files, so only its folders were created.',
            item.name,
            target.name,
          )
        : vscode.l10n.t(
            'Copied "{0}" to "{1}" as "{2}". It has no files, so only its folders were created.',
            item.name,
            target.name,
            name,
          )
      : copied === 1
        ? vscode.l10n.t('Copied 1 file into "{0}".', name)
        : vscode.l10n.t('Copied {0} files into "{1}".', String(copied), name);
  void vscode.window.showInformationMessage(withLeftOut(summary, leftOut));
}

/**
 * Show and select the copy. It is found in a fresh listing of `target` by
 * its resource address, since the copy call returns the file or folder
 * resource rather than the member record the tree draws. Best-effort, with
 * its own short bound: if the listing fails or the copy is not in it,
 * nothing is revealed.
 */
async function reveal(
  deps: ContentCommandDeps,
  adapter: ContentAdapter,
  target: ContentItem,
  copyHref: string,
): Promise<void> {
  const listing = await adapter.getChildItems(
    target,
    AbortSignal.timeout(REVEAL_RELIST_TIMEOUT_MS),
  );
  if (!listing.ok) return;
  const node = listing.value.find(
    (sibling) => resourceHrefOf(sibling) === copyHref,
  );
  if (node !== undefined) await deps.reveal(node);
}

/** The bound on {@link reveal}'s listing — the same as the one after a
 * create in `contentCommands.ts`, for the same reason: nothing the user can
 * cancel is waiting on it. */
const REVEAL_RELIST_TIMEOUT_MS = 8_000;

function describeSkip(reason: CopySkipReason): string {
  switch (reason) {
    case "not-a-file":
      return vscode.l10n.t("it is not a file");
    case "already-listed":
      return vscode.l10n.t(
        "it is the same folder as one already copied elsewhere in the tree",
      );
  }
}
