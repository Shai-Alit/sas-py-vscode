// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Drag-and-drop move for the SAS Content tree — this repository's first
 * `TreeDragAndDropController`. 6c-ii.
 *
 * A thin `vscode` shell, the same shape as `src/content/contentCommands.ts`:
 * every real decision is elsewhere and unit-tested — whether a drop is a valid
 * move is `src/content/contentMove.ts`, the `PUT` body and its wire shape are
 * `src/content/adapter.ts` (`moveItem`, finding 6.10). This file wires the
 * controller onto the view, filters the drag to the items the tree lets you
 * pick up (`NodePresentation.draggable`), and runs the moves behind a
 * cancellable progress spinner.
 *
 * ## One private MIME, within this tree only
 *
 * `dragMimeTypes` / `dropMimeTypes` are a single custom type, so a drag only
 * means something when it starts and ends inside this view. Upstream's
 * controller also accepts `text/uri-list` to import files from disk; that is
 * the Phase 11 upload deferral here, so this controller ignores every MIME but
 * its own.
 *
 * ## Refresh is a full reload
 *
 * A move changes two folders — the source and the destination — so a full
 * `onDidChangeTreeData` is fired rather than two targeted ones. The moved
 * member keeps its `id` across the move (finding 6.10), so VS Code still keeps
 * the rest of the user's expansion state. Upstream refreshes the whole tree
 * here too. After the reload the first item moved is revealed (6c-iii): its id
 * is stable, so `TreeView.reveal` places it under its new parent, expanding the
 * destination if it was collapsed.
 *
 * ## Every early return is logged (added 2026-09-11, ADR-0031)
 *
 * `handleDrag`/`handleDrop` are called by VS Code, not this project's own
 * code, so a silent early return here previously left no trail at all —
 * exactly the gap that made the Phase 6→7/8 housekeeping checkpoint's live
 * drag-and-drop investigation slow: real drops were being rejected with no
 * way to see why. Each guard now logs at `debug` what it decided and why,
 * matching this project's own "failures are diagnosable" standard elsewhere.
 * These are genuine per-attempt traces, not incidental debugging left behind
 * — keep them.
 */

import * as vscode from "vscode";

import { type ContentAdapter } from "./adapter";
import { moveObjection } from "./contentMove";
import { localiseContentProblem } from "./messages";
import { nodePresentationOf } from "./presentation";
import { describeContentProblem } from "./problems";
import { resourceHrefOf, type ContentItem } from "./types";

/**
 * The drag payload — private to this view, so a drop only lands from a drag
 * that started here.
 *
 * A same-tree drop is documented as working with any custom mime type here
 * (`@types/vscode`'s `DataTransferItem.value` docs), and a throwaway test
 * extension confirmed it in practice, so this was briefly swapped to VS
 * Code's own "recommended" `application/vnd.code.tree.<treeidlowercase>`
 * format during the Phase 6->7/8 housekeeping investigation (2026-09-11) on
 * the theory that it mattered for a tree this shape — it did not change
 * anything, live-tested, so it was reverted here. The actual cause was a
 * missing `resourceUri` on folder tree items (ADR-0031), unrelated to this
 * constant.
 */
const CONTENT_MIME = "application/vnd.pythononviya.sascontent";

/** What the controller needs from its surroundings — supplied by
 * `src/content/contentExplorer.ts`, matching `ContentCommandDeps`. */
export interface ContentDragAndDropDeps {
  /** The adapter for the active deployment, or `undefined` when signed out. */
  adapter: () => ContentAdapter | undefined;
  /** Reload the tree after a move (or an attempt that failed partway). */
  refresh: () => void;
  /** Show and select a node after a move (6c-iii). Best-effort — resolves
   * whether or not `TreeView.reveal` could place it. */
  reveal: (item: ContentItem) => Thenable<void>;
  /** The shared channel; the technical sentence for every failure goes here. */
  log: vscode.LogOutputChannel;
  /** The tree view id, for the progress spinner's location. */
  viewId: string;
}

export class SasContentDragAndDropController implements vscode.TreeDragAndDropController<ContentItem> {
  readonly dragMimeTypes = [CONTENT_MIME];
  readonly dropMimeTypes = [CONTENT_MIME];

  constructor(private readonly deps: ContentDragAndDropDeps) {}

  handleDrag(
    source: readonly ContentItem[],
    dataTransfer: vscode.DataTransfer,
  ): void {
    const draggable = source.filter(
      (item) => nodePresentationOf(item).draggable,
    );
    this.deps.log.debug(
      vscode.l10n.t(
        "SAS Content: handleDrag — {0} of {1} source item(s) draggable",
        draggable.length,
        source.length,
      ),
    );
    if (draggable.length === 0) return;
    dataTransfer.set(CONTENT_MIME, new vscode.DataTransferItem(draggable));
  }

