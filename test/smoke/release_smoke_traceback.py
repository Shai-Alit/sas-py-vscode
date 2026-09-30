# Release smoke test — a run that FAILS on purpose.
#
# 1. Run File. Expect "Finished with an error." in the output channel, a
#    ZeroDivisionError traceback in the Result panel whose `<string>` frames are
#    links, and one Problems entry on the `return numerator / denominator` line
#    below, with the other frames as related information.
# 2. Click each frame link: the editor jumps to the matching line here.
# 3. Select from `def outer` through the `outer()` call and Run Selection. The
#    Problems entry and frame links must land on the same lines as in step 1
#    (the selection's start line is added as an offset).
# 4. Close this editor tab: the Problems entry disappears.


def outer():
    return middle(10)


def middle(value):
    return inner(value, 0)


def inner(numerator, denominator):
    return numerator / denominator


outer()
