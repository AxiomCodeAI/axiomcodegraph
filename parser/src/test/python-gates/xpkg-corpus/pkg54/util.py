def decorate(kind: str, value: int) -> str:
    return "[" + kind + ":" + str(value) + "]"


def combine(left: int, right: int) -> int:
    return left + right


class Mixin54:
    """Supplies behaviour only when combined with a Base."""

    def boosted(self) -> int:
        return self.weight() * 2
