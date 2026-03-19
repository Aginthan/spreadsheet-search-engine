/**
 * Spreadsheet Search Engine - Frontend Application
 */

// --- State ---
let sourceDirectories = [];
let spreadsheetData = [];
let selectedFiles = new Set();
let selectedColumns = new Set();
let allColumns = [];

// --- DOM Elements ---
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const directoryInput = document.getElementById('directory-input');
const addDirectoryBtn = document.getElementById('add-directory-btn');
const directoryListEl = document.getElementById('directory-list');
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
    initializeApp();

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            performSearch();
        }
    });

    directoryInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            addDirectory();
        }
    });

    searchBtn.addEventListener('click', performSearch);
    addDirectoryBtn.addEventListener('click', addDirectory);
    reloadBtn.addEventListener('click', reloadData);
    toggleAllFilesBtn.addEventListener('click', toggleAllFiles);
    toggleAllColsBtn.addEventListener('click', toggleAllColumns);
});

async function initializeApp() {
    await Promise.all([loadDirectories(), loadSpreadsheets()]);
}

// --- API Calls ---

async function loadDirectories() {
    try {
        const res = await fetch('/api/directories');
        sourceDirectories = await res.json();
        renderDirectoryList();
    } catch (err) {
        console.error('Failed to load directories:', err);
        showToast('Failed to load source folders.', 'error');
    }
}

async function loadSpreadsheets() {
    try {
        const res = await fetch('/api/spreadsheets');
        spreadsheetData = await res.json();

        const previousFiles = selectedFiles;
        const previousColumns = selectedColumns;

        const colSet = new Set();
        spreadsheetData.forEach((file) => file.columns.forEach((col) => colSet.add(col)));
        allColumns = Array.from(colSet).sort();

        const availableFileIds = new Set(spreadsheetData.map((file) => file.id));
        const availableColumns = new Set(allColumns);

        const retainedFiles = Array.from(previousFiles).filter((id) => availableFileIds.has(id));
        const retainedColumns = Array.from(previousColumns).filter((col) => availableColumns.has(col));

        selectedFiles = retainedFiles.length > 0 || spreadsheetData.length === 0
            ? new Set(retainedFiles)
            : new Set(spreadsheetData.map((file) => file.id));

        selectedColumns = retainedColumns.length > 0 || allColumns.length === 0
            ? new Set(retainedColumns)
            : new Set(allColumns);

        toggleAllFilesBtn.textContent = selectedFiles.size === spreadsheetData.length ? 'None' : 'All';
        toggleAllColsBtn.textContent = selectedColumns.size === allColumns.length ? 'None' : 'All';

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

async function addDirectory() {
    const path = directoryInput.value.trim();
    if (!path) {
        directoryInput.focus();
        return;
    }

    setDirectoryFormDisabled(true);

    try {
        const res = await fetch('/api/directories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
        });
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Failed to add directory.');
        }

        directoryInput.value = '';
        await Promise.all([loadDirectories(), loadSpreadsheets()]);
        showToast(data.message, 'success');
    } catch (err) {
        console.error('Failed to add directory:', err);
        showToast(err.message || 'Failed to add directory.', 'error');
    } finally {
        setDirectoryFormDisabled(false);
    }
}

