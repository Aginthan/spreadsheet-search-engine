"""
Xcelerate
Search CSV and Excel files from multiple folders with authentication,
admin controls, and a PostgreSQL-ready SQLAlchemy data layer.
"""

from __future__ import annotations

import json
import os
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from io import BytesIO
from functools import wraps

import pandas as pd
from flask import (
    Flask,
    flash,
    jsonify,
    redirect,
    render_template,
    request,
    send_file,
    session,
    url_for,
)
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Image as ReportLabImage,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy import (
    Column,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    inspect,
    select,
    text,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import (
    declarative_base,
    relationship,
    scoped_session,
    sessionmaker,
)
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DATA_DIR = os.path.join(BASE_DIR, "data")
DATA_SOURCES_FILE = os.path.join(BASE_DIR, "data_sources.json")
DATABASE_PATH = os.path.join(BASE_DIR, "app_data.db")
UPLOAD_FOLDER = os.path.join(BASE_DIR, "static", "uploads")
SUPPORTED_EXTENSIONS = (".csv", ".xlsx", ".xls")
ALLOWED_LOGO_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"}
DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = os.getenv("APP_DEFAULT_ADMIN_PASSWORD", "admin123")
DEFAULT_DATABASE_URL = f"sqlite:///{DATABASE_PATH}"
PANEL_PERMISSION_KEYS = ("can_view_search", "can_view_sources", "can_view_settings", "can_view_users")
DEFAULT_SETTINGS = {
    "app_name": "Xcelerate",
    "subtitle": "Search structured data across folders, teams, and shared repositories.",
    "results_per_page": "8",
    "logo_filename": "",
    "idle_timeout_minutes": "30",
    "theme_preset": "emerald",
}
THEME_PRESETS = {"emerald", "ocean", "slate"}

raw_database_url = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
DATABASE_URL = (
    raw_database_url.replace("postgres://", "postgresql://", 1)
    if raw_database_url.startswith("postgres://")
    else raw_database_url
)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, future=True, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = scoped_session(sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True))
Base = declarative_base()

app.config.update(
    SECRET_KEY=os.getenv("FLASK_SECRET_KEY", "change-this-secret-before-production"),
    MAX_CONTENT_LENGTH=4 * 1024 * 1024,
    UPLOAD_FOLDER=UPLOAD_FOLDER,
    DATABASE_URL=DATABASE_URL,
)

spreadsheets = {}
source_directories = []


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(String(120), nullable=False, unique=True)
    password_hash = Column(String(255), nullable=False)
    is_admin = Column(Boolean, nullable=False, default=False)
    can_view_search = Column(Boolean, nullable=False, default=True)
    can_view_sources = Column(Boolean, nullable=False, default=False)
    can_view_settings = Column(Boolean, nullable=False, default=False)
    can_view_users = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class Setting(Base):
    __tablename__ = "settings"

    key = Column(String(120), primary_key=True)
    value = Column(Text, nullable=False)


class SavedSearch(Base):
    __tablename__ = "saved_searches"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String(160), nullable=False)
    query = Column(Text, nullable=False)
    selected_files = Column(Text, nullable=False, default="[]")
    selected_columns = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    user = relationship("User")


class SearchHistory(Base):
    __tablename__ = "search_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    query = Column(Text, nullable=False)
    selected_files = Column(Text, nullable=False, default="[]")
    selected_columns = Column(Text, nullable=False, default="[]")
    result_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    user = relationship("User")


class FavoriteFile(Base):
    __tablename__ = "favorite_files"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    file_id = Column(Text, nullable=False)
    filename = Column(String(260), nullable=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    user = relationship("User")


class HeaderOverride(Base):
    __tablename__ = "header_overrides"

    id = Column(Integer, primary_key=True, autoincrement=True)
    file_id = Column(Text, nullable=False, unique=True)
    file_path = Column(Text, nullable=False)
    filename = Column(String(260), nullable=False)
    header_row = Column(Integer, nullable=False)
    updated_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    updated_by = relationship("User")


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    actor_user_id = Column(Integer, nullable=True)
    actor_username = Column(String(120), nullable=False)
    action = Column(String(120), nullable=False)
    entity_type = Column(String(120), nullable=False)
    entity_id = Column(Text, nullable=True)
    details = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


def normalize_directory_path(path):
    return os.path.normpath(os.path.expandvars(os.path.expanduser(path.strip())))


def normalize_results_per_page(value):
    try:
        page_size = int(value)
    except (TypeError, ValueError):
        page_size = int(DEFAULT_SETTINGS["results_per_page"])
    return max(4, min(page_size, 24))


def normalize_idle_timeout(value):
    try:
        minutes = int(value)
    except (TypeError, ValueError):
        minutes = int(DEFAULT_SETTINGS["idle_timeout_minutes"])
    return max(5, min(minutes, 480))


def normalize_theme_preset(value):
    preset = str(value or DEFAULT_SETTINGS["theme_preset"]).strip().lower()
    return preset if preset in THEME_PRESETS else DEFAULT_SETTINGS["theme_preset"]


def allowed_logo_file(filename):
    _, ext = os.path.splitext(filename.lower())
    return ext in ALLOWED_LOGO_EXTENSIONS


def utc_now():
    return datetime.now(timezone.utc)


def serialize_timestamp(value):
    if not value:
        return ""
    if isinstance(value, str):
        return value
    return value.strftime("%Y-%m-%d %H:%M:%S")


def dump_json(value):
    return json.dumps(value or [])


def load_json_array(value):
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return []
    return parsed if isinstance(parsed, list) else []


@contextmanager
def session_scope():
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


@app.teardown_appcontext
def remove_session(_exception=None):
    SessionLocal.remove()


def ensure_default_data_dir():
    os.makedirs(DEFAULT_DATA_DIR, exist_ok=True)
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)


