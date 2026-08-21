"""Java analogue: integration/.

A realistic slice that exercises all four data-flow paths of schema section 3 in
one file, in the proportions the corpus actually shows: bare-name receivers
dominate, self is next, then attribute chains, then call results.

Nothing exotic -- the point is that the ordinary case works end to end.
"""

import logging
from typing import Optional

from pkg.models import Account, Ledger
from pkg.repository import find_account

logger = logging.getLogger(__name__)


class ValidationError(Exception):
    def __init__(self, field, message):
        super().__init__(message)
        self.field = field
        self.message = message


class AccountValidator:
    MIN_AMOUNT = 1

    def __init__(self):
        self.errors = []

    def validate(self, amount):
        if amount < self.MIN_AMOUNT:
            self.errors.append(ValidationError("amount", "too small"))
            return False
        return True

    def first_error(self) -> Optional[ValidationError]:
        if not self.errors:
            return None
        return self.errors[0]


class TransferService:
    def __init__(self, ledger=None):
        self.ledger = ledger if ledger is not None else Ledger()
        self.validator = AccountValidator()
        self.completed = 0

    def transfer(self, source_owner, target_owner, amount):
        # (1) bare-name receiver -> import
        logger.info("transfer %s -> %s", source_owner, target_owner)

        # (4) call-result receiver: find_account returns an Account
        source = find_account(source_owner)
        target = find_account(target_owner)

        # (2) self receiver
        if not self.validate_amount(amount):
            # (3) attribute chain, depth 2
            error = self.validator.first_error()
            raise error if error is not None else ValidationError("amount", "bad")

        # chained calls off a resolvable receiver
        source.withdraw(amount).balance()
        target.deposit(amount)

        # (3) attribute chain, depth 2, with an argument that is itself typed
        self.ledger.record(source)
        self.ledger.record(target)

        self.completed += 1
        return self.summary()

    def validate_amount(self, amount):
        # (2) self, delegating to a field
        return self.validator.validate(amount)

    def summary(self):
        # (3) depth-2 chain returning a primitive
        return {
            "total": self.ledger.total(),
            "completed": self.completed,
        }

    def bulk(self, pairs, amount):
        results = []
        for source_owner, target_owner in pairs:
            try:
                results.append(self.transfer(source_owner, target_owner, amount))
            except ValidationError as err:
                logger.warning("skipped: %s", err.message)
                continue
        return results

    def audit(self):
        # comprehension over an attribute, with a chained call inside
        return [entry.balance() for entry in self.ledger.entries if entry.balance() > 0]


def run(pairs, amount=10):
    service = TransferService()
    outcome = service.bulk(pairs, amount)
    return service, outcome
