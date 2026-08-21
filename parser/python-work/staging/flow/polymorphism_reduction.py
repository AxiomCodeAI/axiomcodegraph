"""Java analogue: type-registry/ + integration/.

The measured problem, in miniature: naive name-based dispatch gives 24.63
candidate callees per attribute call site. This fixture defines ONE method name
on many unrelated classes, then calls it through receivers of varying
resolvability -- so the reduction each mechanism buys can be measured rather
than asserted.

`save` is defined on 6 classes here. A receiver the engine cannot type fans to
all 6; a receiver it can type resolves to 1.
"""

from pkg.models import Account


class FileStore:
    def save(self, item):
        return ("file", item)


class DbStore:
    def save(self, item):
        return ("db", item)


class MemoryStore:
    def save(self, item):
        return ("memory", item)


class NullStore:
    def save(self, item):
        return None


class AuditStore:
    def save(self, item):
        return ("audit", item)


class CachingStore:
    def __init__(self, inner):
        # unannotated: only callers say what `inner` is
        self.inner = inner

    def save(self, item):
        return self.inner.save(item)


# ---- resolvable receivers: each should collapse to exactly ONE candidate ----

def resolvable_from_constructor(item):
    store = FileStore()
    return store.save(item)


def resolvable_from_import(item):
    # cross-module class, resolvable through the import graph
    return Account("owner").deposit(item)


def resolvable_from_self(item):
    return CachingStore(FileStore()).save(item)


def resolvable_from_isinstance(store, item):
    if isinstance(store, DbStore):
        return store.save(item)
    return None


def resolvable_from_annotation(store: MemoryStore, item):
    return store.save(item)


def resolvable_from_return_flow(item):
    return make_store().save(item)


def make_store():
    return AuditStore()


# ---- unresolvable receivers: these SHOULD fan, and be reported as imprecise --

def unresolvable_parameter(store, item):
    # no annotation, no local flow, no callers in this file
    return store.save(item)


def unresolvable_from_dynamic(name, item):
    store = globals()[name]()
    return store.save(item)


def unresolvable_from_getattr(obj, item):
    return getattr(obj, "save")(item)


def unresolvable_from_container(stores, item):
    # element type of a heterogeneous container
    return stores[0].save(item)


# ---- the union case: genuinely more than one, and that is the right answer ---

def two_concrete_types(flag, item):
    store = FileStore()
    if flag:
        store = DbStore()
    return store.save(item)