async function removeDirectory(path) {
    try {
        const res = await fetch('/api/directories', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
        });
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Failed to remove directory.');
        }

        await Promise.all([loadDirectories(), loadSpreadsheets()]);
        showToast(data.message, 'success');
    } catch (err) {
        console.error('Failed to remove directory:', err);
        showToast(err.message || 'Failed to remove directory.', 'error');
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
        const res = await fetch(`/api/search?${params.toString()}`);
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
        await Promise.all([loadDirectories(), loadSpreadsheets()]);
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

function renderDirectoryList() {
    directoryListEl.innerHTML = '';

    if (sourceDirectories.length === 0) {
        directoryListEl.innerHTML = '<li class="empty-list-message">No source folders configured.</li>';
        return;
    }

    sourceDirectories.forEach((directory) => {
        const li = document.createElement('li');
        li.className = 'directory-item';

        const canRemove = !directory.is_default;

        li.innerHTML = `
            <div class="directory-details">
                <div class="directory-title-row">
                    <span class="directory-title">${directory.type === 'network' ? '🌐' : '📂'} ${escapeHtml(directory.label)}</span>
                    <span class="directory-status ${directory.exists ? 'ok' : 'missing'}">
                        ${directory.exists ? 'Available' : 'Missing'}
                    </span>
                </div>
                <div class="directory-path" title="${escapeHtml(directory.path)}">${escapeHtml(directory.path)}</div>
            </div>
            <button class="directory-remove-btn" ${canRemove ? '' : 'disabled'} title="${canRemove ? 'Remove folder' : 'Default folder cannot be removed'}">
                Remove
            </button>
        `;

        const removeBtn = li.querySelector('.directory-remove-btn');
        if (canRemove) {
            removeBtn.addEventListener('click', () => removeDirectory(directory.path));
        }

        directoryListEl.appendChild(li);
    });
}

function renderFileList() {
    fileListEl.innerHTML = '';

    if (spreadsheetData.length === 0) {
        fileListEl.innerHTML = '<li class="empty-list-message">No spreadsheet files loaded.</li>';
        return;
    }

    spreadsheetData.forEach((file) => {
        const li = document.createElement('li');
        li.className = 'file-item' + (selectedFiles.has(file.id) ? ' active' : '');

        const isCSV = file.filename.toLowerCase().endsWith('.csv');
        const icon = isCSV ? '📄' : '📊';

        li.innerHTML = `
            <input type="checkbox" id="file-${escapeAttribute(file.id)}"
                   ${selectedFiles.has(file.id) ? 'checked' : ''}>
            <div class="file-text">
                <span class="file-name" title="${escapeHtml(file.filepath)}">${icon} ${escapeHtml(file.filename)}</span>
                <span class="file-subtitle">${escapeHtml(file.directory)}</span>
            </div>
            <span class="file-meta">${file.row_count} rows</span>
        `;

        const checkbox = li.querySelector('input');
        li.addEventListener('click', (e) => {
            if (e.target !== checkbox) {
                checkbox.checked = !checkbox.checked;
            }

            if (checkbox.checked) {
                selectedFiles.add(file.id);
                li.classList.add('active');
            } else {
                selectedFiles.delete(file.id);
                li.classList.remove('active');
            }

            toggleAllFilesBtn.textContent = selectedFiles.size === spreadsheetData.length ? 'None' : 'All';
        });

        fileListEl.appendChild(li);
    });
}

function renderColumnList() {
    columnListEl.innerHTML = '';

    if (allColumns.length === 0) {
        columnListEl.innerHTML = '<li class="empty-list-message">No columns available yet.</li>';
        return;
    }

    allColumns.forEach((col) => {
        const li = document.createElement('li');
        li.className = 'column-item';

        li.innerHTML = `
            <input type="checkbox" id="col-${escapeAttribute(col)}"
                   ${selectedColumns.has(col) ? 'checked' : ''}>
            <label for="col-${escapeAttribute(col)}">${escapeHtml(col)}</label>
        `;

        const checkbox = li.querySelector('input');
        li.addEventListener('click', (e) => {
            if (e.target !== checkbox && e.target.tagName !== 'LABEL') {
                checkbox.checked = !checkbox.checked;
            }

            setTimeout(() => {
                if (checkbox.checked) {
                    selectedColumns.add(col);
                } else {
                    selectedColumns.delete(col);
                }
                toggleAllColsBtn.textContent = selectedColumns.size === allColumns.length ? 'None' : 'All';
            }, 0);
        });

        columnListEl.appendChild(li);
    });
}

function renderResults(data) {
    if (data.total === 0) {
        resultsCount.innerHTML = '<span>0</span> results';
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

    const resultCols = new Set();
    data.results.forEach((result) => Object.keys(result.data).forEach((key) => resultCols.add(key)));
    const columns = Array.from(resultCols);

    const queryLower = data.query.toLowerCase();
    let html = '<div class="results-table-wrapper"><table class="results-table">';

    html += '<thead><tr><th>Source</th>';
    columns.forEach((col) => {
        html += `<th>${escapeHtml(col)}</th>`;
    });
    html += '</tr></thead>';

    html += '<tbody>';
    data.results.forEach((result) => {
        html += '<tr>';
        html += `
            <td>
                <div class="source-cell">
                    <span class="source-badge">📄 ${escapeHtml(result.source_file)}</span>
                    <span class="source-path" title="${escapeHtml(result.source_directory)}">${escapeHtml(result.source_directory)}</span>
                </div>
            </td>
        `;

        columns.forEach((col) => {
            const value = result.data[col] || '';
            const isMatch = value.toLowerCase().includes(queryLower);
            html += `<td class="${isMatch ? 'highlight' : ''}">${highlightText(value, data.query)}</td>`;
        });

        html += '</tr>';
    });
    html += '</tbody></table></div>';

    resultsArea.innerHTML = html;
}

function updateStats() {
    const totalFiles = spreadsheetData.length;
    const totalRows = spreadsheetData.reduce((sum, file) => sum + file.row_count, 0);
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
        selectedFiles = new Set(spreadsheetData.map((file) => file.id));
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

function setDirectoryFormDisabled(disabled) {
    directoryInput.disabled = disabled;
    addDirectoryBtn.disabled = disabled;
    addDirectoryBtn.textContent = disabled ? 'Adding…' : 'Add';
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
            ⚠️ No spreadsheets found. Add a local folder, mounted share, or UNC path and click <strong>Reload</strong>.
        </div>
        <div class="empty-state fade-in">
            <div class="empty-icon">📂</div>
            <h3>No data loaded</h3>
            <p>Add source folders in the sidebar, then reload to search their spreadsheet files.</p>
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

function escapeAttribute(str) {
    return String(str).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function highlightText(text, query) {
    if (!query) {
        return escapeHtml(text);
    }

    const escaped = escapeHtml(text);
    const escapedQuery = escapeHtml(query);
    const regex = new RegExp(`(${escapedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escaped.replace(regex, '<mark style="background:rgba(99,102,241,0.25);color:#c7d2fe;padding:1px 2px;border-radius:2px;">$1</mark>');
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `${type === 'success' ? '✓' : '✗'} ${escapeHtml(message)}`;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(40px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
