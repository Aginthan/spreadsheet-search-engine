# SKA Search Hub

SKA Search Hub is a Flask-based spreadsheet search workspace for CSV and Excel files. It supports multiple source folders, role-based access, user administration, branding, autocomplete search, dark mode, and a polished dashboard UI.

## Features

- Multi-folder spreadsheet loading from local paths and mounted network shares
- Search across CSV and Excel files with file and column filters
- Autocomplete suggestions driven by real spreadsheet content
- Separate tabs for Search, Sources, Settings, and Users
- Panel-level access control per user
- Administrator account with full access
- Create, delete, activate, and deactivate user accounts
- Custom application name, subtitle, logo upload, and pagination settings
- Dark mode toggle
- Three.js looping particle background
- Responsive card-based search results

## Tech Stack

- Python 3.13+
- Flask
- pandas
- openpyxl
- SQLite for app users and settings
- Vanilla JavaScript
- Three.js for background particles

## Project Structure

```text
spreadsheet-search-engine/
├── app.py
├── requirements.txt
├── README.md
├── data/
├── static/
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js
│       └── particles.js
└── templates/
    ├── index.html
    └── login.html
```

## Local Setup

1. Create and activate a virtual environment:

```bash
cd spreadsheet-search-engine
python3 -m venv .venv
source .venv/bin/activate
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Run the app:

```bash
python app.py
```

4. Open:

```text
http://localhost:5555
```

## First Login

On first run the app seeds a default administrator account:

- Username: `admin`
- Password: `admin123`

Log in with that account, then create the real user accounts you want from the `Users` tab.

## User Access Model

Each user can be given visibility to any combination of these panels:

- `Search`
- `Sources`
- `Settings`
- `Users`

Administrators automatically receive access to everything.

## Source Folders

The app keeps its source folder configuration in `data_sources.json`. Full file paths are only shown in the `Sources` tab. The search file list intentionally hides file paths for privacy.

## Main API Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/spreadsheets` | Loaded spreadsheet metadata |
| `GET` | `/api/directories` | Visible source folders |
| `POST` | `/api/directories` | Add a source folder |
| `DELETE` | `/api/directories` | Remove a source folder |
| `GET` | `/api/search` | Search spreadsheet data |
| `GET` | `/api/autocomplete` | Search suggestions |
| `POST` | `/api/reload` | Reload spreadsheet sources |
| `GET` | `/api/users` | List users |
| `POST` | `/api/users` | Create user |
| `PATCH` | `/api/users/<id>` | Activate or deactivate user |
| `DELETE` | `/api/users/<id>` | Delete user |
| `GET` | `/api/settings` | Read app settings |
| `POST` | `/api/settings` | Update branding and app settings |

## Production Notes

For real production use, treat the current app as the application core and wrap it in a proper deployment stack.

### 1. Stop using Flask debug mode

Do not run production with:

```python
app.run(debug=True, ...)
```

Use a production WSGI server instead, such as Gunicorn.

### 2. Run with Gunicorn

Example:

```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:5555 app:app
```

### 3. Put Nginx in front

Use Nginx as a reverse proxy for:

- HTTPS termination
- request buffering
- static file delivery
- better security headers

Typical flow:

```text
Browser -> Nginx -> Gunicorn -> Flask app
```

### 4. Move secrets to environment variables

At minimum, set:

```bash
export FLASK_SECRET_KEY="replace-with-a-long-random-secret"
export APP_DEFAULT_ADMIN_PASSWORD="replace-this-before-first-start"
```

Do not hardcode production secrets in source files.

### 5. Lock down storage locations

Think about where these files live in production:

- `app_data.db`
- `data_sources.json`
- uploaded logos in `static/uploads/`

For real deployment, put them on persistent storage outside ephemeral containers if needed.

### 6. Consider moving off SQLite

SQLite is fine for a small internal tool or single-instance deployment. For a larger multi-user production app, move users/settings to PostgreSQL or MySQL.

### 7. Validate network-share strategy

If the app reads data from network shares:

- mount them at the operating-system level
- run the service under a user or service account with the right permissions
- avoid embedding share credentials into the app itself

### 8. Bundle the frontend more formally

Right now the frontend is simple static HTML/CSS/JS, which is fine. If you want a more production-grade frontend workflow, the next step would be:

1. Move frontend assets into a small build setup like Vite
2. Install dependencies such as `three` locally instead of using a CDN
3. Bundle and minify JS/CSS for deployment
4. Output the built assets into `static/`

That would give you:

- cache-busted assets
- better dependency management
- easier production optimization

### 9. Suggested production packaging options

You have a few realistic ways to ship this:

#### Option A: Single Linux VM

- Ubuntu server
- Python virtual environment
- Gunicorn
- Nginx
- systemd service

This is the simplest path for an internal business tool.

#### Option B: Dockerized app

- Build a Docker image for Flask + Gunicorn
- Run with Docker Compose
- Add Nginx as a reverse proxy
- Mount persistent volumes for app data and uploads

This is a good middle ground if you want repeatable deployments.

#### Option C: Split app and data services

- Flask app in a container or VM
- PostgreSQL for users/settings
- mounted shared storage for spreadsheets
- Nginx or a cloud load balancer in front

This is the better path if usage grows.

## Recommended Next Production Step

If you want to ship this as a real internal app, the best next implementation step is:

1. Add a `Dockerfile`
2. Add a `gunicorn` startup command
3. Add an Nginx config
4. Move `three` from CDN to a bundled frontend build
5. Replace SQLite with PostgreSQL if multiple people will use it regularly

If you want, I can do that next and prepare this repository for a real production deployment layout. 
