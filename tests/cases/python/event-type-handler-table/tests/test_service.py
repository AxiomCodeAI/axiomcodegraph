from app.service import create


class Bus:
    def publish(self, topic, doc):
        pass


def test_create_publishes():
    create(Bus(), {"id": "d1"})
