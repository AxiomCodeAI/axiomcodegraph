"""Comprehension forms — the regime-sensitive construct."""


def simple(items):
    return [i for i in items]


def nested(rows):
    return [c for row in rows for c in row]


def conditional(items):
    return [i for i in items if i]


def double_conditional(items):
    return [i for i in items if i if i]


def set_and_dict(items):
    return {i for i in items}, {i: i for i in items}


def generator(items):
    return (i for i in items)


def nested_comprehension(rows):
    return [[c for c in row] for row in rows]


def comprehension_in_default(items=[i for i in range(2)]):
    return items


class InClassBody:
    values = [i for i in range(3)]

    def total(self) -> int:
        return len(self.values)


def exercise() -> int:
    return len(simple([1])) + InClassBody().total()
