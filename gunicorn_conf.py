"""Lance la sauvegarde quotidienne depuis chaque worker Gunicorn.

Un thread léger par worker, et un verrou fichier évite les doublons
en cas de plusieurs processus partageant /data.
"""
import logging
import os
import threading
import time
from pathlib import Path

import backup_service

log = logging.getLogger('stockpilot.backups')


def post_worker_init(worker):
    data_dir = Path(os.environ.get('STOCKPILOT_DATA_DIR', '/data'))
    db_file = data_dir / 'stockpilot.sqlite3'

    def schedule():
        while True:
            if not db_file.is_file():
                time.sleep(10)
                continue
            try:
                path = backup_service.ensure_daily_backup(db_file, data_dir)
                log.info('Sauvegarde automatique StockPilot contrôlée : %s', path.name)
            except Exception:
                log.exception('Échec sauvegarde quotidienne StockPilot')
            time.sleep(15 * 60)

    threading.Thread(target=schedule, name='stockpilot-daily-backups', daemon=True).start()
