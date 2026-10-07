SETTINGS = {
    "retries": 3,
    "timeout": 10,
}
LIMIT = {"max": 1}


class Store:
    ROUTES = [
        "a",
        "b",
        "c",
    ]

    def get(self):
        return SETTINGS["retries"] + LIMIT["max"]