def ensure_legacy_columns():
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return

    columns = {column["name"] for column in inspector.get_columns("users")}
    dialect = engine.dialect.name
    boolean_type = "BOOLEAN" if dialect != "sqlite" else "INTEGER"
    timestamp_default = "CURRENT_TIMESTAMP"
    column_ddl = {
        "can_view_search": f"{boolean_type} NOT NULL DEFAULT 1",
        "can_view_sources": f"{boolean_type} NOT NULL DEFAULT 0",
        "can_view_settings": f"{boolean_type} NOT NULL DEFAULT 0",
        "can_view_users": f"{boolean_type} NOT NULL DEFAULT 0",
        "is_active": f"{boolean_type} NOT NULL DEFAULT 1",
        "created_at": f"DATETIME NOT NULL DEFAULT {timestamp_default}",
    }

    with engine.begin() as connection:
        for name, ddl in column_ddl.items():
            if name in columns:
                continue
            connection.execute(text(f"ALTER TABLE users ADD COLUMN {name} {ddl}"))


def bootstrap_database():
    ensure_default_data_dir()
    Base.metadata.create_all(engine)
    ensure_legacy_columns()

    with session_scope() as db:
        for key, value in DEFAULT_SETTINGS.items():
            if not db.get(Setting, key):
                db.add(Setting(key=key, value=str(value)))

        admin = db.execute(select(User).order_by(User.id.asc())).scalars().first()
        if not admin:
            db.add(
                User(
                    username=DEFAULT_ADMIN_USERNAME,
                    password_hash=generate_password_hash(DEFAULT_ADMIN_PASSWORD),
                    is_admin=True,
                    can_view_search=True,
                    can_view_sources=True,
                    can_view_settings=True,
                    can_view_users=True,
                    is_active=True,
                )
            )
        else:
            admins = db.execute(select(User).where(User.is_admin.is_(True))).scalars().all()
            for user in admins:
                user.can_view_search = True
                user.can_view_sources = True
                user.can_view_settings = True
                user.can_view_users = True


def get_settings_dict(db=None):
    should_close = db is None
    db = db or SessionLocal()
    try:
        settings = dict(DEFAULT_SETTINGS)
        rows = db.execute(select(Setting)).scalars().all()
        for row in rows:
            settings[row.key] = row.value
        settings["results_per_page"] = normalize_results_per_page(settings.get("results_per_page"))
        settings["idle_timeout_minutes"] = normalize_idle_timeout(settings.get("idle_timeout_minutes"))
        settings["theme_preset"] = normalize_theme_preset(settings.get("theme_preset"))

        logo_filename = settings.get("logo_filename", "")
        logo_path = os.path.join(UPLOAD_FOLDER, logo_filename) if logo_filename else ""
        settings["logo_url"] = (
            url_for("static", filename=f"uploads/{logo_filename}")
            if logo_filename and os.path.exists(logo_path)
            else ""
        )
        return settings
    finally:
        if should_close:
            db.close()


def save_settings_map(db, payload):
    for key, value in payload.items():
        setting = db.get(Setting, key)
        if not setting:
            db.add(Setting(key=key, value=str(value)))
        else:
            setting.value = str(value)


def get_user_by_id(user_id):
    if not user_id:
        return None
    with session_scope() as db:
        user = db.get(User, user_id)
        if not user or not user.is_active:
            return None
        return user


def get_current_user():
    return get_user_by_id(session.get("user_id"))


def get_user_permissions(user):
    if not user:
        return {key: False for key in PANEL_PERMISSION_KEYS}
    if user.is_admin:
        return {key: True for key in PANEL_PERMISSION_KEYS}
    return {
        "can_view_search": bool(user.can_view_search),
        "can_view_sources": bool(user.can_view_sources),
        "can_view_settings": bool(user.can_view_settings),
        "can_view_users": bool(user.can_view_users),
    }


def get_serialized_user(user):
    if not user:
        return None
    return {
        "id": user.id,
        "username": user.username,
        "is_admin": bool(user.is_admin),
        "is_active": bool(user.is_active),
        "created_at": serialize_timestamp(user.created_at),
        "permissions": get_user_permissions(user),
    }


def api_error(message, status_code):
    return jsonify({"error": message}), status_code


def record_audit(action, entity_type, entity_id=None, details=None, actor=None, db=None):
    if not actor or not actor.is_admin:
        return
    owns_session = db is None
    db = db or SessionLocal()
    try:
        db.add(
            AuditLog(
                actor_user_id=actor.id,
                actor_username=actor.username,
                action=action,
                entity_type=entity_type,
                entity_id=entity_id,
                details=json.dumps(details or {}, default=str),
            )
        )
        if owns_session:
            db.commit()
    finally:
        if owns_session:
            db.close()


