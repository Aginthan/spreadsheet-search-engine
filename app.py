"""
Spreadsheet Search Engine
Loads CSV and Excel files from one or more directories, supports
authenticated access, and provides an admin area for settings and users.
"""

import json
import os
import sqlite3
from functools import wraps

import pandas as pd
from flask import (
    Flask,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configuration
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DATA_DIR = os.path.join(BASE_DIR, "data")
DATA_SOURCES_FILE = os.path.join(BASE_DIR, "data_sources.json")
DATABASE_PATH = os.path.join(BASE_DIR, "app_data.db")
UPLOAD_FOLDER = os.path.join(BASE_DIR, "static", "uploads")
SUPPORTED_EXTENSIONS = (".csv", ".xlsx", ".xls")
ALLOWED_LOGO_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}
DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = os.getenv("APP_DEFAULT_ADMIN_PASSWORD", "admin123")
DEFAULT_SETTINGS = {
    "app_name": "SKA Search Hub",
    "subtitle": "Search structured data across folders, teams, and shared repositories.",
    "results_per_page": "8",
    "logo_filename": "",
}
PANEL_PERMISSION_KEYS = ("can_view_search", "can_view_sources", "can_view_settings", "can_view_users")

app.config.update(
    SECRET_KEY=os.getenv("FLASK_SECRET_KEY", "change-this-secret-before-production"),
    MAX_CONTENT_LENGTH=4 * 1024 * 1024,
    UPLOAD_FOLDER=UPLOAD_FOLDER,
)

# In-memory store: { file_id: { "df": DataFrame, "columns": list, ... } }
spreadsheets = {}
source_directories = []


def normalize_directory_path(path):
    """Normalize a directory path while preserving Windows network share paths."""
    return os.path.normpath(os.path.expandvars(os.path.expanduser(path.strip())))


def ensure_default_data_dir():
    """Create the default local data directory if it does not exist."""
    os.makedirs(DEFAULT_DATA_DIR, exist_ok=True)


def get_connection():
    """Return a sqlite connection with row access by column name."""
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def allowed_logo_file(filename):
    """Check whether an uploaded logo has an allowed extension."""
    _, ext = os.path.splitext(filename.lower())
    return ext in ALLOWED_LOGO_EXTENSIONS


def normalize_results_per_page(value):
    """Clamp results per page to a reasonable range."""
    try:
        page_size = int(value)
    except (TypeError, ValueError):
        page_size = int(DEFAULT_SETTINGS["results_per_page"])
    return max(4, min(page_size, 24))


def init_database():
    """Create database tables and seed defaults."""
    ensure_default_data_dir()
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)

    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                is_admin INTEGER NOT NULL DEFAULT 0,
                can_view_search INTEGER NOT NULL DEFAULT 1,
                can_view_sources INTEGER NOT NULL DEFAULT 0,
                can_view_settings INTEGER NOT NULL DEFAULT 0,
                can_view_users INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        existing_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(users)").fetchall()
        }
        if "can_view_search" not in existing_columns:
            try:
                connection.execute("ALTER TABLE users ADD COLUMN can_view_search INTEGER NOT NULL DEFAULT 1")
            except sqlite3.OperationalError:
                pass
        if "can_view_sources" not in existing_columns:
            try:
                connection.execute("ALTER TABLE users ADD COLUMN can_view_sources INTEGER NOT NULL DEFAULT 0")
            except sqlite3.OperationalError:
                pass
        if "can_view_settings" not in existing_columns:
            try:
                connection.execute("ALTER TABLE users ADD COLUMN can_view_settings INTEGER NOT NULL DEFAULT 0")
            except sqlite3.OperationalError:
                pass
        if "can_view_users" not in existing_columns:
            try:
                connection.execute("ALTER TABLE users ADD COLUMN can_view_users INTEGER NOT NULL DEFAULT 0")
            except sqlite3.OperationalError:
                pass
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )

        for key, value in DEFAULT_SETTINGS.items():
            connection.execute(
                "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
                (key, value),
            )

        user_count = connection.execute(
            "SELECT COUNT(*) AS count FROM users"
        ).fetchone()["count"]

        if user_count == 0:
            connection.execute(
                """
                INSERT INTO users (username, password_hash, is_admin, is_active)
                VALUES (?, ?, 1, 1)
                """,
                (DEFAULT_ADMIN_USERNAME, generate_password_hash(DEFAULT_ADMIN_PASSWORD)),
            )
        else:
            connection.execute(
                """
                UPDATE users
                SET can_view_search = 1,
                    can_view_sources = CASE WHEN is_admin = 1 THEN 1 ELSE can_view_sources END,
                    can_view_settings = CASE WHEN is_admin = 1 THEN 1 ELSE can_view_settings END,
                    can_view_users = CASE WHEN is_admin = 1 THEN 1 ELSE can_view_users END
                """
            )


