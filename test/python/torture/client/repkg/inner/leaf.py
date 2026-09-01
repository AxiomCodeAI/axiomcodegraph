class Widget:
    def emit(self) -> str:
        return "widget"


def make_widget() -> "Widget":
    return Widget()
