// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * ADR-0015's contract, run a second time — against the real `PROC PYTHON`
 * backend rather than `fake-backend.ts`'s specification double.
 *
 * `backend-contract-suite.ts`'s own header says this file is what proves its
 * refactor: the suite was written once, against a factory, so that the day
 * slice 3a's real backend arrived it would not need to be rewritten for it.
 * `recorded-proc-python.ts` is that factory — see its own doc comment for how
 * a real `ProcPythonBackend` is driven over a simulated wire, and for the two
 * clauses it cannot produce from the real thing.
 */

import { describeExecutionBackendContract } from "../helpers/backend-contract-suite";
import { createRecordedProcPythonBackend } from "../helpers/recorded-proc-python";

describeExecutionBackendContract(createRecordedProcPythonBackend);
