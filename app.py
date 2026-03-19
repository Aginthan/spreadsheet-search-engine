"""
Spreadsheet Search Engine
Loads CSV and Excel files from one or more directories and provides
a web interface to search across them by specific columns.
"""

import json
import os

import pandas as pd
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

# Configuration
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DATA_DIR = os.path.join(BASE_DIR, "data")
DATA_SOURCES_FILE = os.path.join(BASE_DIR, "data_sources.json")
SUPPORTED_EXTENSIONS = (".csv", ".xlsx", ".xls")

# In-memory store: { file_id: { "df": DataFrame, "columns": list, ... } }
spreadsheets = {}
source_directories = []


def normalize_directory_path(path):
    """Normalize a directory path while preserving Windows network share paths."""
    return os.path.normpath(os.path.expandvars(os.path.expanduser(path.strip())))


def ensure_default_data_dir():
    """Create the default local data directory if it does not exist."""
    os.makedirs(DEFAULT_DATA_DIR, exist_ok=True)


def load_source_directories():
    """Load configured source directories from disk."""
    ensure_default_data_dir()

    if not os.path.exists(DATA_SOURCES_FILE):
        return [DEFAULT_DATA_DIR]

    try:
        with open(DATA_SOURCES_FILE, "r", encoding="utf-8") as file:
            payload = json.load(file)
    except (OSError, json.JSONDecodeError):
        return [DEFAULT_DATA_DIR]

    configured_paths = payload.get("directories", [])
    normalized_paths = []
    seen = set()
    default_key = os.path.normcase(DEFAULT_DATA_DIR)

    for path in configured_paths:
        if not isinstance(path, str) or not path.strip():
            continue
        normalized = normalize_directory_path(path)
        normalized_key = os.path.normcase(normalized)
        if normalized_key not in seen:
            normalized_paths.append(normalized)
            seen.add(normalized_key)

    if default_key not in seen:
        normalized_paths.insert(0, DEFAULT_DATA_DIR)

    return normalized_paths


def save_source_directories(directories):
    """Persist source directories to disk."""
    with open(DATA_SOURCES_FILE, "w", encoding="utf-8") as file:
        json.dump({"directories": directories}, file, indent=2)


def get_directory_metadata(path):
    """Return consistent metadata for a configured directory."""
    exists = os.path.isdir(path)
    return {
        "path": path,
        "label": os.path.basename(path.rstrip("\\/")) or path,
        "exists": exists,
        "type": "network" if path.startswith("\\\\") else "local",
        "is_default": os.path.normcase(path) == os.path.normcase(DEFAULT_DATA_DIR),
    }


def load_spreadsheets():
    """Scan all configured directories and load CSV/Excel files into memory."""
    global spreadsheets, source_directories
    spreadsheets = {}
    source_directories = load_source_directories()

    print("\nConfigured source directories:")
    for directory in source_directories:
        metadata = get_directory_metadata(directory)
        status = "available" if metadata["exists"] else "missing"
        print(f"  - {directory} [{status}]")

    for directory in source_directories:
        if not os.path.isdir(directory):
            print(f"  ! Skipping missing directory: {directory}")
            continue

        for filename in sorted(os.listdir(directory)):
            filepath = os.path.join(directory, filename)
            if not os.path.isfile(filepath) or not filename.lower().endswith(SUPPORTED_EXTENSIONS):
                continue

            try:
                if filename.lower().endswith(".csv"):
                    df = pd.read_csv(filepath, dtype=str).fillna("")
                else:
                    df = pd.read_excel(filepath, dtype=str,
                                       engine="openpyxl").fillna("")

                file_id = filepath
                spreadsheets[file_id] = {
                    "id": file_id,
                    "filepath": filepath,
                    "filename": filename,
                    "directory": directory,
                    "directory_label": get_directory_metadata(directory)["label"],
                    "df": df,
                    "columns": list(df.columns),
                }
                print(
                    f"  ✓ Loaded {filename} from {directory} "
                    f"({len(df)} rows, {len(df.columns)} columns)"
                )
            except Exception as error:
                print(f"  ✗ Failed to load {filepath}: {error}")

    print(f"\nTotal: {len(spreadsheets)} spreadsheet(s) loaded.\n")


# --------------- Routes ---------------

@app.route("/")
def index():
    """Serve the main frontend page."""
    return render_template("index.html")


@app.route("/api/spreadsheets")
def get_spreadsheets():
    """Return metadata about all loaded spreadsheets."""
    result = []
    for info in spreadsheets.values():
        result.append({
            "id": info["id"],
            "filename": info["filename"],
            "filepath": info["filepath"],
            "directory": info["directory"],
            "directory_label": info["directory_label"],
            "columns": info["columns"],
            "row_count": len(info["df"]),
        })
    return jsonify(result)


