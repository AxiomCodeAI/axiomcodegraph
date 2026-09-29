from core.format import format_amount


class Invoice:
    def subtotal_label(self, cents):
        return "Subtotal: " + format_amount(cents)

    def total_label(self, cents):
        return "Total: " + format_amount(cents)