def get_settings():
    """Return application settings as a dictionary."""
    settings = dict(DEFAULT_SETTINGS)

    with get_connection() as connection:
        rows = connection.execute("SELECT key, value FROM settings").fetchall()

    for row in rows:
        settings[row["key"]] = row["value"]

    settings["results_per_page"] = normalize_results_per_page(settings["results_per_page"])

    logo_filename = settings.get("logo_filename", "")
    logo_path = os.path.join(UPLOAD_FOLDER, logo_filename) if logo_filename else ""
    settings["logo_url"] = (
        url_for("static", filename=f"uploads/{logo_filename}")
        if logo_filename and os.path.exists(logo_path)
        else ""
    )
    return settings


def save_settings(settings):
    """Persist application settings."""
    with get_connection() as connection:
        for key, value in settings.items():
            connection.execute(
                """
                INSERT INTO settings (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (key, str(value)),
            )


def get_user_by_id(user_id):
    """Fetch a user by id."""
    if not user_id:
        return None

    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT id, username, is_admin, can_view_search, can_view_sources, can_view_settings,
                   can_view_users, is_active, created_at
            FROM users
            WHERE id = ?
            """,
            (user_id,),
        ).fetchone()

    return dict(row) if row else None


def get_current_user():
    """Return the currently logged in user from the session."""
    return get_user_by_id(session.get("user_id"))


def get_serialized_user(user):
    """Return only the client-safe parts of a user object."""
    permissions = get_user_permissions(user)
    return {
        "id": user["id"],
        "username": user["username"],
        "is_admin": bool(user["is_admin"]),
        "is_active": bool(user["is_active"]),
        "created_at": user["created_at"],
        "permissions": permissions,
    }


def get_user_permissions(user):
    """Return normalized panel permissions, with admins always fully allowed."""
    if not user:
        return {key: False for key in PANEL_PERMISSION_KEYS}

    if user["is_admin"]:
        return {key: True for key in PANEL_PERMISSION_KEYS}

    return {
        "can_view_search": bool(user.get("can_view_search", 0)),
        "can_view_sources": bool(user.get("can_view_sources", 0)),
        "can_view_settings": bool(user.get("can_view_settings", 0)),
        "can_view_users": bool(user.get("can_view_users", 0)),
    }


def api_error(message, status_code):
    """Return a JSON error payload."""
    return jsonify({"error": message}), status_code


def login_required(view_func):
    """Require an authenticated user."""

    @wraps(view_func)
    def wrapped_view(*args, **kwargs):
        if not get_current_user():
            if request.path.startswith("/api/"):
                return api_error("Authentication required.", 401)
            return redirect(url_for("login"))
        return view_func(*args, **kwargs)

    return wrapped_view


def admin_required(view_func):
    """Require an administrator."""

    @wraps(view_func)
    @login_required
    def wrapped_view(*args, **kwargs):
        current_user = get_current_user()
        if not current_user or not current_user["is_admin"]:
            if request.path.startswith("/api/"):
                return api_error("Administrator access required.", 403)
            flash("Administrator access is required for that page.", "error")
            return redirect(url_for("index"))
        return view_func(*args, **kwargs)

    return wrapped_view


def permission_required(permission_key):
    """Require a specific panel permission, with admin override."""

    def decorator(view_func):
        @wraps(view_func)
        @login_required
        def wrapped_view(*args, **kwargs):
            current_user = get_current_user()
            permissions = get_user_permissions(current_user)
            if permissions.get(permission_key):
                return view_func(*args, **kwargs)
            if request.path.startswith("/api/"):
                return api_error("You do not have access to that panel.", 403)
            flash("You do not have access to that section.", "error")
            return redirect(url_for("index"))

        return wrapped_view

    return decorator


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
                    df = pd.read_excel(filepath, dtype=str, engine="openpyxl").fillna("")

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


def get_filtered_search_scope(selected_files, selected_columns):
    """Yield searchable file info and columns after applying filters."""
    for file_id, info in spreadsheets.items():
        if selected_files and file_id not in selected_files:
            continue

        df = info["df"]
        cols_to_search = selected_columns if selected_columns else info["columns"]
        cols_to_search = [column for column in cols_to_search if column in df.columns]

        if cols_to_search:
            yield info, df, cols_to_search


@app.route("/login", methods=["GET", "POST"])
def login():
    """Render the login page and authenticate users."""
    if get_current_user():
        return redirect(url_for("index"))

    settings = get_settings()

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        with get_connection() as connection:
            user_row = connection.execute(
                "SELECT * FROM users WHERE username = ?",
                (username,),
            ).fetchone()

        if not user_row or not check_password_hash(user_row["password_hash"], password):
            flash("Invalid username or password.", "error")
        elif not user_row["is_active"]:
            flash("This account is disabled. Contact an administrator.", "error")
        else:
            session["user_id"] = user_row["id"]
            return redirect(url_for("index"))

    return render_template(
        "login.html",
        app_settings=settings,
    )


