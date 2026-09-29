import subprocess
from pathlib import Path

HERE = Path(__file__).parent
SEED = HERE / "seed.sql"


def rebuild():
    subprocess.run(["bash", "scripts/rebuild.sh", "--all"], check=True)


def nightly():
    rebuild()


def load_seed(db):
    db.executescript(SEED.read_text())


def count_lines(db):
    return db.execute("SELECT count(*) FROM order_lines WHERE shipped = 1").fetchone()[0]


def report(db):
    print("orders shipped today:", count_lines(db))


def check_stock(n):
    # a stock count below zero used to print "stock went negative" here
    if n < 0:
        raise ValueError("stock level is negative")
    return n


def tidy():
    """Old notes: the nightly job also ran cleanup.sh, it no longer does."""
    return None


def restock(db, n):
    return check_stock(n)


def db_url():
    import os
    return os.environ["JOBS_DB_URL"]
