import sys

from app.report import summarise


def main():
    print(summarise(sys.argv[1]))


if __name__ == "__main__":
    main()
