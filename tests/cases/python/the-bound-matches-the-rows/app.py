# Two shapes whose bound lines used to contradict the rows above them (#1136):
#   `Ledger.settle` is reached only by a by-name site, so nothing in the answer claims a call
#   edge — which is not the same as "no entry is resolved".
#   `Ledger` as a type target seeds the closure with its OWN dependents, so an empty closure
#   means nothing calls THEM, not that they were reached weakly.
class Ledger:
    def settle(self):
        return 1


def top(anything):
    # the receiver is not typed, so this is a by-name site and no edge at all
    return anything.settle()


def entry():
    # constructs the type — a resolved dependent of `Ledger`, and not a call to `settle`
    return Ledger()
