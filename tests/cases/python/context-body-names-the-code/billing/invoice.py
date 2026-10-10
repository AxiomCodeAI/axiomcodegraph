def round_cents(amount):
    return round(amount, 2)


def compute_invoice_total(lines):
    return round_cents(sum(lines))
