class Sender:
    def __init__(self, channel):
        self.channel = channel

    def notify(self, text):
        raise NotImplementedError
