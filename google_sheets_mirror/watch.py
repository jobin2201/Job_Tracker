import logging
import time

from sync import synchronize
from src.config import Settings


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def run() -> None:
    interval = Settings().sync_interval_seconds
    logging.info("Google Sheets mirror started; interval=%s seconds", interval)
    while True:
        try:
            result = synchronize()
            logging.info("Mirror synchronized for %s (%s applications)", result["user"], result["applications"])
        except Exception:
            # This process is deliberately isolated: a Google failure is logged
            # and retried, never propagated to FastAPI or PostgreSQL writes.
            logging.exception("Google Sheets synchronization failed; PostgreSQL was not modified")
        time.sleep(interval)


if __name__ == "__main__":
    run()
