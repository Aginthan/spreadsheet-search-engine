# SKA Search Hub

SKA Search Hub is a spreadsheet search application for CSV and Excel files. It lets teams search data across multiple source folders, manage user access, customize branding, and work through a clean tabbed interface.

## Features

- Search across CSV and Excel files from multiple source folders
- Autocomplete suggestions while typing
- File and column filters for narrowing search scope
- Separate tabs for Search, Sources, Settings, and Users
- User accounts with panel-level access control
- Administrator account with full access
- Activate, deactivate, create, and delete users
- Custom logo, app name, subtitle, and results-per-page settings
- Dark mode toggle
- Local particle background animation

## Requirements

- Python 3.10+
- `pip`

## Quick Start

1. Clone the project:

```bash
git clone <your-repository-url>
cd spreadsheet-search-engine
```

2. Create a virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

3. Install dependencies:

```bash
pip install -r requirements.txt
```

4. Start the app:

```bash
python app.py
```

5. Open the app:

```text
http://localhost:5555
```

## First Login

On first run, the application creates a default administrator account:

- Username: `admin`
- Password: `admin123`

Log in with that account first, then create the users you need from the `Users` tab.

## Spreadsheet Sources

- The default local spreadsheet folder is `data/`
- Additional source folders are stored in `data_sources.json`
- Full source paths are shown only in the `Sources` tab

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

## Main Screens

- `Search`: search spreadsheets and view paginated results
- `Sources`: view or manage connected source folders
- `Settings`: update branding and UI settings
- `Users`: manage accounts and access control

## Notes

- Source folder changes reload spreadsheet data without restarting the app
- The app will try to recognize the real spreadsheet header row automatically
- If it cannot confidently detect a header, fallback column names such as `Unnamed` are still used
