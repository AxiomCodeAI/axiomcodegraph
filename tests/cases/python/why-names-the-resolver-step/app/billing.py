class Invoice:
    def total(self):
        return self.subtotal() + 1

    def subtotal(self):
        return 2


def settle(inv):
    return inv.total()
