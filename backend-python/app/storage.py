import os
from pathlib import Path

from .database import BACKEND_ROOT


UPLOADS_ROOT = Path(os.getenv("UPLOADS_DIR", str(BACKEND_ROOT / "uploads"))).resolve()
BACKUPS_ROOT = Path(os.getenv("BACKUPS_DIR", str(BACKEND_ROOT / "backups"))).resolve()


def upload_path(*parts: str) -> Path:
    path = UPLOADS_ROOT.joinpath(*parts)
    path.mkdir(parents=True, exist_ok=True)
    return path


def backup_path() -> Path:
    BACKUPS_ROOT.mkdir(parents=True, exist_ok=True)
    return BACKUPS_ROOT
