// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * The aggregate view of a run, built from the streaming one.
 *
 * **This module must never import `vscode`.**
 *
 * ADR-0015 makes streaming the primitive: {@link ExecutionHandle} yields output
 * as it arrives and settles once. Most of the extension wants that — the notebook
 * controller, the output view, the log. Run File does not: it wants the whole
 * thing at the end, which is the `ExecutionResult` shape `PRODUCTION_PLAN.md`
 * §2.2 originally sketched as the seam's return type.
 *
 * This function is what makes the second cheap enough that the seam did not have
 * to be shaped around it. It is also the working proof that the aggregate is
 * derivable from the stream — the claim ADR-0015 rests the decision on.
 */

import type { ExecutionHandle, ExecutionResult, RichOutput } from "./backend";
import { type BackendResult, fail } from "./problems";

/**
 * Drains a handle and returns the finished run.
 *
 * Iterates {@link ExecutionHandle.outputs} to completion, then awaits
 * {@link ExecutionHandle.done}. A failed run is returned as the failure — there
 * is no outcome to aggregate — and a run that raised is *not* a failure: it comes
 * back `ok` with `succeeded: false` and its traceback among the outputs.
 *
 * Total by construction: it does not throw, on any path, for any handle.
 */
export async function collect(
  handle: ExecutionHandle,
): Promise<BackendResult<ExecutionResult>> {
  const outputs: RichOutput[] = [];
  try {
    for await (const output of handle.outputs) {
      outputs.push(output);
    }
  } catch (error) {
    // `done` is contracted never to reject. If an implementation breaks that
    // contract, the promise we are about to abandon becomes an unhandled
    // rejection — which in the extension host is a good deal louder than the
    // failure we already have a better description of. Attaching an ignoring
    // handler defuses that; it is not a swallowed error, because the error that
    // matters is the one being returned on the next line.
    void handle.done.then(undefined, () => undefined);
    return fail(
      {
        code: "backend-failed",
        detail: error instanceof Error ? error.message : "unknown error",
      },
      `collecting output from run ${handle.id}`,
    );
  }

  const settled = await handle.done;
  if (!settled.ok) return settled;

  return {
    ok: true,
    value: {
      succeeded: settled.value.succeeded,
      diagnostics: settled.value.diagnostics,
      outputs,
    },
  };
}
