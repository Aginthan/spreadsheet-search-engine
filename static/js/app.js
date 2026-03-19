/**
 * Spreadsheet Search Engine - Frontend Application
 */

const bootstrap = window.APP_BOOTSTRAP || { user: null, settings: {} };

// --- State ---
let appSettings = bootstrap.settings || {};
let currentUser = bootstrap.user || {};
let sourceDirectories = [];
let spreadsheetData = [];
let selectedFiles = new Set();
let selectedColumns = new Set();
let allColumns = [];
let searchResults = [];
let currentPage = 1;

// --- DOM Elements ---
const brandTitle = document.getElementById('brand-title');
const brandSubtitle = document.getElementById('brand-subtitle');
const logoFrame = document.getElementById('logo-frame');
const resultsArea = document.getElementById('results-area');
const resultsSummary = document.getElementById('results-summary');
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const directoryInput = document.getElementById('directory-input');
const addDirectoryBtn = document.getElementById('add-directory-btn');
const directoryListEl = document.getElementById('directory-list');
const fileListEl = document.getElementById('file-list');
const columnListEl = document.getElementById('column-list');
const statsFiles = document.getElementById('stats-files');
const statsRows = document.getElementById('stats-rows');
const statsCols = document.getElementById('stats-cols');
const toggleAllFilesBtn = document.getElementById('toggle-all-files');
const toggleAllColsBtn = document.getElementById('toggle-all-cols');
const reloadBtn = document.getElementById('reload-btn');
const settingsForm = document.getElementById('settings-form');
const settingsAppName = document.getElementById('settings-app-name');
const settingsSubtitle = document.getElementById('settings-subtitle');
const settingsResultsPerPage = document.getElementById('settings-results-per-page');
const settingsLogo = document.getElementById('settings-logo');
const settingsLogoPreview = document.getElementById('settings-logo-preview');
const userForm = document.getElementById('user-form');
const userList = document.getElementById('user-list');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    renderBranding();
    initializeApp();
});

function bindEvents() {
    tabButtons.forEach((button) => {
        button.addEventListener('click', () => activateTab(button.dataset.tabTarget));
    });

    if (searchInput) {
        searchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                performSearch();
            }
        });
    }

    if (directoryInput) {
        directoryInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                addDirectory();
            }
        });
    }

    searchBtn?.addEventListener('click', performSearch);
    addDirectoryBtn?.addEventListener('click', addDirectory);
    reloadBtn?.addEventListener('click', reloadData);
    toggleAllFilesBtn?.addEventListener('click', toggleAllFiles);
    toggleAllColsBtn?.addEventListener('click', toggleAllColumns);
    settingsForm?.addEventListener('submit', saveSettings);
    settingsLogo?.addEventListener('change', previewLogo);
    userForm?.addEventListener('submit', createUser);
}

async function initializeApp() {
    await Promise.all([loadDirectories(), loadSpreadsheets()]);
    if (currentUser.is_admin) {
        await loadUsers();
    }
}

function activateTab(targetId) {
    tabButtons.forEach((button) => {
        button.classList.toggle('active', button.dataset.tabTarget === targetId);
    });

    tabPanels.forEach((panel) => {
        panel.classList.toggle('active', panel.id === targetId);
    });
}

// --- API Calls ---

async function loadDirectories() {
    try {
        const response = await fetch('/api/directories');
        sourceDirectories = await response.json();
        renderDirectoryList();
    } catch (error) {
        console.error('Failed to load directories:', error);
        showToast('Failed to load source folders.', 'error');
    }
}

async function loadSpreadsheets() {
    try {
        const response = await fetch('/api/spreadsheets');
        spreadsheetData = await response.json();

        const previousFiles = selectedFiles;
        const previousColumns = selectedColumns;

        const columnSet = new Set();
        spreadsheetData.forEach((file) => file.columns.forEach((column) => columnSet.add(column)));
        allColumns = Array.from(columnSet).sort();

        const availableFileIds = new Set(spreadsheetData.map((file) => file.id));
        const availableColumns = new Set(allColumns);

        const retainedFiles = Array.from(previousFiles).filter((id) => availableFileIds.has(id));
        const retainedColumns = Array.from(previousColumns).filter((column) => availableColumns.has(column));

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
            showEmptyState('No spreadsheets found yet', 'Connect folders and reload to search their files.');
        }
    } catch (error) {
        console.error('Failed to load spreadsheets:', error);
        showToast('Failed to load spreadsheets.', 'error');
    }
}

