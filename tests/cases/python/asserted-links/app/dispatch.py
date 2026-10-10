from app import handlers


def dispatch(event, doc):
    fn = getattr(handlers, event)
    return fn(doc)


def run_table(table, key, doc):
    return table[key](doc)


def purge(doc):
    fn = getattr(handlers, "on_" + "purge")
    return fn(doc)


def save_and_audit(doc):
    return handlers.audit(doc)


def copy_doc(doc):
    return doc.copy()


def refresh(doc, store):
    return store.on_load(doc)
