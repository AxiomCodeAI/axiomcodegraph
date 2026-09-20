class Basket:
    RATE = 0.2

    def __init__(self):
        self.lines = []

    def total(self):
        return sum(self.lines)


def checkout(basket):
    return basket.total()
