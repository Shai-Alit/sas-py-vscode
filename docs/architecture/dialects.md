# The dialect layer

This extension supports SAS Viya 3.5 and Viya 4. Everywhere those two differ,
the difference lives in `src/dialects/` — and nowhere else. ESLint enforces that
with a `no-restricted-syntax` rule that bans version comparisons throughout
`src/`, exempting only this directory.

The rule exists because version checks are individually reasonable and
collectively unmaintainable. Each one is a two-line change that looks obviously
correct in review; a year later there are forty of them, no two spelled the same
way, and no way to answer "what does this extension actually do differently on
3.5?" other than by reading everything.

## What a dialect is

```ts path=src/dialects/sample.ts
import type { Deployment, DialectId } from "./dialect";

export interface Dialect {
  readonly id: DialectId; // "viya4" | "viya35"
  readonly deployment: Deployment;
  readonly contract: DialectId;
  hasBuiltInClient(): boolean | undefined;
  describe(): string;
}
```

Deliberately thin. `viya4.ts` and `viya35.ts` are a few lines each, and neither
overrides anything yet.

That is the point rather than an embarrassment. **A dialect gains a method when a
probe or a known defect proves the two generations differ, and not before.** The
tempting alternative — populating the interface with every path, media type and
capability that *might* vary — produces a table of guesses that reads like
evidence. Nothing in this project has ever been run against Viya 3.5, and an
empty seat says that more honestly than a filled-in one would.

The seats are worth having empty because they are where the difference goes when
one is found: adding it becomes a change to one file with a comment saying which
probe found it, rather than a decision about where such a thing belongs.

## Choosing one, and saying why

`resolveDialect()` in `src/dialects/resolve.ts` returns the dialect, a **reason**,
and whether the generation was actually determined:

```ts path=src/dialects/sample.ts
import type { Dialect } from "./dialect";

export interface DialectResolution {
  readonly dialect: Dialect;
  readonly reason: string;
  readonly certain: boolean;
}
```

The reason is not decoration. Choosing the wrong dialect does not fail — it
presents as a dozen unrelated bugs somewhere else, days later. A sentence in the
output channel saying which deployment version was detected and how is the
difference between a five-minute diagnosis and a five-hour one.

Resolution is deliberately **fail-soft**: when the generation cannot be
determined, the Viya 4 dialect is chosen, `certain` is `false`, and the reason
says it was assumed. An inconclusive probe must not stand between a user and a
deployment that is very probably Viya 4. Callers that must not act on a guess —
a contract check, a bug report — read `certain`; callers that just need to talk
to the deployment ignore it and get the sane default.

## Three answers, not two

Stage-1 probing reads `/deploymentData/cadenceVersion`, and what it finds is a
three-way signal rather than a string that might be missing.
[Capability probing](capability-probing.md) covers how that question is asked and
when; this section is about what the answer is turned into.

```ts
export type CadenceSignal =
  | { kind: "cadence"; version: string; display?: string | undefined }
  | { kind: "absent" }
  | { kind: "unreadable"; detail: string };
```

"The deployment answered, and it has no cadence version" means Viya 3.5 — the
endpoint is a Viya 4 addition, so its considered absence is itself the version
signal. "We could not ask" means we know nothing.

Collapsing those two into one absent value is how a network problem turns into a
confident, wrong claim of Viya 3.5 — which would then be used to tell the user
their deployment has no built-in OAuth client, a specific and wrong instruction.
The union is what keeps the two apart, and `deploymentFromSignal()` maps the
third to `unknown`.

An earlier version of this page said the third arm was there because the
signed-in user might lack permission to read the endpoint. Probe finding 41
measured that and it is not so: the cadence resource answered `200` with no
`Authorization` header at all. The union still earns its keep, but for finding
42's reason instead — a request that never reaches Viya is answered by whatever
*is* in the path, and an ingress answering for a service that is not there
returns a bodyless `404` carrying no media type and no message. Read as "the
endpoint is not there", a proxy, a VPN portal or a mistyped host would be naming
the generation on the deployment's behalf.

`display` is `cadenceDisplayName` — "Long-Term Support 2026.03", the release and
the support track in one string, which is what belongs in the output channel.
`deploymentFromSignal()` drops it deliberately: a support track is not something
to branch on, and putting it on `Deployment` would invite exactly that.

The `unknown` case produces the Viya 4 dialect **bound to an unknown
deployment**, which is intentional rather than an inconsistency to be tidied
away. It says the two true things at once: we will speak Viya 4 to this
deployment, and we do not know what it is. Anything downstream that turns on the
version — `hasBuiltInClient` most of all — then keeps answering "unknown"
instead of inheriting a confidence nobody earned.

## Writing a generation down

`resolveDialectId()` is the one table that turns written text into a dialect id.
A profile setting somebody typed, the `generation` field of a contract file, a
fixture directory name and a probe's answer all name a generation in text, and
none of them agree on spelling. `Viya 4`, `viya-4` and `VIYA_4` normalise to the
same thing; a cadence release like `2025.04` is recognised by an anchored
pattern, because a substring match would accept any string with a date in it and
quietly call it Viya 4.

An unrecognised string resolves to `undefined` rather than a guess. Guessing
there would put the guess in the one place that has nowhere to log a reason for
it.

The contract file is the exception that proves the rule: it is written here,
under review, so [the checker](contracts.md#what-the-check-actually-asserts)
requires the exact id rather than merely something that resolves.
