// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Drag-and-drop move for the SAS Server view (13p-ii), upstream's only way to
 * move a file there.
 *
 * A thin `vscode` shell, the same shape as
 * `src/content/contentDragAndDrop.ts`. Whether a drop is a move is
 * `src/server/move.ts`'s {@link serverMoveObjection}; the `PUT` is
 * `ServerAdapter.move`. Both are unit-tested.
 *
 * A drag carries one private MIME, so a drop only means something inside this
 * view. The root is left out of it: VS Code cannot stop one item starting a
 * drag, so a drag of the root alone carries nothing. Items listed under a
 * profile other than the target's are left out: their links name another
 * session. So is an item whose folder is dragged with it: moving the folder
 * already moves it, and its own links would be stale by then. Every early
 * return is logged at `debug`, as the SAS Content controller's are, since VS
 * Code calls these methods and a silent return leaves no trail.
 *
 * Cancel comes from the progress notification only. The `token` VS Code
 * passes to `handleDrop` can arrive without its `onCancellationRequested`
 * method (Finding 6.16), so it is not subscribed to.
 */

import * as vscode from "vscode";

import { type ServerAdapter } from "./adapter";
import { localiseServerProblem } from "./messages";
import { serverMoveObjection } from "./move";
import { isWithinServerPath } from "./path";
import { describeServerProblem, type ServerProblem } from "./problems";
import {
  isServerTreeItem,
  type ServerTreeItem,
  type ServerTreeNode,
} from "./serverTree";

const SERVER_MIME = "application/vnd.pythononviya.sasserver";

/** What the controller needs from `serverExplorer.ts`. */
export interface ServerDragAndDropDeps {
  currentAdapter(): ServerAdapter | undefined;
  refresh(): void;
  forgetProfile(profileId: string): void;
  log: vscode.LogOutputChannel;
  viewId: string;
}

export class SasServerDragAndDropController implements vscode.TreeDragAndDropController<ServerTreeNode> {
  readonly dragMimeTypes = [SERVER_MIME];
  readonly dropMimeTypes = [SERVER_MIME];

  constructor(private readonly deps: ServerDragAndDropDeps) {}

  handleDrag(
    source: readonly ServerTreeNode[],
    dataTransfer: vscode.DataTransfer,
  ): void {
    const draggable = source.filter(
      (node): node is ServerTreeItem =>
        isServerTreeItem(node) && node.rootLabel === undefined,
    );
    this.deps.log.debug(
      vscode.l10n.t(
        "SAS Server: handleDrag — {0} of {1} source item(s) draggable",
        draggable.length,
        source.length,
      ),
    );
    if (draggable.length === 0) return;
    dataTransfer.set(SERVER_MIME, new vscode.DataTransferItem(draggable));
  }

  async handleDrop(
    target: ServerTreeNode | undefined,
    dataTransfer: vscode.DataTransfer,
  ): Promise<void> {
    if (target === undefined || !isServerTreeItem(target)) {
      this.deps.log.debug(
        vscode.l10n.t("SAS Server: handleDrop — no target, ignored"),
      );
      return;
    }
    const adapter = this.deps.currentAdapter();
    if (adapter?.profileId !== target.profileId) {
      this.deps.log.debug(
        vscode.l10n.t(
          "SAS Server: handleDrop — the target is not from the active profile's session, ignored",
        ),
      );
      return;
    }

    // Not a wire boundary: the payload only comes from `handleDrag` above,
    // under a private MIME. A shallow check keeps a malformed one from
    // throwing into VS Code's drag-and-drop host.
    const payload: unknown = dataTransfer.get(SERVER_MIME)?.value;
    if (!Array.isArray(payload) || payload.length === 0) {
      this.deps.log.debug(
        vscode.l10n.t(
          "SAS Server: handleDrop — no {0} payload on the data transfer, ignored",
          SERVER_MIME,
        ),
      );
      return;
    }
    const dragged = (payload as unknown[]).filter(isServerTreeItem);
    const outermost = dragged.filter(
      (node) =>
        !dragged.some(
          (other) =>
            other !== node &&
            other.profileId === node.profileId &&
            other.item.path !== node.item.path &&
            isWithinServerPath(node.item.path, other.item.path),
        ),
    );
    const movable = outermost.filter(
      (node) =>
        node.profileId === target.profileId &&
        serverMoveObjection(node.item, target.item) === undefined,
    );
    const [first] = movable;
    if (first === undefined) {
      const reasons = dragged
        .map(
          (node) =>
            `${node.item.name}: ${
              node.profileId === target.profileId
                ? String(serverMoveObjection(node.item, target.item))
                : "another profile"
            }`,
        )
        .join("; ");
      this.deps.log.debug(
        vscode.l10n.t(
          'SAS Server: handleDrop — nothing movable onto "{0}" ({1})',
          target.item.path,
          reasons,
        ),
      );
      return;
    }

    const problems = await vscode.window.withProgress(
      {
        location: { viewId: this.deps.viewId },
        title:
          movable.length === 1
            ? vscode.l10n.t('Moving "{0}"…', first.item.name)
            : vscode.l10n.t("Moving {0} items…", movable.length),
        cancellable: true,
      },
      async (_progress, token) => {
        const controller = new AbortController();
        const sub = token.onCancellationRequested(() => {
          controller.abort();
        });
        const found: ServerProblem[] = [];
        try {
          for (const node of movable) {
            if (aborted(controller.signal)) break;
            const result = await adapter.move(node.item, target.item, {
              signal: controller.signal,
            });
            if (result.ok) continue;
            // A failure the user's Cancel caused stays silent.
            if (aborted(controller.signal)) break;
            found.push(result.problem);
          }
        } finally {
          sub.dispose();
        }
        return found;
      },
    );

    // A batch that failed partway has still moved what came before it. Every
    // failure is logged; the first is shown.
    this.deps.refresh();
    const [problem] = problems;
    if (problem === undefined) return;
    for (const each of problems) {
      this.deps.log.error(
        vscode.l10n.t("SAS Server: {0}", describeServerProblem(each)),
      );
    }
    if (
      problems.some(
        (each) =>
          each.code === "compute" && each.problem.code === "session-gone",
      )
    ) {
      this.deps.forgetProfile(adapter.profileId);
    }
    void vscode.window.showErrorMessage(localiseServerProblem(problem));
  }
}

/** `signal.aborted`, read through a call so the compiler does not carry a
 * narrowing from one check across the `await` that can change it. */
function aborted(signal: AbortSignal): boolean {
  return signal.aborted;
}
