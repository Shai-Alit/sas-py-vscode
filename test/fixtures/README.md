# Fixtures

Recorded SAS Viya responses, used to drive the mock HTTP layer. Everything the
unit tier knows about Viya, it learned from a file in here.

```
viya4/     captured from a live Viya 4 deployment
viya35/    captured from a live Viya 3.5 deployment
harness/   synthetic; proves the plumbing, imitates nothing
```

The split by generation is the point. Happy paths run once per generation, so a
change that quietly works only on Viya 4 fails the 3.5 suite instead of shipping
and being discovered by a customer.

## Capture, then sanitise

Capture with the probe workflow described in `CONTRIBUTING.md` — a read-only
request against a real deployment — and save the response body verbatim before
touching it. Then, before the file goes anywhere near a commit, replace:

- **the bearer token** — delete it; it must never reach the file at all
- **hostnames and URLs**, including every `links[].href` — use `viya.example.com`
- **user names** — `createdBy`, `modifiedBy`, `owner`, and anything in a display
  string
- **organisation-identifying ids and names** — context names, library names, and
  folder paths that say where you work
- **absolute filesystem paths** that reveal a deployment layout

Replace with synthetic values that are *structurally faithful*: same type, same
length class, same character set, same null-versus-absent pattern. A UUID becomes
a different UUID, not `"REDACTED"`. The fidelity is the entire value of the
fixture — a sanitised payload that no longer parses like the original tests
nothing.

Keep everything else exactly as the server sent it, including field order, empty
arrays, `null`s, and fields the client does not read. The next person to add a
feature reads this file to find out what is available.

## Rules

**Never hand-write a fixture in `viya4/` or `viya35/`.** Those directories are
evidence. A payload invented from documentation looks identical to a recorded one
and is worth much less, and there is no way to tell them apart six months later.
If you need a shape to test against and cannot capture it, put it in `harness/`
and say in the file what it is.

**`viya4/` and `viya35/` are exempt from Prettier**, so that a captured payload
can be committed exactly as it arrived rather than reflowed on the way in. It is
a formatter, so it cannot change what a fixture means — but a fixture that no
longer matches the output it was captured from is harder to re-verify against the
deployment, and the whole point of these files is that they are evidence.
`harness/` is hand-written and is formatted like the source it is.

**Record where it came from.** A fixture that changes behaviour belongs with a
`PROBE-FINDINGS.md` entry describing the endpoint, the date, and the deployment
generation. Superseded findings are struck through, never deleted.

**Fixtures are read from this directory, not copied into `out/`.** Use
`readJsonFixture` from `test/helpers/fixtures.ts`; there is no build step to
forget, and no stale copy to go green against.
