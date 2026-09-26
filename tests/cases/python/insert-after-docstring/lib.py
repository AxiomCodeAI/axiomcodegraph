class Scaler:
    def __init__(self, factor):
        self.factor = factor

    def scale(self, value):
        """Multiply value by the factor."""
        value = value * self.factor
        return value

    def other(self):
        return 1
