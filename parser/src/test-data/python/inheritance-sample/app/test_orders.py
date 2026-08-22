"""Subclasses a base from ANOTHER package, reached through that package's re-export.

Every `self.*` call here is declared on framework.case.TestCase, never locally.
This is the cross-package inheritance shape: if the base does not resolve, none
of these can, which is what capped SELF resolution on the stdlib.
"""
import framework
from framework import Runner


class OrderTestCase(framework.TestCase):          # DOTTED base through a re-export
    def check_total(self):
        self.assert_equal(1, 1)                   # -> framework.case.TestCase.assert_equal
        self.record_failure("noted")              # -> framework.case.TestCase.record_failure
        return self.name                          # inherited attribute


class StrictOrderTestCase(OrderTestCase):         # same-module base, two hops to the target
    def check_strict(self):
        self.assert_equal(2, 2)                   # -> TestCase.assert_equal, via OrderTestCase
        self.check_total()                        # -> OrderTestCase.check_total
        return self.failures


def drive():
    runner = Runner()                             # local typed by CONSTRUCTOR
    case = StrictOrderTestCase("strict")          # local typed by CONSTRUCTOR
    runner.run(case)                              # -> framework.runner.Runner.run
    case.check_strict()                           # -> StrictOrderTestCase.check_strict
    return runner