@app.route("/logout", methods=["POST"])
@login_required
def logout():
    """Clear the user session."""
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@login_required
def index():
    """Serve the main frontend page."""
    current_user = get_current_user()
    settings = get_settings()
    return render_template(
        "index.html",
        current_user=get_serialized_user(current_user),
        app_settings=settings,
        current_permissions=get_user_permissions(current_user),
    )


@app.route("/api/session")
@login_required
def get_session_data():
    """Return current user and application settings."""
    return jsonify({
        "user": get_serialized_user(get_current_user()),
        "settings": get_settings(),
    })


@app.route("/api/spreadsheets")
@permission_required("can_view_search")
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
@permission_required("can_view_sources")
def get_directories():
    """Return configured source directories."""
    global source_directories
    if not source_directories:
        source_directories = load_source_directories()
    return jsonify([get_directory_metadata(path) for path in source_directories])


@app.route("/api/directories", methods=["POST"])
@admin_required
def add_directory():
    """Add a source directory and reload spreadsheets."""
    payload = request.get_json(silent=True) or {}
    raw_path = payload.get("path", "")

    if not isinstance(raw_path, str) or not raw_path.strip():
        return api_error("A directory path is required.", 400)

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
        "message": "Source folder added successfully.",
        "directories": [get_directory_metadata(path) for path in source_directories],
        "count": len(spreadsheets),
    })


@app.route("/api/directories", methods=["DELETE"])
@admin_required
def delete_directory():
    """Remove a source directory and reload spreadsheets."""
    payload = request.get_json(silent=True) or {}
    raw_path = payload.get("path", "")

    if not isinstance(raw_path, str) or not raw_path.strip():
        return api_error("A directory path is required.", 400)

    target_path = normalize_directory_path(raw_path)
    directories = load_source_directories()
    directory_keys = {os.path.normcase(path) for path in directories}

    if os.path.normcase(target_path) == os.path.normcase(DEFAULT_DATA_DIR):
        return api_error("The default data directory cannot be removed.", 400)

    if os.path.normcase(target_path) not in directory_keys:
        return api_error("Directory not found.", 404)

    directories = [
        path for path in directories
        if os.path.normcase(path) != os.path.normcase(target_path)
    ]
    save_source_directories(directories)
    load_spreadsheets()

    return jsonify({
        "message": "Source folder removed successfully.",
        "directories": [get_directory_metadata(path) for path in source_directories],
        "count": len(spreadsheets),
    })


@app.route("/api/search")
@permission_required("can_view_search")
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
    selected_columns = [c.strip() for c in selected_columns.split(",") if c.strip()] if selected_columns else []

    selected_files = request.args.get("files", "")
    selected_files = [f.strip() for f in selected_files.split(",") if f.strip()] if selected_files else []

    results = []
    query_lower = query.lower()

    for info, df, cols_to_search in get_filtered_search_scope(selected_files, selected_columns):
        mask = pd.Series([False] * len(df), index=df.index)
        for column in cols_to_search:
            mask = mask | df[column].astype(str).str.lower().str.contains(query_lower, na=False)

        matched_rows = df[mask]

        for _, row in matched_rows.iterrows():
            results.append({
                "source_file": info["filename"],
                "source_directory": info["directory"],
                "source_label": f'{info["filename"]} ({info["directory_label"]})',
                "data": {column: str(row[column]) for column in df.columns},
            })

    return jsonify({
        "results": results,
        "total": len(results),
        "query": query,
    })


@app.route("/api/autocomplete")
@permission_required("can_view_search")
def autocomplete():
    """Return autocomplete suggestions from loaded spreadsheet values."""
    query = request.args.get("q", "").strip()
    if len(query) < 2:
        return jsonify({"suggestions": []})

    selected_columns = request.args.get("columns", "")
    selected_columns = [c.strip() for c in selected_columns.split(",") if c.strip()] if selected_columns else []

    selected_files = request.args.get("files", "")
    selected_files = [f.strip() for f in selected_files.split(",") if f.strip()] if selected_files else []

    query_lower = query.lower()
    seen = set()
    suggestions = []

    for info, df, cols_to_search in get_filtered_search_scope(selected_files, selected_columns):
        for column in cols_to_search:
            series = df[column].astype(str)
            matches = series[series.str.lower().str.contains(query_lower, na=False)].head(8)

            for value in matches:
                cleaned = str(value).strip()
                normalized = cleaned.lower()
                if len(cleaned) < 2 or normalized in seen:
                    continue

                suggestions.append({
                    "value": cleaned,
                    "column": column,
                    "source_file": info["filename"],
                })
                seen.add(normalized)

                if len(suggestions) >= 8:
                    return jsonify({"suggestions": suggestions})

    return jsonify({"suggestions": suggestions})


