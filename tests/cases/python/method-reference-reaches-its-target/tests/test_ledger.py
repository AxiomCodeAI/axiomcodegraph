from orders import LedgerService, ledger_rank


def test_ledger_rank():
    assert ledger_rank(LedgerService(), [2, 1]) == [1, 2]
