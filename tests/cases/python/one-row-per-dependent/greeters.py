class Greeter:
    def greet(self, name, style):
        return name


class LoudGreeter(Greeter):
    def greet(self, name, style):
        return name.upper()


class Box:
    def __init__(self):
        self.width = 1
        self.height = 1

    def grow(self):
        self.width += 1
        self.height += 1

    def shrink(self):
        self.width -= 1
        self.height -= 1