@app.route("/api/directories")
def get_directories():
    """Return configured source directories."""
    global source_directories
    if not source_directories:
        source_directories = load_source_directories()
    return jsonify([get_directory_metadata(path) for path in source_directories])


@app.route("/api/directories", methods=["POST"])
def add_directory():
    """Add a source directory and reload spreadsheets."""
    payload = request.get_json(silent=True) or {}
    raw_path = payload.get("path", "")

    if not isinstance(raw_path, str) or not raw_path.strip():
        return jsonify({"error": "A directory path is required."}), 400

    new_path = normalize_directory_path(raw_path)
    directories = load_source_directories()
    directory_keys = {os.path.normcase(path) for path in directories}

    if os.path.normcase(new_path) in directory_keys:
        load_spreadsheets()
        return jsonify({
            "message": "Directory already configured.",
            "directories": [get_directory_metadata(path) for path in source_directories],
            "count": len(spreadsheets),
        })

    directories.append(new_path)
    save_source_directories(directories)
    load_spreadsheets()

    return jsonify({
        "message": "Directory added successfully.",
        "directories": [get_directory_metadata(path) for path in source_directories],
        "count": len(spreadsheets),
    })


@app.route("/api/directories", methods=["DELETE"])
def delete_directory():
    """Remove a source directory and reload spreadsheets."""
    payload = request.get_json(silent=True) or {}
    raw_path = payload.get("path", "")

    if not isinstance(raw_path, str) or not raw_path.strip():
        return jsonify({"error": "A directory path is required."}), 400

    target_path = normalize_directory_path(raw_path)
    directories = load_source_directories()
    directory_keys = {os.path.normcase(path) for path in directories}

    if os.path.normcase(target_path) == os.path.normcase(DEFAULT_DATA_DIR):
        return jsonify({"error": "The default data directory cannot be removed."}), 400

    if os.path.normcase(target_path) not in directory_keys:
        return jsonify({"error": "Directory not found."}), 404

    directories = [path for path in directories if os.path.normcase(
        path) != os.path.normcase(target_path)]
    save_source_directories(directories)
    load_spreadsheets()

    return jsonify({
        "message": "Directory removed successfully.",
        "directories": [get_directory_metadata(path) for path in source_directories],
        "count": len(spreadsheets),
    })


@app.route("/api/search")
def search():
    """
    Search across spreadsheets.
    Query params:
      q       - search term (required)
      columns - comma-separated column names to search in (optional, defaults to all)
      files   - comma-separated file ids to search in (optional, defaults to all)
    """
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"results": [], "total": 0, "query": ""})

    selected_columns = request.args.get("columns", "")
    selected_columns = [c.strip() for c in selected_columns.split(
        ",") if c.strip()] if selected_columns else []

    selected_files = request.args.get("files", "")
    selected_files = [f.strip() for f in selected_files.split(
        ",") if f.strip()] if selected_files else []

    results = []
    query_lower = query.lower()

    for file_id, info in spreadsheets.items():
        # Filter by selected files
        if selected_files and file_id not in selected_files:
            continue

        df = info["df"]

        # Determine which columns to search
        cols_to_search = selected_columns if selected_columns else info["columns"]
        # Only use columns that exist in this file
        cols_to_search = [c for c in cols_to_search if c in df.columns]

        if not cols_to_search:
            continue

        # Build a boolean mask: True if any selected column contains the query
        mask = pd.Series([False] * len(df), index=df.index)
        for col in cols_to_search:
            mask = mask | df[col].astype(
                str).str.lower().str.contains(query_lower, na=False)

        matched_rows = df[mask]

        for _, row in matched_rows.iterrows():
            results.append({
                "source_file": info["filename"],
                "source_directory": info["directory"],
                "source_label": f'{info["filename"]} ({info["directory_label"]})',
                "data": {col: str(row[col]) for col in df.columns},
            })

    return jsonify({
        "results": results,
        "total": len(results),
        "query": query,
    })


@app.route("/api/reload", methods=["POST"])
def reload_spreadsheets():
    """Re-scan configured directories and reload all spreadsheets."""
    load_spreadsheets()
    return jsonify({
        "message": "Spreadsheets reloaded successfully.",
        "count": len(spreadsheets),
    })


# --------------- Startup ---------------

load_spreadsheets()

if __name__ == "__main__":
    print("\n📊 Spreadsheet Search Engine")
    print(f"📁 Default data directory: {DEFAULT_DATA_DIR}")
    print(f"🗂️  Source config file: {DATA_SOURCES_FILE}\n")
    print("Loading spreadsheets...")
    load_spreadsheets()
    app.run(debug=True, host="0.0.0.0", port=5555)
