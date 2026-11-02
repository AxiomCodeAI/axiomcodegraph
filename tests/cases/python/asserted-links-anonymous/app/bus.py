class Bus:
    def __init__(self):
        self.listeners = []

    def on(self, listener):
        self.listeners.append(listener)

    def emit(self, x):
        for listener in self.listeners:
            listener(x)
