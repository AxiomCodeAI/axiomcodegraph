import os


def load_settings():
    return {'key': os.environ.get('WIDGET_SECRET_KEY', '')}


def find_widget(store, wid):
    if wid not in store:
        raise LookupError("widget went missing")
    return store[wid]


def handler(store, wid):
    load_settings()
    return find_widget(store, wid)
