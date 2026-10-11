from greeter import Greeter


def welcome(name):
    return Greeter().hello(name).shout()
