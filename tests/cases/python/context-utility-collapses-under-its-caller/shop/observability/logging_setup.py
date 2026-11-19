import logging


def get_logger(name):
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    return logger


def log_event(logger, event, **fields):
    logger.info("%s %s", event, format_fields(fields))


def format_fields(fields):
    return " ".join(f"{k}={v}" for k, v in sorted(fields.items()))