@app.route("/api/reload", methods=["POST"])
@admin_required
def reload_spreadsheets():
    """Re-scan configured directories and reload all spreadsheets."""
    load_spreadsheets()
    return jsonify({
        "message": "Spreadsheets reloaded successfully.",
        "count": len(spreadsheets),
    })


@app.route("/api/settings", methods=["GET"])
@permission_required("can_view_settings")
def get_app_settings():
    """Return current application settings."""
    return jsonify(get_settings())


@app.route("/api/settings", methods=["POST"])
@permission_required("can_view_settings")
def update_app_settings():
    """Update application settings and optionally upload a logo."""
    current_settings = get_settings()
    app_name = request.form.get("app_name", current_settings["app_name"]).strip()
    subtitle = request.form.get("subtitle", current_settings["subtitle"]).strip()
    results_per_page = normalize_results_per_page(
        request.form.get("results_per_page", current_settings["results_per_page"])
    )

    if not app_name:
        return api_error("Application name is required.", 400)

    updated_settings = {
        "app_name": app_name,
        "subtitle": subtitle or DEFAULT_SETTINGS["subtitle"],
        "results_per_page": results_per_page,
        "logo_filename": current_settings.get("logo_filename", ""),
    }

    logo_file = request.files.get("logo")
    if logo_file and logo_file.filename:
        if not allowed_logo_file(logo_file.filename):
            return api_error("Logo must be a PNG, JPG, JPEG, GIF, SVG, or WEBP file.", 400)

        _, extension = os.path.splitext(secure_filename(logo_file.filename))
        logo_filename = f"app-logo{extension.lower()}"

        for existing_name in os.listdir(UPLOAD_FOLDER):
            if existing_name.startswith("app-logo"):
                try:
                    os.remove(os.path.join(UPLOAD_FOLDER, existing_name))
                except OSError:
                    pass

        logo_file.save(os.path.join(UPLOAD_FOLDER, logo_filename))
        updated_settings["logo_filename"] = logo_filename

    save_settings(updated_settings)
    return jsonify({
        "message": "Settings updated successfully.",
        "settings": get_settings(),
    })


@app.route("/api/users", methods=["GET"])
@permission_required("can_view_users")
def get_users():
    """Return the list of users for administration."""
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, username, is_admin, can_view_search, can_view_sources, can_view_settings,
                   can_view_users, is_active, created_at
            FROM users
            ORDER BY username ASC
            """
        ).fetchall()

    return jsonify([get_serialized_user(dict(row)) for row in rows])


@app.route("/api/users", methods=["POST"])
@permission_required("can_view_users")
def create_user():
    """Create a new user account."""
    payload = request.get_json(silent=True) or {}
    username = payload.get("username", "").strip()
    password = payload.get("password", "")
    is_admin = bool(payload.get("is_admin", False))
    permissions = payload.get("permissions", {}) if isinstance(payload.get("permissions", {}), dict) else {}

    can_view_search = bool(permissions.get("can_view_search", True))
    can_view_sources = bool(permissions.get("can_view_sources", False))
    can_view_settings = bool(permissions.get("can_view_settings", False))
    can_view_users = bool(permissions.get("can_view_users", False))

    if is_admin:
        can_view_search = True
        can_view_sources = True
        can_view_settings = True
        can_view_users = True

    if len(username) < 3:
        return api_error("Username must be at least 3 characters long.", 400)

    if len(password) < 6:
        return api_error("Password must be at least 6 characters long.", 400)

    try:
        with get_connection() as connection:
            connection.execute(
                """
                INSERT INTO users (
                    username, password_hash, is_admin, can_view_search, can_view_sources,
                    can_view_settings, can_view_users, is_active
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 1)
                """,
                (
                    username,
                    generate_password_hash(password),
                    int(is_admin),
                    int(can_view_search),
                    int(can_view_sources),
                    int(can_view_settings),
                    int(can_view_users),
                ),
            )
    except sqlite3.IntegrityError:
        return api_error("That username already exists.", 409)

    return jsonify({"message": "User account created successfully."}), 201


# --------------- Startup ---------------

init_database()
load_spreadsheets()

if __name__ == "__main__":
    print("\nSKA Search Hub")
    print(f"Default data directory: {DEFAULT_DATA_DIR}")
    print(f"Source config file: {DATA_SOURCES_FILE}")
    print(f"Database: {DATABASE_PATH}")
    print(f"Default admin username: {DEFAULT_ADMIN_USERNAME}")
    print("Loading spreadsheets...")
    load_spreadsheets()
    app.run(debug=True, host="0.0.0.0", port=5555)
