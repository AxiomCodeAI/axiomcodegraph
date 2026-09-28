def note(text):
    return text.strip()


def make_note(text):
    return note(text)


def handle(request):
    return make_note(request)


class Journal:
    def entry(self, text):
        return note(text)


def log(j: Journal):
    return j.entry('x')
