class Notifier:
    def send(self, msg: str) -> str:
        return msg


class MailNotifier(Notifier):
    def send(self, msg: str) -> str:
        return "mail:" + msg


class SmsNotifier(Notifier):
    def send(self, msg: str) -> str:
        return "sms:" + msg


def alert(n: Notifier) -> str:
    return n.send("x")


def sms_only(n: SmsNotifier) -> str:
    return n.send("y")


class Desk:
    def __init__(self, notifier: Notifier):
        self.notifier = notifier

    def ring(self) -> str:
        return self.notifier.send("z")
