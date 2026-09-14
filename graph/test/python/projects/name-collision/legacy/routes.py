"""Two more, in a module nobody else imports from. Present purely to widen the name fan."""


class OldRoute:
    def get_distance(self) -> float:
        return 99.0


class LegacyLeg:
    def get_distance(self) -> float:
        return 0.5