async function addDirectory() {
    const path = directoryInput?.value.trim();
    if (!path) {
        directoryInput?.focus();
        return;
    }

    setDirectoryFormDisabled(true);

    try {
        const response = await fetch('/api/directories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to add directory.');
        }

        directoryInput.value = '';
        await Promise.all([loadDirectories(), loadSpreadsheets()]);
        showToast(data.message, 'success');
    } catch (error) {
        console.error('Failed to add directory:', error);
        showToast(error.message || 'Failed to add directory.', 'error');
    } finally {
        setDirectoryFormDisabled(false);
    }
}

async function removeDirectory(path) {
    try {
        const response = await fetch('/api/directories', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to remove directory.');
        }

        await Promise.all([loadDirectories(), loadSpreadsheets()]);
        showToast(data.message, 'success');
    } catch (error) {
        console.error('Failed to remove directory:', error);
        showToast(error.message || 'Failed to remove directory.', 'error');
    }
}

async function reloadData() {
    reloadBtn.disabled = true;
    reloadBtn.textContent = 'Reloading...';

    try {
        const response = await fetch('/api/reload', { method: 'POST' });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to reload spreadsheets.');
        }

        await Promise.all([loadDirectories(), loadSpreadsheets()]);
        showToast(data.message, 'success');
    } catch (error) {
        console.error('Reload failed:', error);
        showToast(error.message || 'Failed to reload spreadsheets.', 'error');
    } finally {
        reloadBtn.disabled = false;
        reloadBtn.textContent = 'Reload';
    }
}

async function performSearch() {
    const query = searchInput?.value.trim();
    if (!query) {
        searchInput?.focus();
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
        const response = await fetch(`/api/search?${params.toString()}`);
        const data = await response.json();
        searchResults = data.results || [];
        currentPage = 1;
        renderResults(data.query || '');
    } catch (error) {
        console.error('Search failed:', error);
        showToast('Search failed. Please try again.', 'error');
        showEmptyState('Search failed', 'Please try again after reloading the spreadsheet sources.');
    }
}

async function saveSettings(event) {
    event.preventDefault();
    const formData = new FormData(settingsForm);

    try {
        const response = await fetch('/api/settings', {
            method: 'POST',
            body: formData,
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to save settings.');
        }

        appSettings = data.settings;
        renderBranding();
        if (settingsResultsPerPage) {
            settingsResultsPerPage.value = appSettings.results_per_page;
        }
        if (searchResults.length > 0) {
            renderResults(searchInput.value.trim());
        }
        showToast(data.message, 'success');
    } catch (error) {
        console.error('Failed to save settings:', error);
        showToast(error.message || 'Failed to save settings.', 'error');
    }
}

async function loadUsers() {
    if (!userList) {
        return;
    }

    try {
        const response = await fetch('/api/users');
        const users = await response.json();
        renderUsers(users);
    } catch (error) {
        console.error('Failed to load users:', error);
        userList.innerHTML = '<div class="loading-line">Unable to load users.</div>';
    }
}

async function createUser(event) {
    event.preventDefault();

    const username = document.getElementById('new-username').value.trim();
    const password = document.getElementById('new-password').value;
    const isAdmin = document.getElementById('new-user-admin').checked;

    try {
        const response = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                password,
                is_admin: isAdmin,
            }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to create user.');
        }

        userForm.reset();
        await loadUsers();
        showToast(data.message, 'success');
    } catch (error) {
        console.error('Failed to create user:', error);
        showToast(error.message || 'Failed to create user.', 'error');
    }
}

// --- Rendering ---

function renderBranding() {
    if (brandTitle) {
        brandTitle.textContent = appSettings.app_name || 'SKA Search Hub';
    }
    if (brandSubtitle) {
        brandSubtitle.textContent = appSettings.subtitle || '';
    }
    if (settingsAppName) {
        settingsAppName.value = appSettings.app_name || '';
    }
    if (settingsSubtitle) {
        settingsSubtitle.value = appSettings.subtitle || '';
    }
    if (settingsResultsPerPage) {
        settingsResultsPerPage.value = appSettings.results_per_page || 8;
    }
    renderLogoMarkup(appSettings.logo_url);
}

function renderLogoMarkup(logoUrl) {
    if (!logoFrame) {
        return;
    }

    if (logoUrl) {
        logoFrame.innerHTML = `<img src="${escapeHtml(logoUrl)}" alt="Application logo" class="brand-logo-image">`;
        if (settingsLogoPreview) {
            settingsLogoPreview.innerHTML = `<img src="${escapeHtml(logoUrl)}" alt="Application logo" class="brand-logo-image">`;
        }
        return;
    }

    logoFrame.innerHTML = '<div class="brand-logo-placeholder">SKA</div>';
    if (settingsLogoPreview) {
        settingsLogoPreview.innerHTML = '<div class="brand-logo-placeholder">SKA</div>';
    }
}

