SETTINGS = {
    "retries": 4,
    "timeout": 10,
}
LIMIT = {"max": 1}


class Store:
    ROUTES = [
        "a",
        "b",
    ]

    def get(self):
        return SETTINGS["retries"] + LIMIT["max"]
