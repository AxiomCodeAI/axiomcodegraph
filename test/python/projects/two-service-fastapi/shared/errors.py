class ServiceError(Exception):
    def __init__(self, message: str, status: int = 500):
        super().__init__(message)
        self.status = status

    def as_payload(self) -> dict:
        return {"error": str(self), "status": self.status}


class NotFound(ServiceError):
    def __init__(self, key: str):
        super().__init__("no such key: " + key, status=404)
        self.key = key
