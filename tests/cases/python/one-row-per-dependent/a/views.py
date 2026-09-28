from formatters import FormatterPlugin


def show(f: FormatterPlugin, body):
    return f.format_body(body, 'application/json')