@app.before_request
def enforce_idle_timeout():
    if request.endpoint == "static":
        return None

    user_id = session.get("user_id")
    if not user_id:
        return None

    current_user = get_current_user()
    if not current_user:
        session.clear()
        if request.path.startswith("/api/"):
            return api_error("Your session is no longer valid.", 401)
        flash("Your session is no longer valid. Please sign in again.", "error")
        return redirect(url_for("login"))

    timeout_minutes = get_settings_dict().get("idle_timeout_minutes", normalize_idle_timeout(None))
    last_activity_raw = session.get("last_activity")
    now = utc_now()

    if last_activity_raw:
        try:
            last_activity = datetime.fromisoformat(last_activity_raw)
            if last_activity.tzinfo is None:
                last_activity = last_activity.replace(tzinfo=timezone.utc)
        except ValueError:
            last_activity = now

        if now - last_activity > timedelta(minutes=timeout_minutes):
            session.clear()
            if request.path.startswith("/api/"):
                return api_error("Session expired due to inactivity.", 401)
            flash("You were logged out due to inactivity.", "error")
            return redirect(url_for("login"))

    session["last_activity"] = now.isoformat()
    return None


def login_required(view_func):
    @wraps(view_func)
    def wrapped_view(*args, **kwargs):
        user = get_current_user()
        if not user:
            if request.path.startswith("/api/"):
                return api_error("Authentication required.", 401)
            return redirect(url_for("login"))
        return view_func(*args, **kwargs)

    return wrapped_view


def admin_required(view_func):
    @wraps(view_func)
    @login_required
    def wrapped_view(*args, **kwargs):
        current_user = get_current_user()
        if not current_user or not current_user.is_admin:
            if request.path.startswith("/api/"):
                return api_error("Administrator access required.", 403)
            flash("Administrator access is required for that page.", "error")
            return redirect(url_for("index"))
        return view_func(*args, **kwargs)

    return wrapped_view


def permission_required(permission_key):
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

    for path in configured_paths:
        if not isinstance(path, str) or not path.strip():
            continue
        normalized = normalize_directory_path(path)
        normalized_key = os.path.normcase(normalized)
        if normalized_key not in seen:
            normalized_paths.append(normalized)
            seen.add(normalized_key)

    default_key = os.path.normcase(DEFAULT_DATA_DIR)
    if default_key not in seen:
        normalized_paths.insert(0, DEFAULT_DATA_DIR)

    return normalized_paths


def save_source_directories(directories):
    with open(DATA_SOURCES_FILE, "w", encoding="utf-8") as file:
        json.dump({"directories": directories}, file, indent=2)


def get_directory_metadata(path):
    exists = os.path.isdir(path)
    return {
        "path": path,
        "label": os.path.basename(path.rstrip("\\/")) or path,
        "exists": exists,
        "type": "network" if path.startswith("\\\\") else "local",
        "is_default": os.path.normcase(path) == os.path.normcase(DEFAULT_DATA_DIR),
    }


def normalize_inferred_header(value, index):
    if pd.isna(value):
        return f"Unnamed: {index + 1}"
    text_value = str(value).strip()
    if not text_value or text_value.lower().startswith("unnamed"):
        return f"Unnamed: {index + 1}"
    return text_value


def dedupe_headers(headers):
    seen = {}
    unique = []
    for header in headers:
        count = seen.get(header, 0)
        unique.append(header if count == 0 else f"{header}_{count + 1}")
        seen[header] = count + 1
    return unique


def score_header_row(row_values, following_rows):
    normalized = [str(value).strip() if not pd.isna(value) else "" for value in row_values]
    non_empty = [value for value in normalized if value]
    if not non_empty:
        return -100

    text_like = 0
    numeric_like = 0
    named_like = 0
    for value in non_empty:
        try:
            float(value.replace(",", ""))
            numeric_like += 1
        except ValueError:
            text_like += 1
            if not value.lower().startswith("unnamed"):
                named_like += 1

    uniqueness = len({value.lower() for value in non_empty})
    fill_ratio = len(non_empty) / max(len(normalized), 1)
    next_rows_score = 0

    for next_row in following_rows:
        next_values = [str(value).strip() if not pd.isna(value) else "" for value in next_row]
        populated = [value for value in next_values if value]
        if not populated:
            continue
        repeated = sum(1 for value in populated if value.lower() in {item.lower() for item in non_empty})
        next_rows_score += max(0, len(populated) - repeated)

    return (
        named_like * 4
        + text_like * 2
        + uniqueness * 1.5
        + fill_ratio * 6
        + next_rows_score * 0.45
        - numeric_like * 3
    )


def detect_header_row(raw_df):
    if raw_df.empty:
        return 0

    candidate_count = min(6, len(raw_df))
    best_index = 0
    best_score = None
    for row_index in range(candidate_count):
        row_values = raw_df.iloc[row_index].tolist()
        following_rows = [raw_df.iloc[idx].tolist() for idx in range(row_index + 1, min(len(raw_df), row_index + 4))]
        score = score_header_row(row_values, following_rows)
        if best_score is None or score > best_score:
            best_index = row_index
            best_score = score

    if best_score is None or best_score < 4:
        return 0
    return best_index


