#!/usr/bin/env python3
"""
Downloads the five production workbooks from the Google Drive folder
configured in data/drive_source.json, using gdown. No Google Cloud API
key is required -- gdown works against a folder shared as "Anyone with
the link" by downloading through Drive's public folder-listing and
download endpoints directly.

gdown.download_folder(url, ...) downloads every file in the folder into
output_dir and returns a list of the local file paths it wrote. This
script then matches those paths (by original filename) against the
expected Drive filenames configured in drive_source.json, and copies/
renames each into data/downloads/<destName> so build_data.py always
reads from stable, predictable paths.
"""

import json
import os
import shutil
import sys

import gdown

DRIVE_SOURCE_PATH = "data/drive_source.json"
RAW_DOWNLOAD_DIR = "data/downloads/_raw"
DOWNLOAD_DIR = "data/downloads"


def load_drive_source():
    if not os.path.exists(DRIVE_SOURCE_PATH):
        sys.exit(f"ERROR: {DRIVE_SOURCE_PATH} not found.")
    with open(DRIVE_SOURCE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def main():
    cfg = load_drive_source()
    folder_id = cfg.get("folderId")
    files = cfg.get("files") or {}
    if not folder_id:
        sys.exit(f"ERROR: {DRIVE_SOURCE_PATH} is missing 'folderId'.")
    if not files:
        sys.exit(f"ERROR: {DRIVE_SOURCE_PATH} is missing the 'files' map.")

    if os.path.exists(RAW_DOWNLOAD_DIR):
        shutil.rmtree(RAW_DOWNLOAD_DIR)
    os.makedirs(RAW_DOWNLOAD_DIR, exist_ok=True)
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)

    folder_url = f"https://drive.google.com/drive/folders/{folder_id}"
    print(f"Downloading Drive folder {folder_id} ...")
    try:
        downloaded_paths = gdown.download_folder(
            url=folder_url, output=RAW_DOWNLOAD_DIR, quiet=False, use_cookies=False,
        )
    except Exception as e:  # noqa: BLE001
        sys.exit(
            "ERROR: could not download the Google Drive folder. Confirm it is "
            f"shared as \"Anyone with the link\" and the folder ID is correct. "
            f"Details: {e}"
        )

    if not downloaded_paths:
        sys.exit(
            "ERROR: the Drive folder download returned no files. Confirm the "
            "folder ID is correct, the folder is shared as \"Anyone with the "
            "link\", and it actually contains files (not just subfolders)."
        )

    by_basename = {os.path.basename(p): p for p in downloaded_paths}

    missing = []
    downloaded = []
    for source, meta in files.items():
        drive_name = meta["driveName"]
        dest_name = meta["destName"]
        is_optional = bool(meta.get("optional"))
        dest_path = os.path.join(DOWNLOAD_DIR, dest_name)

        src_path = by_basename.get(drive_name)
        matched_name = drive_name
        if not src_path:
            # Fallback: try a space<->underscore variant of the expected
            # name, since the KVI Outlet source file's exact naming
            # (space vs underscore) was unconfirmed at build time.
            variant = drive_name.replace(" ", "_") if " " in drive_name else drive_name.replace("_", " ")
            src_path = by_basename.get(variant)
            matched_name = variant if src_path else drive_name

        if not src_path or not os.path.exists(src_path):
            if is_optional:
                print(f"  NOTE: optional file '{drive_name}' (or '{drive_name.replace(' ', '_')}') "
                      f"not found in Drive folder -- continuing without it.")
                continue
            missing.append(drive_name)
            continue

        shutil.copyfile(src_path, dest_path)
        print(f"  {matched_name} -> {dest_path}")
        downloaded.append(dest_path)

    if missing:
        print("ERROR: the following expected files were not found in the Drive folder:")
        for name in missing:
            print(f"  - {name}")
        print("Files actually found in the folder:")
        for name in sorted(by_basename.keys()):
            print(f"  - {name}")
        sys.exit(1)

    print(f"Downloaded {len(downloaded)}/{len(files)} file(s) into {DOWNLOAD_DIR}/")


if __name__ == "__main__":
    main()
