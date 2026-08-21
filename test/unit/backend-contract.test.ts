// Copyright © 2026, Sean Ford and the Python on Viya contributors
// SPDX-License-Identifier: Apache-2.0

/**
 * Runs the ADR-0015 contract suite against {@link createFakeBackend}.
 *
 * The suite itself lives in `test/helpers/backend-contract-suite.ts`, exported
 * over a factory rather than fixed to one double, so slice 3a's `PROC PYTHON`
 * backend can register its own double against the same twenty-three cases
 * without copying them. This file is what that registration looks like for
 * the double that exists today.
 */

import { createFakeBackend } from "../helpers/fake-backend";
import { describeExecutionBackendContract } from "../helpers/backend-contract-suite";

describeExecutionBackendContract(createFakeBackend);
