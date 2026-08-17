# Capability probing

Before the extension can talk to a deployment it has to know what kind of
deployment it is. `PRODUCTION_PLAN.md` §2.3 splits that question in two, and the
split is by **what has to have happened first**:

- **Stage 1 — HTTP-derived.** Which generation is this? Answered with two GETs,
  before any code has been submitted anywhere. Shipped in slice 2b-ii; this page
  is mostly about it.
- **Stage 2 — runtime-derived.** What does the Python environment inside the
  session actually have — the interpreter version, which packages are importable,
  whether SWAT is there? Answered by running code, so it cannot happen until
  there is a backend to run it. Slice 3e.

Everything below is stage 1. `BackendCapabilities` reports `unprobed` for the
stage-2 facts until then, which is a deliberate placeholder rather than a default.

## The question, and the two requests that ask it

Stage 1 reads the deployment's **cadence version** — `2026.03`, and a display
name of `Long-Term Support 2026.03` beside it. Viya 4 releases are dated; Viya 3.5
releases are named and there is no cadence resource at all. So the answer to "is
this Viya 4?" is the presence of that endpoint, and the answer to "is this 3.5?"
is its considered absence.

`src/dialects/probe.ts` asks in two requests rather than one:

1. `GET /deploymentData`, which returns a link document.
2. `GET` whatever the `cadenceVersion` relation in that document points at.

That is one more round trip than composing `/deploymentData/cadenceVersion`
directly, which is what upstream's `getViyaCadence` does (finding 45). The extra
request is the point:
[ADR-0010](../adr/0010-compute-client-is-hand-written.md) names "the presence or
absence of a link relation" as how a version difference should be expressed, and a
composed path cannot tell a missing feature from a moved one. `/deploymentData`
is the single composed path, and it is composed because there is nothing above it
to navigate from.

Selecting the relation takes both `rel` **and** media type. Finding 44 records
that `cadenceVersion` appears twice in that document, differing only in `type`.
Both hrefs are identical today, so a `rel`-only lookup works by luck, and luck is
a poor thing for a version probe to stand on.

## Where it runs, and why that is the whole design

Probing happens in `ComputeSessionManager.hold()` — **after a session exists**,
never before. Both of `open`'s success paths pass through it, the freshly created
one and the reattached one alike, and it sits inside the connect progress
notification so the probe is covered by the same Cancel.

The ordering is not tidiness. It is the precondition the probe documents and
deliberately does not check for itself, and it comes from probe finding 42:

> A routed Viya service answers a bad path with `404` and a
> `vnd.sas.error+json` body. An **unrouted** path never reaches Viya at all — the
> ingress answers it with a bodyless `404` carrying no content type and no
> message.

A proxy, a VPN sign-in portal or a mistyped host produces something in that same
family. So a `404` on its own can never mean "this deployment is Viya 3.5"; read
that way, anything in the network path could name the generation on the
deployment's behalf, and the user would then be told their deployment has no
built-in OAuth client — a specific, wrong instruction.

A live compute session is the evidence that closes the gap. It proves the host is
a reachable Viya that this token works against, so once one exists, a Viya-shaped
404 is a statement about the endpoint rather than about the network.

Worth knowing: the cadence resource itself is **unauthenticated** (finding 41). An
earlier version of the design assumed permissions were the reason an answer might
be unreadable; measurement said otherwise, and the design survived for finding
42's reason instead.

## Three answers, not two

What the probe returns is a union, not a string that might be missing:

```ts
export type CadenceSignal =
  | { kind: "cadence"; version: string; display?: string | undefined }
  | { kind: "absent" }
  | { kind: "unreadable"; detail: string };
```

"The deployment answered, and has no cadence version" means 3.5. "We could not
ask" means we know nothing. Collapsing those two is how a network problem becomes
a confident, wrong claim — see
[the dialect layer](dialects.md#three-answers-not-two) for what the resolver then
does with each, and why the `unknown` case produces the Viya 4 dialect bound to an
unknown deployment.

## Fail-soft, and saying so out loud

Resolution never fails. An inconclusive probe picks Viya 4, marks itself
uncertain, and says it assumed. An unresolvable deployment must not stand between
a user and a deployment that is very probably Viya 4.

What makes that honest rather than merely convenient is the line in the output
channel, and its **level is the certainty**:

```
[info]    SAS Viya version: the deployment reports Viya 4 2026.03
          (Long-Term Support 2026.03).
[warning] SAS Viya version: the deployment version could not be determined, so
          the Viya 4 dialect was assumed (/deploymentData answered HTTP 404, but
          not with a link document).
```

Everything the extension does after an assumed resolution is done on an
assumption, so a bug report that opens with a warning here is a bug report that
has already named its most likely cause. The parenthetical carries what the
resolver's own reason throws away: for an unreadable answer, the detail that
separates a proxy in the way from a deployment that really has no such endpoint;
for a good answer, the support-track display name. Neither is localised, on
purpose — both halves are strings the deployment or the resolver produced, and a
translated frame around an untranslated diagnostic reads worse than an
untranslated pair.

A probe cancelled halfway is logged as an assumption like any one. Elsewhere the
connect path refuses to blame a user who pressed Cancel, and that rule
deliberately does not reach here: it applies to a connect that *failed*, whereas a
cancellation landing after the session settled leaves a connection the user is
about to use, and the honest thing to say about it is that the version was not
determined.

## Asked once per deployment

The resolution is cached on the session manager, keyed by profile id, and the
cache **outlives the connection**. Reconnecting after an idle reap does not make a
deployment a different generation, and re-probing every connect would be two round
trips to re-learn a fact that changes about once a quarter.

Two details in that cache are load-bearing:

**The endpoint is stored alongside the id.** A profile is a settings entry people
edit in place; repoint one at a different deployment, keep its id, and a cache
keyed on the id alone answers for the deployment it used to name.

**Only certain resolutions are recorded.** `certain: false` is not a finding about
the deployment — it is a report about one attempt to ask. Caching it would let a
cancelled connect or a momentary proxy decide how this window talks to a
deployment until the window is reloaded, which is exactly the silent-and-wrong
outcome the three-way union exists to avoid. The cost is one extra pair of
requests per connect against a deployment that keeps refusing to answer, which is
the right way round.

Nothing clears the cache deliberately. A deployment upgraded from one cadence to
the next while the window is open reports the old release until the window is
reloaded. That is a fair price for not re-probing: the release picks behaviour, it
is not a version display for the user.

## What this does not settle

**No Viya 3.5 has ever answered any of this.** The `absent` arm is reached in
tests and was simulated against a Viya 4 — a missing sibling path, and an unrouted
service — and findings 40–45 record why that is not the same as having seen one.
If a real 3.5 answers `/deploymentData` the way an unrouted path does, the probe
reports `unreadable`, Viya 4 is assumed, and the log says so.

**There is no way for a user to assert the generation by hand.** No profile
setting overrides the probe. That is a gap rather than a decision, and the first
real 3.5 deployment is what should settle whether it needs closing.

**Timing is measured, not budgeted.** The cadence pair took 0.25–0.29 s against a
live Viya 4 (finding 40), and the probe carries a ten-second timeout of its own on
top of the connect's cancellation signal.
