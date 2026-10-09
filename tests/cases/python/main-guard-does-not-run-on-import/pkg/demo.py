def render(x):
    return str(x)


def show():
    return render(1)


TABLE = render("header")


if __name__ == "__main__":
    print(show())
