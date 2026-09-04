#!/usr/bin/env python3
"""
Verifies the project's required files are present and well-formed before
the download/build/validate pipeline runs. Fails fast with a clear error
rather than letting a missing file surface as a confusing failure deep
in build_data.py.
"""

import json
import os
import sys

REQUIRED_FILES = [
    "app/page.jsx",
    "app/DashboardBoot.jsx",
    "next.config.mjs",
    "public/js/app.js",
    "public/js/calc.js",
    "public/js/config.js",
    "public/js/data-loader.js",
    "public/js/engine.js",
    "public/js/ui.js",
    "public/js/views.js",
    "public/js/table-search.js",
    "public/js/pdf-export.js",
    "public/js/xlsx-writer.js",
    "scripts/calc.py",
    "scripts/model.py",
    "scripts/build_data.py",
    "scripts/download_drive_data.py",
    "scripts/validate_build.py",
    "scripts/preflight.py",
    "scripts/tests/test_model.py",
    "data/config.json",
    "data/drive_source.json",
]


def main():
    missing = [f for f in REQUIRED_FILES if not os.path.exists(f)]
    if missing:
        for f in missing:
            print(f"::error file={f}::Required project file is missing: {f}")
        sys.exit(2)

    for path in ("data/config.json", "data/drive_source.json"):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                json.load(fh)
        except json.JSONDecodeError as e:
            sys.exit(f"ERROR: {path} is not valid JSON: {e}")

    with open("scripts/build_data.py", "r", encoding="utf-8") as fh:
        build_script = fh.read()
    if 'OUTPUT_PATH = "public/' not in build_script:
        sys.exit(
            "ERROR: scripts/build_data.py must write its output under public/ "
            "so Next.js's static export serves it. Check OUTPUT_PATH."
        )

    with open("data/drive_source.json", "r", encoding="utf-8") as fh:
        drive_source = json.load(fh)
    if not drive_source.get("folderId"):
        sys.exit("ERROR: data/drive_source.json is missing 'folderId'.")
    files = drive_source.get("files") or {}
    required_sources = {"classification", "stock", "sales", "zone", "ecom"}
    missing_sources = required_sources - set(files.keys())
    if missing_sources:
        sys.exit(
            "ERROR: data/drive_source.json 'files' is missing entries for: "
            + ", ".join(sorted(missing_sources))
        )
    for source, meta in files.items():
        if not meta.get("driveName") or not meta.get("destName"):
            sys.exit(f"ERROR: data/drive_source.json 'files.{source}' needs both driveName and destName.")

    # KVI Outlet mapping (change log Section 8-10) is additive/optional --
    # warn rather than fail if it's missing from config, since a build can
    # still succeed without it (every outlet.kvi defaults to False).
    if "kviOutlet" not in files:
        print("::warning::data/drive_source.json has no 'kviOutlet' entry -- "
              "KVI Outlet filtering and the KVI KPI card will show no KVI outlets "
              "until this is configured.")

    print("All required project files are present and source config is valid.")


if __name__ == "__main__":
    main()
