def parse_if_body():
    return "if"


class Parser:
    def __init__(self, keyword):
        self.keyword = keyword

    def parse_statement(self):
        f = getattr(self, f"parse_{self.keyword}")
        return f()

    def parse_if(self):
        return parse_if_body()
