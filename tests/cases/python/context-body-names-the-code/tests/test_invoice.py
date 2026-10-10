from billing.invoice import compute_invoice_total


def test_total():
    assert compute_invoice_total([1, 2]) == 3
