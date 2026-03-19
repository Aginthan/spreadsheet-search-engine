# 📊 Spreadsheet Search Engine

A modern web application that lets you search across multiple spreadsheets (CSV & Excel) and view aggregated results in one place. Built with Python (Flask + pandas) and a sleek dark-themed frontend.

![Spreadsheet Search Engine](https://img.shields.io/badge/Python-3.10%2B-blue?logo=python)
![Flask](https://img.shields.io/badge/Flask-3.1-green?logo=flask)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## ✨ Features

- **Multi-folder support** — Reads spreadsheets from multiple local folders and network share paths
- **Multi-format support** — Reads both `.csv` and `.xlsx` (Excel) files
- **Cross-file search** — Search across all spreadsheets simultaneously
- **Column filtering** — Select which columns to search in
- **File filtering** — Choose which spreadsheets to include in searches
- **Aggregated results** — Results from all files displayed in one table with source badges
- **Match highlighting** — Search terms are highlighted in results
- **Live reload** — Add or remove spreadsheets and reload without restarting
- **Modern UI** — Dark glassmorphism theme with smooth animations

---

## 🖼️ Screenshots

### Initial View
The app auto-detects all spreadsheets in the configured source folders and displays file/column metadata:

![Initial View](docs/screenshots/initial_state.png)

### Search Results
Search "New York" returns aggregated results from both CSV and Excel files:

![Search Results](docs/screenshots/search_results.png)

---

## 🚀 Getting Started

### Prerequisites

- **Python 3.10+** installed on your system
- **pip** (Python package manager)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/YOUR_USERNAME/spreadsheet-search-engine.git
   cd spreadsheet-search-engine
   ```

2. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

3. **Add your spreadsheets**

   By default, the app scans the `data/` directory. You can also add more local folders or network share paths from the web UI after startup.

   Example default folder:
   ```
   data/
   ├── your_file_1.csv
   ├── your_file_2.xlsx
   └── ...
   ```

4. **Run the application**
   ```bash
   python app.py
   ```

5. **Open in browser**

   Navigate to [http://localhost:5000](http://localhost:5000)

---

## 📖 Usage

### Searching
1. Type your search query in the search bar
2. Press **Enter** or click the **Search** button
3. Results from all matching spreadsheets appear in a single table

### Filtering by Columns
- Use the **Search Columns** panel in the sidebar to select/deselect columns
- Click **None** to deselect all, then pick specific columns
- Only selected columns are searched

### Filtering by Files
- Use the **Spreadsheets** panel to include/exclude specific files
- Click **None** to deselect all, then pick specific files

### Managing Source Folders
- Use the **Source Folders** panel in the sidebar to add multiple directories
- Local paths, mounted drives, and Windows UNC paths such as `\\SERVER\Shared\Reports` are supported
- The folder list is persisted in `data_sources.json`

### Reloading Data
- After adding or removing spreadsheet files from any configured source folder, click the **⟳ Reload** button in the sidebar
- The app will re-scan every configured folder and update the file/column lists

---

## 📁 Project Structure

```
spreadsheet-search-engine/
├── app.py                  # Flask backend & search API
├── requirements.txt        # Python dependencies
├── README.md               # This file
├── .gitignore              # Git ignore rules
├── data/                   # Default local spreadsheet folder
│   ├── employees.csv       # Sample CSV data
│   └── companies.xlsx      # Sample Excel data
├── data_sources.json       # Saved list of configured source folders
├── static/
│   ├── css/
│   │   └── style.css       # Dark theme & glassmorphism styles
│   └── js/
│       └── app.js          # Frontend search & UI logic
└── templates/
    └── index.html          # Main HTML page
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Serves the main web interface |
| `GET` | `/api/spreadsheets` | Returns metadata for all loaded files |
| `GET` | `/api/directories` | Returns configured source folders |
| `POST` | `/api/directories` | Adds a source folder and reloads spreadsheets |
| `DELETE` | `/api/directories` | Removes a source folder and reloads spreadsheets |
| `GET` | `/api/search?q=<query>&columns=<col1,col2>&files=<file_id1,file_id2>` | Searches across spreadsheets |
| `POST` | `/api/reload` | Re-scans all configured source folders and reloads files |

### Search Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `q` | Yes | The search term |
| `columns` | No | Comma-separated column names to search in (defaults to all) |
| `files` | No | Comma-separated file ids to include (defaults to all) |

---

## 🛠️ Configuration

The default local data directory is `data/` inside the project folder. Additional folders are stored in `data_sources.json`.

If you want to change the built-in default folder, edit the `DEFAULT_DATA_DIR` variable in `app.py`:

```python
DEFAULT_DATA_DIR = os.path.join(BASE_DIR, "data")
```

The server runs on port `5000` by default. To change it:

```python
app.run(debug=True, host="0.0.0.0", port=8080)  # Change to your preferred port
```

---

## 📝 License

This project is open source and available under the [MIT License](LICENSE).
