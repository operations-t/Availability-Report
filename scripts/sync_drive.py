import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

FOLDER_URL = os.environ.get(
    "GOOGLE_DRIVE_FOLDER_URL",
    "https://drive.google.com/drive/folders/1OiccpJ7WLxYVBSn6Gw9DMacK2ds0wW4j?usp=sharing",
).strip()
AVAIL_NAME = os.environ.get("GOOGLE_DRIVE_TARGET_FILENAME", "Availability Report.xlsx").strip()
STOCK_NAME = os.environ.get("GOOGLE_DRIVE_STOCK_FILENAME", "Stock.xlsx").strip()

OUT_DIR = Path("raw")
OUT_DIR.mkdir(exist_ok=True)
AVAIL_FILE = OUT_DIR / "Availability Report.xlsx"
STOCK_FILE = OUT_DIR / "Stock.xlsx"
META_FILE = OUT_DIR / "source_meta.json"


def run(cmd):
    p = subprocess.run(cmd, text=True, capture_output=True)
    if p.returncode != 0:
        sys.stderr.write(p.stdout)
        sys.stderr.write(p.stderr)
        raise SystemExit(f"Command failed ({p.returncode}): {' '.join(cmd)}")
    return p.stdout


# gdown 6.x can list a public Drive folder as JSON without Google API credentials.
raw = run(["gdown", FOLDER_URL, "--folder", "--json", "--quiet", "--no-cookies"])
try:
    entries = json.loads(raw)
except json.JSONDecodeError as exc:
    print(raw)
    raise SystemExit(f"Could not parse Google Drive folder listing: {exc}")

if not isinstance(entries, list):
    raise SystemExit("Unexpected Google Drive folder listing format.")

files = []
for item in entries:
    if not isinstance(item, dict):
        continue
    path = str(item.get("path") or "").strip()
    url = str(item.get("url") or "").strip()
    name = PurePosixPath(path).name
    if url and name.lower().endswith(".xlsx") and not name.startswith("~$"):
        files.append({"name": name, "path": path, "url": url})


def select_exact(target):
    matches = [f for f in files if f["name"].casefold() == target.casefold()]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        names = "\n - ".join(f["path"] for f in matches)
        raise SystemExit(f"More than one '{target}' was found. Keep only one live file.\n - {names}")
    available = "\n - ".join(f["path"] for f in files) if files else "(no .xlsx files found)"
    raise SystemExit(
        f"Required workbook '{target}' was not found in the public Drive folder.\n"
        f"Available .xlsx files:\n - {available}"
    )


selected_avail = select_exact(AVAIL_NAME)
selected_stock = select_exact(STOCK_NAME)

for selected, out_file in ((selected_avail, AVAIL_FILE), (selected_stock, STOCK_FILE)):
    if out_file.exists():
        out_file.unlink()
    run(["gdown", selected["url"], "-O", str(out_file), "--quiet", "--no-cookies"])
    if not out_file.exists() or out_file.stat().st_size < 1000:
        raise SystemExit(f"Download failed or produced an unexpectedly small file: {selected['name']}")
    print(f"Downloaded {selected['path']} -> {out_file} ({out_file.stat().st_size:,} bytes)")

retrieved_at = datetime.now(timezone.utc).isoformat()
META_FILE.write_text(
    json.dumps(
        {
            "availability": {"name": selected_avail["name"], "path": selected_avail["path"]},
            "stock": {"name": selected_stock["name"], "path": selected_stock["path"]},
            "modifiedTime": retrieved_at,
            "retrievedAt": retrieved_at,
            "folderUrl": FOLDER_URL,
            "mode": "public-folder-no-api-two-file",
        },
        indent=2,
    ),
    encoding="utf-8",
)
