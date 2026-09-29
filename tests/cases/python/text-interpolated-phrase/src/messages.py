def require_scope(scope):
    raise ValueError(f"no indexed file has '{scope}' in its path")


def quota(user, n):
    return "quota for %s is exhausted after %d requests" % (user, n)


def sealed(name):
    return "the archive " + name + " was never sealed"


def far_apart(n):
    note = "the ledger is"
    total = n + 1
    return note, total, "out of balance"
