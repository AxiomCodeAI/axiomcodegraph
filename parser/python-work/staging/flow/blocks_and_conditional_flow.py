"""Java analogue: blocks/.

Block ownership and flow through suites. ~40% of Java invocations sit inside a
block rather than directly in a method body, and Python adds module-level
blocks, which have no Java analogue at all -- they need the synthetic <module>
owner or call attribution has nothing to attach to.
"""

from pkg.models import Account, Ledger

# ---- module-level executable code: 3.6 statements per file in the corpus ----
DEFAULT_LEDGER = Ledger()
DEFAULT_LEDGER.record(Account("bootstrap"))

if DEFAULT_LEDGER.total() == 0:
    # a module-level BLOCK -- owned by <module>, not by any function
    STARTUP = Account("startup")
    DEFAULT_LEDGER.record(STARTUP)
else:
    STARTUP = None

for _seed in ("a", "b"):
    DEFAULT_LEDGER.record(Account(_seed))

try:
    import cjson as _fast_json
except ImportError:
    import json as _fast_json


def if_elif_else(account, mode):
    if mode == "deposit":
        account.deposit(1)
    elif mode == "withdraw":
        account.withdraw(1)
    else:
        account.balance()
    return account


def nested_blocks(accounts, flag):
    total = 0
    for account in accounts:
        if flag:
            while total < 10:
                total += account.balance()
                if total > 5:
                    break
            else:
                total = 0
        else:
            continue
    return total


def try_except_else_finally(path):
    handle = None
    try:
        handle = open(path)
        data = handle.read()
    except FileNotFoundError:
        data = ""
    except OSError as err:
        data = str(err)
        raise
    else:
        data = data.strip()
    finally:
        if handle is not None:
            handle.close()
    return data


def with_single_and_multiple(path_a, path_b):
    with open(path_a) as first:
        first.read()
    with open(path_a) as first, open(path_b) as second:
        return first.read(), second.read()


def calls_inside_every_block_kind(accounts, path, flag):
    # every call below is owned by a BLOCK, not directly by the function
    if flag:
        accounts[0].balance()
    for account in accounts:
        account.balance()
    while flag:
        accounts[0].balance()
        break
    try:
        accounts[0].balance()
    except IndexError:
        pass
    with open(path) as handle:
        handle.read()


def comprehension_inside_a_block(accounts, flag):
    if flag:
        return [a.balance() for a in accounts]
    return {a.owner: a.balance() for a in accounts}


if __name__ == "__main__":
    # the main-guard shape, extremely common and always module-level
    DEFAULT_LEDGER.record(Account("main"))
