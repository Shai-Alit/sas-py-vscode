# Connecting to Viya

Signing in proves who you are. Connecting gets you somewhere to run: a **compute
session** on your deployment, which is a SAS process holding a Python
interpreter, started for you and kept alive between commands.

Run **Python on Viya: Connect to SAS Viya** from the Command Palette. If you are
not signed in yet you will be, so this is the only command you need from a cold
start. A progress notification appears while the session opens, and an
information message names the profile you are connected to when it is ready.

Nothing runs Python yet. This slice ships the connection the run command will
use, and the reason it ships on its own is that almost everything that can go
wrong between an editor and a deployment goes wrong here rather than later.

## Why the session is worth keeping

The interpreter has state — your imports, your variables, the DataFrame you spent
four minutes building. That state lives in the session, so it survives from one
run to the next in the same way a notebook kernel does, and it dies with the
session.

That is the whole reason connecting is a separate step with its own command
rather than something the run command does silently: a session you cannot see is
a session you cannot deliberately keep, and the state in it is the expensive
part.

## One session per folder, per profile

The session is remembered against the **workspace** you are in and the
**profile** you are connected with. Two consequences follow, and both are
deliberate.

**Reloading the window reconnects rather than restarts.** Reload, or close the
folder and reopen it later the same day, and the extension reattaches to the
session it opened before — same interpreter, same variables. Your Python state is
not a casualty of an extension update.

**Two windows on the same folder share one session.** They are the same
workspace, so they get the same interpreter, and a variable set in one is visible
in the other. If you want two independent namespaces, open two different folders.

Two *profiles*, on the other hand, are always separate: a test deployment and a
production one can hold a session each at the same time, and connecting to one
does not disturb the other. Connecting names the account for the deployment the
active profile points at, so switching profile and connecting again signs you in
to the right place — or, if you have never signed in to that deployment, takes
you straight to its sign-in rather than offering you the account you already have
for a different one.

The remembered session id is treated as a hint rather than a fact. The extension
tries it, and if the session has ended in the meantime it opens a new one and
carries on without asking you anything — after a reload the answer would always
be yes, and a prompt whose answer is always yes is a click, not a question.

## Sessions end on their own

An idle compute session is reaped by the deployment after **fifteen minutes**.
That is Viya's setting, not the extension's, and your administrator may have
changed it.

When that happens, your Python state is gone: the next connect opens a fresh
interpreter with nothing in it. There is no warning beforehand, and there is
nothing the extension can do to prevent it that would not amount to holding a SAS
process on your deployment all day for the sake of a variable.

**Python on Viya: Disconnect from SAS Viya** ends the session immediately. Worth
running when you are finished for the day rather than leaving it to time out,
because a session that is up is a licensed process on your deployment whether or
not anyone is using it.

Closing the editor does **not** end the session, on purpose. Reconnecting after a
reload and reaping on exit are contradictory, and the fifteen-minute timeout
already covers the case you actually meant.

## Compute contexts

A compute session is started from a **compute context**, which is your
administrator's template for what a SAS process gets: which server, which
options, what is on the path. Set `context` on the profile if you know which one
you want.

If you have not set one, the first connect lists the contexts your deployment
offers and asks. Your answer is written back to the profile **once a session has
actually started on it**, so the question is asked once rather than at every
connect — check `settings.json` afterwards if you want to see what it chose.
Dismissing the picker cancels the connect and changes nothing, and so does
picking a context that turns out not to work: you are asked again next time
rather than being pinned to it.

Not every context can run Python. The Python interpreter has to be configured on
the SAS server behind it, and a context whose server has none will connect
happily and fail when you try to run something. If in doubt, ask whoever
administers the deployment which context is the right one.

## When it does not work

**Connect is greyed out in the Command Palette.** Either no connection profile
exists yet — run **Python on Viya: Add Connection Profile** — or the folder is
not trusted, or you are already connected.

**"Select a SAS Viya connection profile before connecting."** Profiles exist but
none is active in this window. Run **Python on Viya: Switch Connection Profile**.

**"The account chosen is not the one … uses."** Rare, and it means one thing:
two profiles point at the *same* deployment, so an account cannot tell them
apart and VS Code answered with the other one's session. Run **Python on Viya:
Switch Connection Profile** to the profile that account belongs to, or give the
two profiles different deployments. The extension refuses rather than opening a
session on a deployment you did not select.

**"The compute context … does not offer a `createSession` link."** The context
exists and you can see it, but the deployment did not offer a way to start a
session with it — either it is a kind of context you may list but not launch, or
your account does not have permission to launch it. Connect again and pick a
different one; nothing was written to your profile. This has been observed
inconsistently on the same context minutes apart, which is not yet explained.

**"This deployment offers no compute contexts you can see."** The deployment
answered, and it listed nothing you are allowed to use. This one is for your
administrator: a Viya account with no compute context is an entitlement problem,
not a configuration mistake at this end.

**Nothing happens after you press Cancel.** Intended. A cancelled request and an
unreachable deployment are indistinguishable on the wire, so the extension says
nothing rather than telling you your deployment is down when you are the one who
stopped it.

**Connecting fails and the message names a status code.** The log has the
deployment's own wording, the request that failed and the correlation id your
administrator will ask for. Run **Python on Viya: Show Log**.

**Nothing works in an untrusted workspace.** Connecting requires a trusted
folder, for the same reasons [signing in](signing-in.md) does and more directly:
the folder names the deployment, and connecting starts a process on it under your
identity. The command is not offered, and asking for it anyway is refused with a
message pointing at **Workspaces: Manage Workspace Trust**. See
[ADR-0002](adr/0002-workspace-trust-posture.md).

## What is not here yet

**Running Python.** The next slices add submission, the log filter and the output
channel. Until then, connecting proves the plumbing and gives you a session; it
does not give you anything to do with it.

**Refusing to submit into a busy session.** A session that is already running
something has to be told apart from an idle one before a second submission is
sent to it, which matters most in the shared-window case above. It lands with
submission, because there is nothing to refuse until then.

**Viya 3.5.** Unverified rather than supported, as everywhere else in these docs.

## Where the details are

The reasoning behind one session per workspace and profile — including the
alternatives that were rejected and the live-deployment measurements that
rejected them — is in
[ADR-0012](adr/0012-compute-session-lifetime-and-storage.md).