def apply_header_row(raw_df, header_row_index):
    if raw_df.empty:
        return raw_df, header_row_index

    safe_index = max(0, min(header_row_index, len(raw_df) - 1))
    headers = [
        normalize_inferred_header(value, index)
        for index, value in enumerate(raw_df.iloc[safe_index].tolist())
    ]
    headers = dedupe_headers(headers)
    data_df = raw_df.iloc[safe_index + 1:].reset_index(drop=True)
    data_df.columns = headers
    data_df = data_df.replace({pd.NA: "", "nan": ""}).fillna("")
    if not data_df.empty:
        data_df = data_df[~data_df.apply(lambda row: all(str(value).strip() == "" for value in row), axis=1)]
        data_df = data_df.reset_index(drop=True)
    return data_df, safe_index


def load_with_inferred_headers(filepath, override_header_row=None):
    if filepath.lower().endswith(".csv"):
        raw_df = pd.read_csv(filepath, dtype=str, header=None).fillna("")
    else:
        raw_df = pd.read_excel(filepath, dtype=str, header=None, engine="openpyxl").fillna("")

    if raw_df.empty:
        return raw_df, 1, "auto"

    if override_header_row is not None:
        data_df, resolved_index = apply_header_row(raw_df, override_header_row - 1)
        return data_df, resolved_index + 1, "manual"

    detected_index = detect_header_row(raw_df)
    data_df, resolved_index = apply_header_row(raw_df, detected_index)
    return data_df, resolved_index + 1, "auto"


def get_header_overrides_map(db):
    overrides = db.execute(select(HeaderOverride)).scalars().all()
    return {item.file_id: item for item in overrides}


def load_spreadsheets():
    global spreadsheets, source_directories
    spreadsheets = {}
    source_directories = load_source_directories()

    with session_scope() as db:
        overrides = get_header_overrides_map(db)

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
                override = overrides.get(filepath)
                df, header_row, header_source = load_with_inferred_headers(
                    filepath,
                    override.header_row if override else None,
                )
                file_id = filepath
                directory_label = get_directory_metadata(directory)["label"]
                spreadsheets[file_id] = {
                    "id": file_id,
                    "filepath": filepath,
                    "filename": filename,
                    "directory": directory,
                    "directory_label": directory_label,
                    "df": df,
                    "columns": list(df.columns),
                    "row_count": len(df),
                    "header_row": header_row,
                    "header_source": header_source,
                }
                print(
                    f"  ✓ Loaded {filename} from {directory} "
                    f"({len(df)} rows, {len(df.columns)} columns, header row {header_row})"
                )
            except Exception as error:
                print(f"  ✗ Failed to load {filepath}: {error}")

    print(f"\nTotal: {len(spreadsheets)} spreadsheet(s) loaded.\n")


def get_filtered_search_scope(selected_files, selected_columns):
    for file_id, info in spreadsheets.items():
        if selected_files and file_id not in selected_files:
            continue

        df = info["df"]
        columns_to_search = selected_columns if selected_columns else info["columns"]
        columns_to_search = [column for column in columns_to_search if column in df.columns]
        if columns_to_search:
            yield info, df, columns_to_search


def parse_selected_filters():
    selected_columns = request.args.get("columns", "")
    selected_columns = [value.strip() for value in selected_columns.split(",") if value.strip()] if selected_columns else []
    selected_files = request.args.get("files", "")
    selected_files = [value.strip() for value in selected_files.split(",") if value.strip()] if selected_files else []
    return selected_files, selected_columns


def execute_search(query, selected_files, selected_columns):
    results = []
    query_lower = query.lower()

    for info, df, columns_to_search in get_filtered_search_scope(selected_files, selected_columns):
        mask = pd.Series([False] * len(df), index=df.index)
        for column in columns_to_search:
            mask = mask | df[column].astype(str).str.lower().str.contains(query_lower, na=False)

        matched_rows = df[mask]
        for _, row in matched_rows.iterrows():
            results.append(
                {
                    "source_file": info["filename"],
                    "source_label": info["filename"],
                    "file_id": info["id"],
                    "data": {column: str(row[column]) for column in df.columns},
                }
            )
    return results


def record_search_history(user, query, selected_files, selected_columns, result_count):
    if not user:
        return
    with session_scope() as db:
        db.add(
            SearchHistory(
                user_id=user.id,
                query=query,
                selected_files=dump_json(selected_files),
                selected_columns=dump_json(selected_columns),
                result_count=result_count,
            )
        )


def get_favorite_ids_for_user(db, user):
    if not user:
        return set()
    favorites = db.execute(select(FavoriteFile.file_id).where(FavoriteFile.user_id == user.id)).all()
    return {row[0] for row in favorites}


def serialize_spreadsheet(info, favorite_ids):
    return {
        "id": info["id"],
        "filename": info["filename"],
        "filepath": info["filepath"],
        "directory": info["directory"],
        "directory_label": info["directory_label"],
        "columns": info["columns"],
        "row_count": info["row_count"],
        "header_row": info["header_row"],
        "header_source": info["header_source"],
        "is_favorite": info["id"] in favorite_ids,
    }


def serialize_saved_search(item):
    return {
        "id": item.id,
        "name": item.name,
        "query": item.query,
        "selected_files": load_json_array(item.selected_files),
        "selected_columns": load_json_array(item.selected_columns),
        "created_at": serialize_timestamp(item.created_at),
    }


def serialize_search_history(item):
    return {
        "id": item.id,
        "query": item.query,
        "selected_files": load_json_array(item.selected_files),
        "selected_columns": load_json_array(item.selected_columns),
        "result_count": item.result_count,
        "created_at": serialize_timestamp(item.created_at),
    }


