# Troubleshooting

When something goes wrong between your editor and a SAS Viya deployment, this
page is where to look. It is organised by what you **see**, and most entries
point back into the page that covers that area in full.

Most of what follows is a failure that was actually hit during development
against a live deployment, not a hypothetical — the claims about how Viya
behaves trace to the **Probe findings** sections of the
[phase files](https://github.com/Shai-Alit/sas-py-vscode/blob/main/docs/phases).

## Start at the log

Two output channels carry different things, and the difference matters when you
are stuck:

- **Python on Viya: Output** is a transcript of what your *program* printed:
  `stdout`, the exception message, and a final `Finished.` or `Finished with an
  error.`.
- **Python on Viya** — open it with **Python on Viya: Show Log** — is the
  *extension's* record: every request it made, the deployment's own wording for
  anything that failed, the HTTP status code, and the **correlation id** your
  administrator will ask for.

A notification is the short version. The log has the long version, and for
anything that touches the network it has the only version that can be
diagnosed.

## Signing in

**The browser opens and nothing comes back.** Expected on most deployments. The
built-in `vscode` OAuth client is registered to *show you a code*, not to hand
you back to the editor — this was confirmed against a live deployment. Copy the
code from the page into the **Sign in to SAS Viya** box. That box is the route,
not a consolation prize. See
[Signing in](signing-in.md#oauth-clients-and-the-secret-prompt).

**"Invalid redirect … did not match one of the registered values."** Your
profile names an OAuth client whose registered redirect address is not
`vscode://shai-alit.python-on-viya/auth-callback`. Correct the registration, or
clear the client ID from the profile to fall back to the built-in client and
the paste box.

**You signed in, and then a run says you are not signed in.** A token the
deployment actively rejected and a request that carried no token at all both
arrive as a bare `401`, and only the first is fixed by signing in again. The
log says which one happened. If it was a rejected token, sign in again; if it
was a missing one, that is a bug worth reporting with the log attached.

**An account left the Accounts menu on its own.** A background token renewal
failed — the refresh token was revoked, the deployment was unreachable, or an
administrator ended the session — or the deployment does not issue refresh
tokens at all, in which case a sign-in only ever lasts about an hour. Nothing
pops up, because you did not ask for anything; the reason is in the log. Sign
in again.

**`UNABLE_TO_VERIFY_LEAF_SIGNATURE` / "unable to verify the first
certificate".** A TLS failure before authentication: the deployment's
certificate does not chain to anything your machine trusts. See
[Private certificate authorities](signing-in.md#private-certificate-authorities).

**A command you expected is missing from the Command Palette.** VS Code leaves
a currently-unavailable command out of the palette rather than greying it, so a
missing entry is the normal way this looks — you are already signed in or
connected, no profile is active, or the folder is not trusted.

## Connecting and starting a session

**"SAS Viya did not offer that operation to your account here."** The context
you picked is one you can see, but the response listing it did not include a
way to start a session with it. Viya composes the set of links per response, so
this describes the answer *your account* received rather than a fixed fact
about the deployment — it has been seen to appear and then stop on the same
context minutes apart. Connect again and pick a different context, or ask your
administrator for launch permission on the one you wanted. The log names the
relation that was missing.

**"This deployment offers no compute contexts you can see."** The deployment
answered and listed nothing you may use. This is an entitlement question for
your administrator, not a setting at this end.

**A context connects, then every run fails.** Not every compute context has a
Python interpreter configured on its SAS server, and one that does not connects
happily and then cannot run anything. The picker does not know which contexts
can run Python; your administrator does. Your answer is written back to the
profile only once a session has actually started on it, so a context that does
not work leaves the profile alone and you are asked again next time.

**Nothing happens after you press Cancel during a connect.** Intended. A
cancelled request and an unreachable deployment look identical on the wire, so
the extension says nothing rather than reporting an outage you caused.

## Running Python

**"The SAS Viya session ended. Connect again and re-run."** The session was
reaped — Viya reaps an idle compute session after about fifteen minutes, which
is Viya's timeout and your administrator may have changed it — or an
administrator ended it, or, rarely, its container ran out of memory (see *A run
building a very large figure* below). Your Python state is gone with it. The
next run reconnects and starts a fresh interpreter for you.

**A run fails saying a fileref already exists.** Seen right after a window
reload: the extension's per-run fileref counter restarts while the reattached
session still holds names allocated before the reload. The extension now seeds
that counter from the session on the first run after connecting, so a reload
should no longer trigger this. If it still happens, two editor windows are open
on the same folder and racing for names — they share one session by design;
close one, or keep retrying for up to a minute and it clears itself.

**A second run is refused while the first is still going.** The session runs
one thing at a time — a run, a reset, or an environment probe. Cancel the first
or wait; the second is refused with a message naming what is in the way, not
queued behind it. See
[Running Python](running-python.md#one-run-at-a-time).

**Cancel does not stop a long statement, and the next run is slow.** A cancel
stops the run *locally* at once, but it cannot reach into SAS and interrupt a
Python statement that is already executing: a `time.sleep(60)` cancelled six
seconds in still runs its full minute before the interpreter is torn down, and
anything you start immediately behind it waits for the session to come free
with no message explaining the wait. This was measured against a live
deployment, not assumed — see
[Running Python](running-python.md#cancelling-a-run) and Probe findings 75–76 in
[`docs/phases/phase-4.md`](https://github.com/Shai-Alit/sas-py-vscode/blob/main/docs/phases/phase-4.md).

**`ModuleNotFoundError`.** Nine times in ten the package is simply not in the
deployment's managed Python environment, not a mistake in your code. The
diagnostic message says as much and points at **Python on Viya: Show
Environment**. See [The Python environment](python-environment.md).

**The namespace is in a state you would rather not reason about.** **Python on
Viya: Reset Python State** restarts the interpreter inside the session (a few
seconds) without dropping the session, its SAS libraries or its filerefs. It is
the lever for a wedged namespace. You should not need it to recover from a
*submission* problem: the extension uploads your code as a file and runs it
with `proc python infile=`, which cannot leave the SAS-side parser in the
broken state that inline submission can
([ADR-0014](adr/0014-python-is-submitted-as-an-uploaded-file.md)).

## Output does not look right

**The transcript carries a `Python 3.x …` banner and bare `>>>` lines.**
`PROC PYTHON` emits these around your code — the banner on a Run File, which
restarts the interpreter first, and `>>>` markers on essentially every run.
They are harmless noise. Removing them cleanly needs a change on the SAS side
rather than the extension guessing which lines to hide, because a program may
legitimately print `>>>`. Tracked as a probe follow-up.

**A figure or table never appears in the Result panel.** Rich output is
captured by noticing files your script *writes* to the session's working
directory — there is no implicit `savefig`. Call `fig.savefig("plot.png")` or
`df.to_html("table.html")` explicitly. A written file larger than 10 MiB is
skipped with a note naming it and the limit; a cancelled run captures nothing.
See [Running Python](running-python.md#the-result-panel).

**A run building a very large figure kills the session.** This is distinct from
the 10 MiB skip above. A script whose figure *generation* — not the file it
writes — exhausts the session container's memory, such as a large `figsize` at
a high `dpi`, is an out-of-memory kill of the session. It surfaces as an HTTP
500 on the job-log poll and then a session-ended message on the next run.
Reduce the array size or the `dpi`. This is a documented limitation, outside
the transfer cap's scope.

**The Result panel and output channel are empty after a window reload.** Both
are cleared on reload by design, and neither has a serializer yet. Re-run to
repopulate them.

## The Problems panel

Covered in full under
[Diagnostics](diagnostics.md#when-it-does-not-work). In short: no entry appears
when the traceback has no frame in your own file (a SAS-side failure, or an
all-library stack); a frame that will not respond to a click is a library frame
or a file that has been renamed or deleted since the run; and an entry clears
at the start of the next run of that file, or on closing the editor tab,
signing out, or switching the run target to Local.

## Reset, reconnect, or reload?

- **Reset Python State** — the interpreter's namespace is wedged but the
  session is otherwise fine. Keeps the session's SAS libraries and filerefs.
- **Disconnect then Connect** — the session itself is suspect, or you want a
  genuinely clean SAS process. This is also how you recover a session an
  administrator ended, though the next run does it for you.
- **Reload Window** — the extension itself is misbehaving. Your compute session
  and Python state survive a reload; the output channel and Result panel do
  not.

## Filing a bug

Attach the **Python on Viya** log (**Show Log**), say what you did, and include
the correlation id from any failed request. The log can contain your
deployment's hostname and a compute session id — fine to share with your
administrator, worth trimming before a public issue.

## Where the details are

- [Signing in](signing-in.md) · [Connecting to Viya](connecting.md) ·
  [Running Python](running-python.md) · [Diagnostics](diagnostics.md) ·
  [The Python environment](python-environment.md) — each has its own "When it
  does not work" section for the area it covers.
- The **Probe findings** sections of the
  [phase files](https://github.com/Shai-Alit/sas-py-vscode/blob/main/docs/phases/phase-4.md)
  record the measured deployment behaviour every entry here rests on.
