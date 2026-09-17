from models import Point, User

def build():
    p = Point(1, 2)
    u = User(login="a", email="b")
    return p, u
