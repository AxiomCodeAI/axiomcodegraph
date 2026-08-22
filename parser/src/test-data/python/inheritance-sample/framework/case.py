"""The base class every app test subclasses. Declared HERE, re-exported by the package."""


class TestCase:
    def __init__(self, name: str) -> None:
        self.name = name
        self.failures = []

    def assert_equal(self, left, right):          # <- the inherited target
        if left != right:
            self.record_failure("not equal")
        return True

    def record_failure(self, message):            # <- reached by a sibling method
        self.failures.append(message)
        return message

    def setup(self):
        return None
