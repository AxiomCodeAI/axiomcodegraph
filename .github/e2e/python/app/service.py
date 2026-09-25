def leaf():
    return 41


def helper():
    return leaf() * 2


def entry():
    return helper() + 1
