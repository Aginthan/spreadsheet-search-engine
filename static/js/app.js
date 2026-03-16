/**
 * Spreadsheet Search Engine - Frontend Application
 */

// --- State ---
let spreadsheetData = [];
let selectedFiles = new Set();
let selectedColumns = new Set();
let allColumns = [];

// --- DOM Elements ---
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const fileListEl = document.getElementById('file-list');
const columnListEl = document.getElementById('column-list');
const resultsArea = document.getElementById('results-area');
const resultsCount = document.getElementById('results-count');
const statsFiles = document.getElementById('stats-files');
const statsRows = document.getElementById('stats-rows');
const statsCols = document.getElementById('stats-cols');
const toggleAllFilesBtn = document.getElementById('toggle-all-files');
const toggleAllColsBtn = document.getElementById('toggle-all-cols');
const reloadBtn = document.getElementById('reload-btn');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    loadSpreadsheets();

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') performSearch();
    });
    searchBtn.addEventListener('click', performSearch);
    reloadBtn.addEventListener('click', reloadData);
    toggleAllFilesBtn.addEventListener('click', toggleAllFiles);
    toggleAllColsBtn.addEventListener('click', toggleAllColumns);
});

// --- API Calls ---

async function loadSpreadsheets() {
    try {
        const res = await fetch('/api/spreadsheets');
        spreadsheetData = await res.json();

        // Collect unique columns across all files
        const colSet = new Set();
        spreadsheetData.forEach(f => f.columns.forEach(c => colSet.add(c)));
        allColumns = Array.from(colSet).sort();

        // Select all files and columns by default
        selectedFiles = new Set(spreadsheetData.map(f => f.filename));
        selectedColumns = new Set(allColumns);

        renderFileList();
        renderColumnList();
        updateStats();

        if (spreadsheetData.length === 0) {
            showEmptyData();
        } else {
            showInitialState();
        }
    } catch (err) {
        console.error('Failed to load spreadsheets:', err);
        showToast('Failed to load spreadsheets. Is the server running?', 'error');
    }
}

async function performSearch() {
    const query = searchInput.value.trim();
    if (!query) {
        searchInput.focus();
        return;
    }

    showLoading();

    const params = new URLSearchParams({ q: query });
    if (selectedColumns.size > 0 && selectedColumns.size < allColumns.length) {
        params.set('columns', Array.from(selectedColumns).join(','));
    }
    if (selectedFiles.size > 0 && selectedFiles.size < spreadsheetData.length) {
        params.set('files', Array.from(selectedFiles).join(','));
    }

    try {
        const res = await fetch(`/api/search?${params}`);
        const data = await res.json();
        renderResults(data);
    } catch (err) {
        console.error('Search failed:', err);
        showToast('Search failed. Please try again.', 'error');
        showInitialState();
    }
}

async function reloadData() {
    reloadBtn.disabled = true;
    reloadBtn.innerHTML = '<span class="loading-spinner"></span> Reloading…';

    try {
        await fetch('/api/reload', { method: 'POST' });
        await loadSpreadsheets();
        showToast('Spreadsheets reloaded successfully!', 'success');
        showInitialState();
    } catch (err) {
        console.error('Reload failed:', err);
        showToast('Failed to reload spreadsheets.', 'error');
    } finally {
        reloadBtn.disabled = false;
        reloadBtn.innerHTML = '<span class="reload-icon">⟳</span> Reload';
    }
}

// --- Rendering ---

function renderFileList() {
    fileListEl.innerHTML = '';
    spreadsheetData.forEach(file => {
        const li = document.createElement('li');
        li.className = 'file-item' + (selectedFiles.has(file.filename) ? ' active' : '');

        const isCSV = file.filename.toLowerCase().endsWith('.csv');
        const icon = isCSV ? '📄' : '📊';

        li.innerHTML = `
            <input type="checkbox" id="file-${file.filename}"
                   ${selectedFiles.has(file.filename) ? 'checked' : ''}>
            <span class="file-name" title="${file.filename}">${icon} ${file.filename}</span>
            <span class="file-meta">${file.row_count} rows</span>
        `;

        const checkbox = li.querySelector('input');
        li.addEventListener('click', (e) => {
            if (e.target !== checkbox) checkbox.checked = !checkbox.checked;
            if (checkbox.checked) {
                selectedFiles.add(file.filename);
                li.classList.add('active');
            } else {
                selectedFiles.delete(file.filename);
                li.classList.remove('active');
            }
        });

        fileListEl.appendChild(li);
    });
}

