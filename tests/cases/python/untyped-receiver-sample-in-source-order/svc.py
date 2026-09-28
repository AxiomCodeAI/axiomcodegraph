class Pinger:
    def ping(self):
        return 1


def direct():
    return Pinger().ping()
