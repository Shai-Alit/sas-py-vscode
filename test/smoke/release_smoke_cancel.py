# Release smoke test — cancelling a run.
#
# Run File, and a few seconds in press Cancel in the progress notification (or
# run "Python on Viya: Cancel"). The countdown below does not show while it
# runs, because printed output arrives only when the step ends (Finding 13.3 in
# docs/phases/phase-13.md), so count the seconds yourself. Expect the output
# channel to end with "Cancelled." plus the note that SAS Viya may keep
# executing a step that was already running, with no error notification. Then
# Run File again straight away: it waits for the session to come free, then
# runs normally.

import time

for second in range(1, 21):
    print(f"cancel demo: {second}/20 s", flush=True)
    time.sleep(1)
print("cancel demo finished without being cancelled")
