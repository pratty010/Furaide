import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator
from mekiki import db
from mekiki.paths import events_dir

def _checkpoint_for(path: str) -> int:
    conn = db.connect()
    try:
        row = conn.execute(
            "SELECT last_byte_processed FROM source_files WHERE path = ?",
            (path,),
        ).fetchone()
        return row[0] if row else 0
    finally:
        conn.close()

def checkpoint(path: str, byte_offset: int) -> None:
    now = datetime.now(timezone.utc).isoformat()
    conn = db.connect()
    try:
        conn.execute(
            "INSERT INTO source_files(path, last_byte_processed, last_processed_at) "
            "VALUES(?, ?, ?) ON CONFLICT(path) DO UPDATE SET "
            "last_byte_processed=excluded.last_byte_processed, "
            "last_processed_at=excluded.last_processed_at",
            (path, byte_offset, now),
        )
        conn.commit()
    finally:
        conn.close()

def iter_new(platform: str = "claude-code") -> Iterator[dict]:
    """Yield every unseen event JSON object across all daily files, in file+line order."""
    d = events_dir(platform)
    db.init()
    for f in sorted(d.glob("*.jsonl")):
        offset = _checkpoint_for(str(f))
        if offset >= f.stat().st_size:
            continue
        with f.open("rb") as fh:
            fh.seek(offset)
            while True:
                line = fh.readline()
                if not line:
                    break
                line_str = line.decode("utf-8").strip()
                if line_str:
                    try:
                        yield json.loads(line_str)
                    except json.JSONDecodeError:
                        continue
