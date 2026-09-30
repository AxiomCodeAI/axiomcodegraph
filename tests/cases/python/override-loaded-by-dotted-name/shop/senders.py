from shop.base import Sender


def limit_notice(channel):
    return "limit reached for " + channel.name


def fax_notice(channel):
    return "fax for " + channel.name


class Pager(Sender):
    def notify(self, text):
        if len(text) > 160:
            return limit_notice(self.channel)
        return text


class Fax(Sender):
    def notify(self, text):
        return fax_notice(self.channel)
