"""
Spreadsheet Search Engine
Loads CSV and Excel files from a data directory and provides
a web interface to search across them by specific columns.
"""

import os
import pandas as pd
from flask import Flask, render_template, jsonify, request

app = Flask(__name__)

# Configuration
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")

# In-memory store: { filename: { "df": DataFrame, "columns": list } }
spreadsheets = {}


def load_spreadsheets():
    """Scan the data directory and load all CSV/Excel files into memory."""
    global spreadsheets
    spreadsheets = {}

    if not os.path.exists(DATA_DIR):
        os.makedirs(DATA_DIR)
        return

    for filename in os.listdir(DATA_DIR):
        filepath = os.path.join(DATA_DIR, filename)
        if not os.path.isfile(filepath):
            continue

        try:
            if filename.lower().endswith(".csv"):
                df = pd.read_csv(filepath, dtype=str).fillna("")
            elif filename.lower().endswith((".xlsx", ".xls")):
                df = pd.read_excel(filepath, dtype=str, engine="openpyxl").fillna("")
            else:
                continue

            spreadsheets[filename] = {
                "df": df,
                "columns": list(df.columns),
            }
            print(f"  ✓ Loaded {filename} ({len(df)} rows, {len(df.columns)} columns)")
        except Exception as e:
            print(f"  ✗ Failed to load {filename}: {e}")

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
    for filename, info in spreadsheets.items():
        result.append({
            "filename": filename,
            "columns": info["columns"],
            "row_count": len(info["df"]),
        })
    return jsonify(result)


@app.route("/api/search")
def search():
    """
    Search across spreadsheets.
    Query params:
      q       - search term (required)
      columns - comma-separated column names to search in (optional, defaults to all)
      files   - comma-separated filenames to search in (optional, defaults to all)
    """
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"results": [], "total": 0, "query": ""})

    selected_columns = request.args.get("columns", "")
    selected_columns = [c.strip() for c in selected_columns.split(",") if c.strip()] if selected_columns else []

    selected_files = request.args.get("files", "")
    selected_files = [f.strip() for f in selected_files.split(",") if f.strip()] if selected_files else []

    results = []
    query_lower = query.lower()

    for filename, info in spreadsheets.items():
        # Filter by selected files
        if selected_files and filename not in selected_files:
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
            mask = mask | df[col].astype(str).str.lower().str.contains(query_lower, na=False)

        matched_rows = df[mask]

        for _, row in matched_rows.iterrows():
            results.append({
                "source_file": filename,
                "data": {col: str(row[col]) for col in df.columns},
            })

    return jsonify({
        "results": results,
        "total": len(results),
        "query": query,
    })


@app.route("/api/reload", methods=["POST"])
def reload_spreadsheets():
    """Re-scan the data directory and reload all spreadsheets."""
    load_spreadsheets()
    return jsonify({
        "message": "Spreadsheets reloaded successfully.",
        "count": len(spreadsheets),
    })


# --------------- Startup ---------------

if __name__ == "__main__":
    print("\n📊 Spreadsheet Search Engine")
    print(f"📁 Data directory: {DATA_DIR}\n")
    print("Loading spreadsheets...")
    load_spreadsheets()
    app.run(debug=True, host="0.0.0.0", port=5000)
