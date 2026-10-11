class Gateway:
    def charge(self, amount):
        return amount


class Mailer:
    def charge(self, amount):
        return -amount
