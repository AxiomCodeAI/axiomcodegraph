"""Java analogue: imports/ + type-references/.

Path (1) of schema section 3: a BARE NAME receiver resolved through its binding
to an import. Imports are 37.2% of bare-name receivers in the measured corpus --
the single largest bucket, and resolvable with no type inference at all.

Every call below has a receiver whose identity is decidable from the import
graph alone. Nothing here needs inference; if the engine cannot resolve these,
the binder is wrong, not the type layer.
"""

import os
import os.path
import json as serializer
import xml.etree.ElementTree as ElementTree
from collections import OrderedDict
from collections import defaultdict as DefaultDict
from decimal import Decimal, Context

from pkg.models import Account, Ledger
from pkg.models import Account as Acct
from pkg import repository


def module_import_receiver(path):
    # receiver `os` binds to a MODULE import -> os.path.join resolves by path
    return os.path.join(path, "data")


def dotted_module_import_receiver(path):
    # `import os.path` binds only the ROOT name `os`; the call still resolves
    return os.path.dirname(path)


def aliased_module_receiver(payload):
    # receiver `serializer` binds to the module json under an alias
    return serializer.dumps(payload)


def deep_aliased_module_receiver(text):
    # a 3-segment dotted module bound to a single alias
    return ElementTree.fromstring(text)


def from_member_receiver():
    # `OrderedDict` binds to a CLASS via from-import; the call constructs it,
    # and the result's method resolves in that class
    ordered = OrderedDict()
    ordered.setdefault("k", 1)
    return ordered


def aliased_member_receiver(amount):
    # from-import with an alias: the bound name differs from the imported name
    d = Decimal(amount)
    return d.quantize(Decimal("0.01"))


def multi_name_from_import(precision):
    # one `from` statement binding two names -> two separate import rows
    ctx = Context(prec=precision)
    return ctx.create_decimal("1.5")


def defaultdict_alias(pairs):
    counts = DefaultDict(int)
    for key, value in pairs:
        counts[key] += value
    return counts


def cross_module_class_receiver(owner):
    # Account is declared in pkg/models.py -- resolution must cross the module
    # boundary, which is the whole point of this fixture
    account = Account(owner)
    account.deposit(100)
    return account.balance()


def cross_module_alias_receiver(owner):
    # same class, different bound name
    return Acct(owner).balance()


def cross_module_module_receiver(owner):
    # `from pkg import repository` binds a MODULE, not a member
    return repository.find_account(owner)


def constructed_then_chained(owner):
    ledger = Ledger()
    ledger.record(Account(owner))
    return ledger.total()