def serialize_audit_log(item):
    try:
        details = json.loads(item.details or "{}")
    except json.JSONDecodeError:
        details = {}
    return {
        "id": item.id,
        "actor_username": item.actor_username,
        "action": item.action,
        "entity_type": item.entity_type,
        "entity_id": item.entity_id,
        "details": details,
        "created_at": serialize_timestamp(item.created_at),
    }


def generate_results_pdf(settings, query, results):
    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=0.55 * inch,
        rightMargin=0.55 * inch,
        topMargin=0.55 * inch,
        bottomMargin=0.6 * inch,
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "XTitle",
        parent=styles["Heading1"],
        textColor=colors.HexColor("#123126"),
        fontSize=22,
        leading=28,
        spaceAfter=6,
    )
    subtitle_style = ParagraphStyle(
        "XSubtitle",
        parent=styles["BodyText"],
        textColor=colors.HexColor("#45665a"),
        fontSize=10,
        leading=14,
        spaceAfter=10,
    )
    section_style = ParagraphStyle(
        "XSection",
        parent=styles["Heading3"],
        textColor=colors.HexColor("#0b61b2"),
        fontSize=12,
        leading=16,
        spaceAfter=8,
    )
    value_style = ParagraphStyle(
        "XValue",
        parent=styles["BodyText"],
        textColor=colors.HexColor("#123126"),
        fontSize=9,
        leading=12,
    )

    story = []
    logo_filename = settings.get("logo_filename", "")
    logo_path = os.path.join(UPLOAD_FOLDER, logo_filename) if logo_filename else ""
    if logo_filename and os.path.exists(logo_path):
        story.append(ReportLabImage(logo_path, width=0.9 * inch, height=0.9 * inch))
        story.append(Spacer(1, 8))

    story.append(Paragraph(settings.get("app_name", "Xcelerate"), title_style))
    story.append(Paragraph(settings.get("subtitle", ""), subtitle_style))
    story.append(Paragraph(f"Search term: <b>{query}</b>", value_style))
    story.append(Paragraph(f"Generated: {serialize_timestamp(datetime.utcnow())}", value_style))
    story.append(Paragraph(f"Matches: {len(results)}", value_style))
    story.append(Spacer(1, 14))

    for index, result in enumerate(results, start=1):
        story.append(Paragraph(f"Result {index}: {result['source_file']}", section_style))
        rows = [["Column", "Value"]]
        for column, value in result["data"].items():
            rows.append([Paragraph(str(column), value_style), Paragraph(str(value or ""), value_style)])

        table = Table(rows, colWidths=[1.9 * inch, 4.7 * inch], repeatRows=1)
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e5f2ea")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#0f6c3a")),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d2e4d8")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f7fbf7")]),
                    ("PADDING", (0, 0), (-1, -1), 6),
                ]
            )
        )
        story.append(table)
        story.append(Spacer(1, 14))

    document.build(story)
    buffer.seek(0)
    return buffer


@app.route("/login", methods=["GET", "POST"])
def login():
    if get_current_user():
        return redirect(url_for("index"))

    settings = get_settings_dict()
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        with session_scope() as db:
            user = db.execute(select(User).where(User.username == username)).scalars().first()

            if not user or not check_password_hash(user.password_hash, password):
                flash("Invalid username or password.", "error")
            elif not user.is_active:
                flash("This account is disabled. Contact an administrator.", "error")
            else:
                session.clear()
                session["user_id"] = user.id
                session["last_activity"] = utc_now().isoformat()
                return redirect(url_for("index"))

    return render_template("login.html", app_settings=settings)


@app.route("/logout", methods=["POST"])
@login_required
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/")
@login_required
def index():
    current_user = get_current_user()
    settings = get_settings_dict()
    return render_template(
        "index.html",
        current_user=get_serialized_user(current_user),
        current_permissions=get_user_permissions(current_user),
        app_settings=settings,
    )


@app.route("/api/session")
@login_required
def get_session_data():
    return jsonify({"user": get_serialized_user(get_current_user()), "settings": get_settings_dict()})


@app.route("/api/spreadsheets")
@permission_required("can_view_search")
def get_spreadsheets():
    current_user = get_current_user()
    with session_scope() as db:
        favorite_ids = get_favorite_ids_for_user(db, current_user)
    result = [serialize_spreadsheet(info, favorite_ids) for info in spreadsheets.values()]
    result.sort(key=lambda item: (not item["is_favorite"], item["filename"].lower()))
    return jsonify(result)


@app.route("/api/directories")
@permission_required("can_view_sources")
def get_directories():
    global source_directories
    if not source_directories:
        source_directories = load_source_directories()
    return jsonify([get_directory_metadata(path) for path in source_directories])


@app.route("/api/directories", methods=["POST"])
@admin_required
def add_directory():
    payload = request.get_json(silent=True) or {}
    raw_path = payload.get("path", "")
    if not isinstance(raw_path, str) or not raw_path.strip():
        return api_error("A directory path is required.", 400)

    new_path = normalize_directory_path(raw_path)
    directories = load_source_directories()
    keys = {os.path.normcase(item) for item in directories}
    if os.path.normcase(new_path) in keys:
        load_spreadsheets()
        return jsonify({"message": "Directory already configured."})

    directories.append(new_path)
    save_source_directories(directories)
    load_spreadsheets()
    record_audit(
        "directory_added",
        "directory",
        new_path,
        {"path": new_path},
        actor=get_current_user(),
    )
    return jsonify({"message": "Source folder added successfully."})


