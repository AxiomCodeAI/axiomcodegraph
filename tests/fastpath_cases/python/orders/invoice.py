from core.format import format_amount


def subtotal_label(cents):
    return "Subtotal: " + format_amount(cents)


def total_label(cents):
    return "Total: " + format_amount(cents)
