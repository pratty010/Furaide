import json
import subprocess
import sys
import os

def test_cli_ingest_runs(satori_home, tmp_path):
    f = satori_home / "events" / "claude-code" / "2026-05-27.jsonl"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps({
        "ts":"2026-05-27T10:00:00.000Z","platform":"claude-code","event":"session.start",
        "session_id":"s1","cwd":"/tmp","model":"claude-opus-4-7","source":"startup",
        "transcript_path":"/nonexistent"
    }) + "\n")
    env = os.environ.copy()
    env["SATORI_HOME"] = str(satori_home)
    r = subprocess.run(
        [sys.executable, "-m", "satori", "ingest"],
        env=env,
        capture_output=True, text=True,
        cwd=str(tmp_path),
    )
    assert r.returncode == 0, r.stderr
    out = json.loads(r.stdout)
    assert out["events"] >= 1
    assert out["sessions"] >= 1