@app.route("/api/directories", methods=["DELETE"])
@admin_required
def delete_directory():
    payload = request.get_json(silent=True) or {}
    raw_path = payload.get("path", "")
    if not isinstance(raw_path, str) or not raw_path.strip():
        return api_error("A directory path is required.", 400)

    target_path = normalize_directory_path(raw_path)
    if os.path.normcase(target_path) == os.path.normcase(DEFAULT_DATA_DIR):
        return api_error("The default data directory cannot be removed.", 400)

    directories = load_source_directories()
    keys = {os.path.normcase(item) for item in directories}
    if os.path.normcase(target_path) not in keys:
        return api_error("Directory not found.", 404)

    directories = [item for item in directories if os.path.normcase(item) != os.path.normcase(target_path)]
    save_source_directories(directories)
    load_spreadsheets()
    record_audit(
        "directory_removed",
        "directory",
        target_path,
        {"path": target_path},
        actor=get_current_user(),
    )
    return jsonify({"message": "Source folder removed successfully."})


@app.route("/api/search")
@permission_required("can_view_search")
def search():
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"results": [], "total": 0, "query": ""})

    selected_files, selected_columns = parse_selected_filters()
    results = execute_search(query, selected_files, selected_columns)
    record_search_history(get_current_user(), query, selected_files, selected_columns, len(results))
    return jsonify({"results": results, "total": len(results), "query": query})


@app.route("/api/autocomplete")
@permission_required("can_view_search")
def autocomplete():
    query = request.args.get("q", "").strip()
    if len(query) < 2:
        return jsonify({"suggestions": []})

    selected_files, selected_columns = parse_selected_filters()
    query_lower = query.lower()
    seen = set()
    suggestions = []

    for info, df, columns_to_search in get_filtered_search_scope(selected_files, selected_columns):
        for column in columns_to_search:
            series = df[column].astype(str)
            matches = series[series.str.lower().str.contains(query_lower, na=False)].head(8)
            for value in matches:
                cleaned = str(value).strip()
                normalized = cleaned.lower()
                if len(cleaned) < 2 or normalized in seen:
                    continue
                suggestions.append({"value": cleaned, "column": column, "source_file": info["filename"]})
                seen.add(normalized)
                if len(suggestions) >= 8:
                    return jsonify({"suggestions": suggestions})

    return jsonify({"suggestions": suggestions})


@app.route("/api/reload", methods=["POST"])
@admin_required
def reload_spreadsheets():
    load_spreadsheets()
    record_audit(
        "spreadsheets_reloaded",
        "system",
        "spreadsheet-index",
        {"count": len(spreadsheets)},
        actor=get_current_user(),
    )
    return jsonify({"message": "Spreadsheets reloaded successfully.", "count": len(spreadsheets)})


@app.route("/api/settings", methods=["GET"])
@permission_required("can_view_settings")
def get_app_settings():
    return jsonify(get_settings_dict())