  async handleDrop(
    target: ContentItem | undefined,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken,
  ): Promise<void> {
    // A drop on empty space has no target folder, and there is no synthetic
    // "everything" folder to move into — nothing to do.
    if (target === undefined) {
      this.deps.log.debug(
        vscode.l10n.t("SAS Content: handleDrop — no target, ignored"),
      );
      return;
    }

    const adapter = this.deps.adapter();
    if (adapter === undefined) {
      this.deps.log.debug(
        vscode.l10n.t("SAS Content: handleDrop — no active adapter, ignored"),
      );
      return;
    }

    // `DataTransferItem.value` is `any`. This is not a wire boundary — the
    // payload only ever comes from this controller's own `handleDrag` under a
    // private MIME within one window, and those items already passed through
    // `readContentItem` when the tree built them (and carry the synthetic
    // `inRecycleBin` flag, which `readContentItem` would strip). So the guard
    // is a shallow one: confirm it is a non-empty array so a malformed payload
    // drops the drop rather than throwing into VS Code's DnD host; the elements
    // are not re-validated per item.
    const payload: unknown = dataTransfer.get(CONTENT_MIME)?.value;
    if (!Array.isArray(payload) || payload.length === 0) {
      this.deps.log.debug(
        vscode.l10n.t(
          "SAS Content: handleDrop — no {0} payload on the data transfer, ignored",
          CONTENT_MIME,
        ),
      );
      return;
    }
    const dragged = payload as ContentItem[];

    const destination = resourceHrefOf(target);
    if (destination === undefined) {
      this.deps.log.debug(
        vscode.l10n.t(
          'SAS Content: handleDrop — target "{0}" has no resolvable resource href, ignored',
          target.name,
        ),
      );
      return;
    }

    // Keep only the drops that are moves on their face; the server rejects the
    // one case this cannot see (a folder into its own descendant — finding
    // 6.10).
    const movable = dragged.filter(
      (item) => moveObjection(item, target) === undefined,
    );
    const [firstItem] = movable;
    if (firstItem === undefined) {
      // Names the objection for every dragged item, so a real-world rejection
      // reason (e.g. every item read as "not-a-member") is visible instead of
      // a silent no-op.
      const reasons = dragged
        .map((item) => `${item.name}: ${String(moveObjection(item, target))}`)
        .join("; ");
      this.deps.log.debug(
        vscode.l10n.t(
          'SAS Content: handleDrop — nothing movable onto "{0}" ({1})',
          target.name,
          reasons,
        ),
      );
      return;
    }

    const { problems, firstMoved } = await vscode.window.withProgress(
      {
        location: { viewId: this.deps.viewId },
        title:
          movable.length === 1
            ? vscode.l10n.t('Moving "{0}"…', firstItem.name)
            : vscode.l10n.t("Moving {0} items…", movable.length),
        cancellable: true,
      },
      async (_progress, progressToken) => {
        const controller = new AbortController();
        const cancelled = () =>
          token.isCancellationRequested ||
          progressToken.isCancellationRequested;
        const subs = [
          token.onCancellationRequested(() => {
            controller.abort();
          }),
          progressToken.onCancellationRequested(() => {
            controller.abort();
          }),
        ];
        const problems: string[] = [];
        let firstMoved: ContentItem | undefined;
        try {
          for (const item of movable) {
            if (cancelled()) break;
            const result = await adapter.moveItem(
              item,
              destination,
              controller.signal,
            );
            if (result.ok) {
              firstMoved ??= result.value;
              continue;
            }
            // A failure whose cause is that cancel stays silent — the user
            // asked to stop. Every other failure is logged and collected.
            if (cancelled()) break;
            this.deps.log.error(
              vscode.l10n.t(
                "SAS Content: {0}",
                describeContentProblem(result.problem),
              ),
            );
            problems.push(localiseContentProblem(result.problem));
          }
        } finally {
          for (const sub of subs) sub.dispose();
        }
        return { problems, firstMoved };
      },
    );

    // A multi-item move that failed partway has still changed the server, so
    // reload whatever the outcome.
    this.deps.refresh();
    if (firstMoved !== undefined) await this.deps.reveal(firstMoved);
    if (problems.length > 0) {
      void vscode.window.showErrorMessage(problems[0] ?? "");
    }
  }
}
