def on_save(doc):
    return audit(doc)


def on_load(doc):
    return doc


def on_purge(doc):
    return doc


def audit(doc):
    doc["audited"] = True
    return doc