@app.route("/api/settings", methods=["POST"])
@permission_required("can_view_settings")
def update_app_settings():
    current_settings = get_settings_dict()
    app_name = request.form.get("app_name", current_settings["app_name"]).strip()
    subtitle = request.form.get("subtitle", current_settings["subtitle"]).strip()
    results_per_page = normalize_results_per_page(request.form.get("results_per_page", current_settings["results_per_page"]))
    idle_timeout_minutes = normalize_idle_timeout(
        request.form.get("idle_timeout_minutes", current_settings["idle_timeout_minutes"])
    )
    theme_preset = normalize_theme_preset(
        request.form.get("theme_preset", current_settings.get("theme_preset", DEFAULT_SETTINGS["theme_preset"]))
    )

    if not app_name:
        return api_error("Application name is required.", 400)

    updated = {
        "app_name": app_name,
        "subtitle": subtitle or DEFAULT_SETTINGS["subtitle"],
        "results_per_page": results_per_page,
        "idle_timeout_minutes": idle_timeout_minutes,
        "theme_preset": theme_preset,
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
        updated["logo_filename"] = logo_filename

    with session_scope() as db:
        save_settings_map(db, updated)
        record_audit(
            "settings_updated",
            "settings",
            "application",
            {
                "app_name": updated["app_name"],
                "idle_timeout_minutes": updated["idle_timeout_minutes"],
                "theme_preset": updated["theme_preset"],
            },
            actor=get_current_user(),
            db=db,
        )

    return jsonify({"message": "Settings updated successfully.", "settings": get_settings_dict()})


@app.route("/api/users", methods=["GET"])
@permission_required("can_view_users")
def get_users():
    with session_scope() as db:
        users = db.execute(select(User).order_by(User.username.asc())).scalars().all()
        return jsonify([get_serialized_user(user) for user in users])


@app.route("/api/users", methods=["POST"])
@permission_required("can_view_users")
def create_user():
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

    current_actor = get_current_user()
    try:
        with session_scope() as db:
            user = User(
                username=username,
                password_hash=generate_password_hash(password),
                is_admin=is_admin,
                can_view_search=can_view_search,
                can_view_sources=can_view_sources,
                can_view_settings=can_view_settings,
                can_view_users=can_view_users,
                is_active=True,
            )
            db.add(user)
            db.flush()
            record_audit(
                "user_created",
                "user",
                str(user.id),
                {"username": username, "is_admin": is_admin},
                actor=current_actor,
                db=db,
            )
    except IntegrityError:
        return api_error("That username already exists.", 409)

    return jsonify({"message": "User account created successfully."}), 201


@app.route("/api/users/<int:user_id>", methods=["PATCH"])
@permission_required("can_view_users")
def update_user(user_id):
    payload = request.get_json(silent=True) or {}
    if "is_active" not in payload:
        return api_error("An is_active value is required.", 400)

    is_active = bool(payload["is_active"])
    current_user = get_current_user()
    if current_user and current_user.id == user_id and not is_active:
        return api_error("You cannot deactivate your own active session.", 400)

    with session_scope() as db:
        user = db.get(User, user_id)
        if not user:
            return api_error("User not found.", 404)
        user.is_active = is_active
        record_audit(
            "user_activated" if is_active else "user_deactivated",
            "user",
            str(user.id),
            {"username": user.username},
            actor=current_user,
            db=db,
        )

    return jsonify({"message": f"User {'activated' if is_active else 'deactivated'} successfully."})


@app.route("/api/users/<int:user_id>", methods=["DELETE"])
@permission_required("can_view_users")
def delete_user(user_id):
    current_user = get_current_user()
    if current_user and current_user.id == user_id:
        return api_error("You cannot delete your own active session.", 400)

    with session_scope() as db:
        user = db.get(User, user_id)
        if not user:
            return api_error("User not found.", 404)
        username = user.username
        db.delete(user)
        record_audit(
            "user_deleted",
            "user",
            str(user_id),
            {"username": username},
            actor=current_user,
            db=db,
        )

    return jsonify({"message": "User deleted successfully."})


@app.route("/api/saved-searches", methods=["GET"])
@permission_required("can_view_search")
def get_saved_searches():
    user = get_current_user()
    with session_scope() as db:
        items = db.execute(
            select(SavedSearch).where(SavedSearch.user_id == user.id).order_by(SavedSearch.created_at.desc())
        ).scalars().all()
        return jsonify([serialize_saved_search(item) for item in items])


@app.route("/api/saved-searches", methods=["POST"])
@permission_required("can_view_search")
def create_saved_search():
    user = get_current_user()
    payload = request.get_json(silent=True) or {}
    name = payload.get("name", "").strip()
    query = payload.get("query", "").strip()
    selected_files = payload.get("selected_files", [])
    selected_columns = payload.get("selected_columns", [])

    if len(name) < 2:
        return api_error("Saved search name must be at least 2 characters long.", 400)
    if not query:
        return api_error("A search query is required.", 400)

    with session_scope() as db:
        db.add(
            SavedSearch(
                user_id=user.id,
                name=name,
                query=query,
                selected_files=dump_json(selected_files),
                selected_columns=dump_json(selected_columns),
            )
        )
    return jsonify({"message": "Saved search created successfully."}), 201


@app.route("/api/saved-searches", methods=["DELETE"])
@permission_required("can_view_search")
def clear_saved_searches():
    user = get_current_user()
    with session_scope() as db:
        db.query(SavedSearch).filter(SavedSearch.user_id == user.id).delete()
    return jsonify({"message": "Saved searches cleared successfully."})


@app.route("/api/saved-searches/<int:item_id>", methods=["DELETE"])
@permission_required("can_view_search")
def delete_saved_search(item_id):
    user = get_current_user()
    with session_scope() as db:
        item = db.get(SavedSearch, item_id)
        if not item or item.user_id != user.id:
            return api_error("Saved search not found.", 404)
        db.delete(item)
    return jsonify({"message": "Saved search deleted successfully."})


@app.route("/api/search-history", methods=["GET"])
@permission_required("can_view_search")
def get_search_history():
    user = get_current_user()
    with session_scope() as db:
        items = db.execute(
            select(SearchHistory).where(SearchHistory.user_id == user.id).order_by(SearchHistory.created_at.desc())
        ).scalars().all()
        return jsonify([serialize_search_history(item) for item in items])


@app.route("/api/search-history", methods=["DELETE"])
@permission_required("can_view_search")
def clear_search_history():
    user = get_current_user()
    with session_scope() as db:
        db.query(SearchHistory).filter(SearchHistory.user_id == user.id).delete()
    return jsonify({"message": "Search history cleared successfully."})


@app.route("/api/search-history/<int:item_id>", methods=["DELETE"])
@permission_required("can_view_search")
def delete_search_history(item_id):
    user = get_current_user()
    with session_scope() as db:
        item = db.get(SearchHistory, item_id)
        if not item or item.user_id != user.id:
            return api_error("Search history item not found.", 404)
        db.delete(item)
    return jsonify({"message": "Search history item deleted successfully."})


@app.route("/api/favorites", methods=["GET"])
@permission_required("can_view_search")
def get_favorites():
    user = get_current_user()
    with session_scope() as db:
        items = db.execute(
            select(FavoriteFile).where(FavoriteFile.user_id == user.id).order_by(FavoriteFile.created_at.desc())
        ).scalars().all()
    favorites = []
    for item in items:
        info = spreadsheets.get(item.file_id)
        favorites.append(
            {
                "id": item.id,
                "file_id": item.file_id,
                "filename": item.filename,
                "available": bool(info),
                "row_count": info["row_count"] if info else 0,
                "header_row": info["header_row"] if info else None,
                "created_at": serialize_timestamp(item.created_at),
            }
        )
    return jsonify(favorites)


@app.route("/api/favorites", methods=["POST"])
@permission_required("can_view_search")
def toggle_favorite():
    user = get_current_user()
    payload = request.get_json(silent=True) or {}
    file_id = payload.get("file_id", "")
    info = spreadsheets.get(file_id)
    if not info:
        return api_error("File not found.", 404)

    with session_scope() as db:
        favorite = db.execute(
            select(FavoriteFile).where(FavoriteFile.user_id == user.id, FavoriteFile.file_id == file_id)
        ).scalars().first()
        if favorite:
            db.delete(favorite)
            is_favorite = False
        else:
            db.add(FavoriteFile(user_id=user.id, file_id=file_id, filename=info["filename"]))
            is_favorite = True

    return jsonify({"message": "Favorite updated successfully.", "is_favorite": is_favorite})


@app.route("/api/header-overrides", methods=["GET"])
@permission_required("can_view_sources")
def get_header_overrides():
    overrides = []
    with session_scope() as db:
        items = db.execute(select(HeaderOverride).order_by(HeaderOverride.filename.asc())).scalars().all()
        for item in items:
            overrides.append(
                {
                    "file_id": item.file_id,
                    "filename": item.filename,
                    "header_row": item.header_row,
                    "updated_at": serialize_timestamp(item.updated_at),
                    "updated_by_user_id": item.updated_by_user_id,
                }
            )
    return jsonify(overrides)


@app.route("/api/header-overrides", methods=["POST"])
@admin_required
def set_header_override():
    payload = request.get_json(silent=True) or {}
    file_id = payload.get("file_id", "")
    if file_id not in spreadsheets:
        return api_error("File not found.", 404)

    try:
        header_row = int(payload.get("header_row", 0))
    except (TypeError, ValueError):
        header_row = 0

    if header_row < 1:
        return api_error("Header row must be 1 or greater.", 400)

    info = spreadsheets[file_id]
    current_user = get_current_user()
    with session_scope() as db:
        override = db.execute(select(HeaderOverride).where(HeaderOverride.file_id == file_id)).scalars().first()
        if not override:
            override = HeaderOverride(
                file_id=file_id,
                file_path=info["filepath"],
                filename=info["filename"],
                header_row=header_row,
                updated_by_user_id=current_user.id,
                updated_at=datetime.utcnow(),
            )
            db.add(override)
        else:
            override.header_row = header_row
            override.updated_by_user_id = current_user.id
            override.updated_at = datetime.utcnow()

        record_audit(
            "header_override_set",
            "spreadsheet",
            file_id,
            {"filename": info["filename"], "header_row": header_row},
            actor=current_user,
            db=db,
        )

    load_spreadsheets()
    return jsonify({"message": "Header override saved successfully."})


@app.route("/api/header-overrides", methods=["DELETE"])
@admin_required
def clear_header_override():
    payload = request.get_json(silent=True) or {}
    file_id = payload.get("file_id", "")
    current_user = get_current_user()

    with session_scope() as db:
        override = db.execute(select(HeaderOverride).where(HeaderOverride.file_id == file_id)).scalars().first()
        if not override:
            return api_error("Header override not found.", 404)
        filename = override.filename
        db.delete(override)
        record_audit(
            "header_override_cleared",
            "spreadsheet",
            file_id,
            {"filename": filename},
            actor=current_user,
            db=db,
        )

    load_spreadsheets()
    return jsonify({"message": "Header override cleared successfully."})


@app.route("/api/audit-log")
@admin_required
def get_audit_log():
    with session_scope() as db:
        items = db.execute(select(AuditLog).order_by(AuditLog.created_at.desc()).limit(200)).scalars().all()
        return jsonify([serialize_audit_log(item) for item in items])


@app.route("/api/export/pdf")
@permission_required("can_view_search")
def export_results_pdf():
    query = request.args.get("q", "").strip()
    if not query:
        return api_error("A search query is required to export results.", 400)

    selected_files, selected_columns = parse_selected_filters()
    results = execute_search(query, selected_files, selected_columns)
    if not results:
        return api_error("There are no results to export.", 400)

    current_user = get_current_user()
    if current_user and current_user.is_admin:
        record_audit(
            "results_exported",
            "export",
            "pdf",
            {"query": query, "result_count": len(results)},
            actor=current_user,
        )

    settings = get_settings_dict()
    pdf_buffer = generate_results_pdf(settings, query, results)
    filename = secure_filename(f"{settings['app_name']}-{query[:40] or 'results'}.pdf")
    return send_file(
        pdf_buffer,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=filename,
    )


bootstrap_database()
load_spreadsheets()

if __name__ == "__main__":
    print("\nXcelerate")
    print(f"Default data directory: {DEFAULT_DATA_DIR}")
    print(f"Source config file: {DATA_SOURCES_FILE}")
    print(f"Database URL: {DATABASE_URL}")
    print(f"Default admin username: {DEFAULT_ADMIN_USERNAME}")
    print("Loading spreadsheets...")
    load_spreadsheets()
    app.run(debug=True, host="0.0.0.0", port=5555)
