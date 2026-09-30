def now(key):
    return "now:" + key


def later(key):
    return "later:" + key


def pick(item):
    return item[0]


def register():
    return [
        ("now", now),
    ]


def table():
    return {"later": later}


def ordered(items):
    return sorted(items, key=pick)