function renderDirectoryList() {
    if (!directoryListEl) {
        return;
    }

    directoryListEl.innerHTML = '';
    if (sourceDirectories.length === 0) {
        directoryListEl.innerHTML = '<li class="loading-line">No source folders configured.</li>';
        return;
    }

    sourceDirectories.forEach((directory) => {
        const item = document.createElement('li');
        item.className = 'stack-item';

        const removeAction = currentUser.is_admin && !directory.is_default
            ? `<button class="inline-link" data-remove-path="${escapeAttribute(directory.path)}">Remove</button>`
            : '<span class="micro-pill muted">Protected</span>';

        item.innerHTML = `
            <div class="stack-main">
                <div class="stack-title-row">
                    <strong>${directory.type === 'network' ? 'Network' : 'Local'} source</strong>
                    <span class="micro-pill ${directory.exists ? 'success' : 'warning'}">${directory.exists ? 'Available' : 'Missing'}</span>
                </div>
                <span class="stack-path">${escapeHtml(directory.path)}</span>
            </div>
            ${removeAction}
        `;

        const removeButton = item.querySelector('[data-remove-path]');
        if (removeButton) {
            removeButton.addEventListener('click', () => removeDirectory(directory.path));
        }

        directoryListEl.appendChild(item);
    });
}

function renderFileList() {
    fileListEl.innerHTML = '';

    if (spreadsheetData.length === 0) {
        fileListEl.innerHTML = '<li class="loading-line">No spreadsheet files loaded.</li>';
        return;
    }

    spreadsheetData.forEach((file) => {
        const item = document.createElement('li');
        item.className = `selectable-item ${selectedFiles.has(file.id) ? 'active' : ''}`;
        item.innerHTML = `
            <input type="checkbox" ${selectedFiles.has(file.id) ? 'checked' : ''}>
            <div class="stack-main">
                <strong>${escapeHtml(file.filename)}</strong>
                <span class="stack-path">${escapeHtml(file.directory)}</span>
            </div>
            <span class="micro-pill neutral">${file.row_count} rows</span>
        `;

        const checkbox = item.querySelector('input');
        item.addEventListener('click', (event) => {
            if (event.target !== checkbox) {
                checkbox.checked = !checkbox.checked;
            }

            if (checkbox.checked) {
                selectedFiles.add(file.id);
            } else {
                selectedFiles.delete(file.id);
            }

            item.classList.toggle('active', checkbox.checked);
            toggleAllFilesBtn.textContent = selectedFiles.size === spreadsheetData.length ? 'None' : 'All';
        });

        fileListEl.appendChild(item);
    });
}

function renderColumnList() {
    columnListEl.innerHTML = '';

    if (allColumns.length === 0) {
        columnListEl.innerHTML = '<li class="loading-line">No columns available yet.</li>';
        return;
    }

    allColumns.forEach((column) => {
        const item = document.createElement('li');
        item.className = `selectable-item ${selectedColumns.has(column) ? 'active' : ''}`;
        item.innerHTML = `
            <input type="checkbox" ${selectedColumns.has(column) ? 'checked' : ''}>
            <div class="stack-main">
                <strong>${escapeHtml(column)}</strong>
                <span class="stack-path">Column filter</span>
            </div>
        `;

        const checkbox = item.querySelector('input');
        item.addEventListener('click', (event) => {
            if (event.target !== checkbox) {
                checkbox.checked = !checkbox.checked;
            }

            if (checkbox.checked) {
                selectedColumns.add(column);
            } else {
                selectedColumns.delete(column);
            }

            item.classList.toggle('active', checkbox.checked);
            toggleAllColsBtn.textContent = selectedColumns.size === allColumns.length ? 'None' : 'All';
        });

        columnListEl.appendChild(item);
    });
}

