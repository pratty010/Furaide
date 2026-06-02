# cli/src/satori/report/server.py
import os
import subprocess
import sys
import time
import urllib.request
from satori.paths import reports_dir

PORT = int(os.environ.get("SATORI_REPORT_PORT", "8765"))

def _pid_file() -> str:
    return str(reports_dir() / ".server.pid")

def is_running() -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/", timeout=0.3) as r:
            return r.status == 200 or r.status == 404
    except Exception:
        return False

def ensure_running() -> str:
    if is_running():
        return f"http://127.0.0.1:{PORT}/"
    reports_dir().mkdir(parents=True, exist_ok=True)
    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)],
        cwd=str(reports_dir()),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    with open(_pid_file(), "w") as f:
        f.write(str(proc.pid))
    for _ in range(20):
        if is_running():
            break
        time.sleep(0.1)
    return f"http://127.0.0.1:{PORT}/"
