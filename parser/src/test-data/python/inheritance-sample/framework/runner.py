"""A class whose method returns an instance of another in-project class."""
from .case import TestCase


class Result:
    def __init__(self) -> None:
        self.passed = 0

    def add_pass(self):
        self.passed += 1
        return self.passed


class Runner:
    def __init__(self) -> None:
        self.result = Result()                    # attribute typed by CONSTRUCTOR

    def make_result(self) -> Result:              # return type names an in-project class
        return Result()

    def run(self, case: TestCase):                # parameter typed by ANNOTATION
        case.setup()                              # NAME receiver, parameter-typed
        outcome = self.make_result()              # local typed by RETURN type
        outcome.add_pass()                        # NAME receiver, local-typed
        self.result.add_pass()                    # ATTRIBUTE receiver, constructor-typed
        return outcome
