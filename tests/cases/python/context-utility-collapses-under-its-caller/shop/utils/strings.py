def normalize_id(value):
    return str(value).strip().lower()


def truncate(text, limit=80):
    text = str(text)
    return text if len(text) <= limit else text[: limit - 1] + "..."


def format_money(cents):
    return f"{cents / 100:.2f}"