function renderColumnList() {
    columnListEl.innerHTML = '';
    allColumns.forEach(col => {
        const li = document.createElement('li');
        li.className = 'column-item';

        li.innerHTML = `
            <input type="checkbox" id="col-${col}"
                   ${selectedColumns.has(col) ? 'checked' : ''}>
            <label for="col-${col}">${col}</label>
        `;

        const checkbox = li.querySelector('input');
        li.addEventListener('click', (e) => {
            if (e.target !== checkbox && e.target.tagName !== 'LABEL') {
                checkbox.checked = !checkbox.checked;
            }
            // Defer to let the click event process
            setTimeout(() => {
                if (checkbox.checked) {
                    selectedColumns.add(col);
                } else {
                    selectedColumns.delete(col);
                }
            }, 0);
        });

        columnListEl.appendChild(li);
    });
}

function renderResults(data) {
    if (data.total === 0) {
        resultsCount.innerHTML = `<span>0</span> results`;
        resultsArea.innerHTML = `
            <div class="empty-state fade-in">
                <div class="empty-icon">🔍</div>
                <h3>No results found</h3>
                <p>Try a different search term or adjust your column/file filters.</p>
            </div>
        `;
        return;
    }

    resultsCount.innerHTML = `<span>${data.total}</span> result${data.total !== 1 ? 's' : ''}`;

    // Gather all unique columns from results
    const resultCols = new Set();
    data.results.forEach(r => Object.keys(r.data).forEach(k => resultCols.add(k)));
    const columns = Array.from(resultCols);

    // Build highlight function
    const queryLower = data.query.toLowerCase();

    let html = '<div class="results-table-wrapper"><table class="results-table">';

    // Header
    html += '<thead><tr><th>Source</th>';
    columns.forEach(col => {
        html += `<th>${escapeHtml(col)}</th>`;
    });
    html += '</tr></thead>';

    // Body
    html += '<tbody>';
    data.results.forEach(result => {
        html += '<tr>';
        html += `<td><span class="source-badge">📄 ${escapeHtml(result.source_file)}</span></td>`;
        columns.forEach(col => {
            const val = result.data[col] || '';
            const isMatch = val.toLowerCase().includes(queryLower);
            html += `<td class="${isMatch ? 'highlight' : ''}">${highlightText(val, data.query)}</td>`;
        });
        html += '</tr>';
    });
    html += '</tbody></table></div>';

    resultsArea.innerHTML = html;
}

function updateStats() {
    const totalFiles = spreadsheetData.length;
    const totalRows = spreadsheetData.reduce((sum, f) => sum + f.row_count, 0);
    const totalCols = allColumns.length;

    statsFiles.textContent = totalFiles;
    statsRows.textContent = totalRows.toLocaleString();
    statsCols.textContent = totalCols;
}

// --- Toggle Helpers ---

function toggleAllFiles() {
    const allSelected = selectedFiles.size === spreadsheetData.length;
    if (allSelected) {
        selectedFiles.clear();
        toggleAllFilesBtn.textContent = 'All';
    } else {
        selectedFiles = new Set(spreadsheetData.map(f => f.filename));
        toggleAllFilesBtn.textContent = 'None';
    }
    renderFileList();
}

function toggleAllColumns() {
    const allSelected = selectedColumns.size === allColumns.length;
    if (allSelected) {
        selectedColumns.clear();
        toggleAllColsBtn.textContent = 'All';
    } else {
        selectedColumns = new Set(allColumns);
        toggleAllColsBtn.textContent = 'None';
    }
    renderColumnList();
}

// --- UI States ---

function showInitialState() {
    resultsCount.innerHTML = '';
    resultsArea.innerHTML = `
        <div class="empty-state fade-in">
            <div class="empty-icon">🔎</div>
            <h3>Search across your spreadsheets</h3>
            <p>Enter a search term above to find matching data across all loaded files.</p>
        </div>
    `;
}

function showEmptyData() {
    resultsCount.innerHTML = '';
    resultsArea.innerHTML = `
        <div class="no-data-banner fade-in">
            ⚠️ No spreadsheets found. Place <strong>.csv</strong> or <strong>.xlsx</strong> files in the <code>data/</code> folder and click <strong>Reload</strong>.
        </div>
        <div class="empty-state fade-in">
            <div class="empty-icon">📂</div>
            <h3>No data loaded</h3>
            <p>Add your spreadsheet files to the data directory and reload to get started.</p>
        </div>
    `;
}

function showLoading() {
    resultsArea.innerHTML = `
        <div class="loading-state">
            <span class="loading-spinner"></span>
            Searching…
        </div>
    `;
}

// --- Utilities ---

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function highlightText(text, query) {
    if (!query) return escapeHtml(text);
    const escaped = escapeHtml(text);
    const escapedQuery = escapeHtml(query);
    const regex = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escaped.replace(regex, '<mark style="background:rgba(0,166,80,0.25);color:#86efac;padding:1px 2px;border-radius:2px;">$1</mark>');
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `${type === 'success' ? '✓' : '✗'} ${message}`;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(40px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