function renderResults(query) {
    if (!searchResults.length) {
        resultsSummary.textContent = query ? '0 matches found' : 'Ready to search';
        showEmptyState('No results found', 'Try a different search term or narrow the selected files and columns.');
        return;
    }

    const pageSize = Number(appSettings.results_per_page || 8);
    const totalPages = Math.max(1, Math.ceil(searchResults.length / pageSize));
    currentPage = Math.min(currentPage, totalPages);
    const startIndex = (currentPage - 1) * pageSize;
    const pageResults = searchResults.slice(startIndex, startIndex + pageSize);

    resultsSummary.innerHTML = `
        Showing <strong>${startIndex + 1}-${Math.min(startIndex + pageSize, searchResults.length)}</strong>
        of <strong>${searchResults.length}</strong> matches
    `;

    const cardsMarkup = pageResults.map((result) => {
        const fieldsMarkup = Object.entries(result.data)
            .map(([column, value]) => `
                <div class="result-field">
                    <span class="result-field-label">${escapeHtml(column)}</span>
                    <p class="result-field-value">${highlightText(value || '', query)}</p>
                </div>
            `)
            .join('');

        return `
            <article class="result-card">
                <div class="result-card-top">
                    <div>
                        <p class="panel-kicker">Source file</p>
                        <h3>${escapeHtml(result.source_file)}</h3>
                    </div>
                    <span class="micro-pill success">Match</span>
                </div>
                <p class="result-source-path">${escapeHtml(result.source_directory)}</p>
                <div class="result-fields-grid">
                    ${fieldsMarkup}
                </div>
            </article>
        `;
    }).join('');

    resultsArea.innerHTML = `
        <div class="results-grid">
            ${cardsMarkup}
        </div>
        <div class="pagination-bar">
            <button class="ghost-btn" id="prev-page" ${currentPage === 1 ? 'disabled' : ''}>Previous</button>
            <span>Page ${currentPage} of ${totalPages}</span>
            <button class="ghost-btn" id="next-page" ${currentPage === totalPages ? 'disabled' : ''}>Next</button>
        </div>
    `;

    document.getElementById('prev-page')?.addEventListener('click', () => {
        currentPage -= 1;
        renderResults(query);
    });

    document.getElementById('next-page')?.addEventListener('click', () => {
        currentPage += 1;
        renderResults(query);
    });
}

function renderUsers(users) {
    if (!userList) {
        return;
    }

    if (!users.length) {
        userList.innerHTML = '<div class="loading-line">No users created yet.</div>';
        return;
    }

    userList.innerHTML = users.map((user) => `
        <article class="user-card">
            <div>
                <strong>${escapeHtml(user.username)}</strong>
                <p class="stack-path">Created ${escapeHtml(user.created_at)}</p>
            </div>
            <div class="user-card-badges">
                <span class="micro-pill ${user.is_admin ? 'success' : 'neutral'}">${user.is_admin ? 'Administrator' : 'User'}</span>
                <span class="micro-pill ${user.is_active ? 'neutral' : 'warning'}">${user.is_active ? 'Active' : 'Disabled'}</span>
            </div>
        </article>
    `).join('');
}

function updateStats() {
    const totalFiles = spreadsheetData.length;
    const totalRows = spreadsheetData.reduce((sum, file) => sum + file.row_count, 0);
    const totalCols = allColumns.length;

    statsFiles.textContent = totalFiles;
    statsRows.textContent = totalRows.toLocaleString();
    statsCols.textContent = totalCols;
}

// --- Helpers ---

function toggleAllFiles() {
    const allSelected = selectedFiles.size === spreadsheetData.length;
    selectedFiles = allSelected ? new Set() : new Set(spreadsheetData.map((file) => file.id));
    toggleAllFilesBtn.textContent = allSelected ? 'All' : 'None';
    renderFileList();
}

function toggleAllColumns() {
    const allSelected = selectedColumns.size === allColumns.length;
    selectedColumns = allSelected ? new Set() : new Set(allColumns);
    toggleAllColsBtn.textContent = allSelected ? 'All' : 'None';
    renderColumnList();
}

function setDirectoryFormDisabled(disabled) {
    if (!directoryInput || !addDirectoryBtn) {
        return;
    }
    directoryInput.disabled = disabled;
    addDirectoryBtn.disabled = disabled;
    addDirectoryBtn.textContent = disabled ? 'Adding...' : 'Add';
}

function previewLogo() {
    const file = settingsLogo?.files?.[0];
    if (!file) {
        renderLogoMarkup(appSettings.logo_url);
        return;
    }

    const previewUrl = URL.createObjectURL(file);
    settingsLogoPreview.innerHTML = `<img src="${previewUrl}" alt="Logo preview" class="brand-logo-image">`;
}

function showLoading() {
    resultsArea.innerHTML = '<div class="loading-panel">Searching connected spreadsheets...</div>';
}

function showEmptyState(title, copy) {
    resultsArea.innerHTML = `
        <div class="empty-state">
            <div class="empty-mark">SKA</div>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(copy)}</p>
        </div>
    `;
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
}

function escapeAttribute(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, '_');
}

function highlightText(text, query) {
    if (!query) {
        return escapeHtml(text);
    }

    const escapedText = escapeHtml(text);
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escapedText.replace(regex, '<mark>$1</mark>');
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 2600);
}
