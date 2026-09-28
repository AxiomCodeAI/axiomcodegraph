from app.pricing import price


def main():
    assert price(10) == 12.0
    print("ok")


if __name__ == '__main__':
    main()
