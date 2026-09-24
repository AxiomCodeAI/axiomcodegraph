from store.query import ResultSet, RawResultSet


def run():
    rows = ResultSet().fetch_all()
    values = ResultSet().values().fetch_all()
    raw = list(RawResultSet().iterator())
    return rows, values, raw


run()
