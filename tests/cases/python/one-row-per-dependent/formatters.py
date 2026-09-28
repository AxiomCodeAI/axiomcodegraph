class FormatterPlugin:
    def format_body(self, content, mime):
        return content


class JSONFormatter(FormatterPlugin):
    def format_body(self, content, mime):
        return content.strip()


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
