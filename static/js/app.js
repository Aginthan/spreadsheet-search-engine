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
let autocompleteItems = [];
let activeSuggestionIndex = -1;
let autocompleteController = null;
let autocompleteDebounce = null;

// --- DOM Elements ---
const brandTitle = document.getElementById('brand-title');
const brandSubtitle = document.getElementById('brand-subtitle');
const logoFrame = document.getElementById('logo-frame');
const resultsArea = document.getElementById('results-area');
const resultsSummary = document.getElementById('results-summary');
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const autocompleteList = document.getElementById('autocomplete-list');
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
const newUserAdmin = document.getElementById('new-user-admin');
const permSearch = document.getElementById('perm-search');
const permSettings = document.getElementById('perm-settings');
const permUsers = document.getElementById('perm-users');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
const themeToggle = document.getElementById('theme-toggle');
const themeToggleLabel = document.getElementById('theme-toggle-label');

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
        searchInput.addEventListener('input', handleAutocompleteInput);
        searchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                if (activeSuggestionIndex >= 0 && autocompleteItems[activeSuggestionIndex]) {
                    event.preventDefault();
                    applySuggestion(autocompleteItems[activeSuggestionIndex].value);
                    return;
                }
                performSearch();
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                moveActiveSuggestion(1);
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                moveActiveSuggestion(-1);
            } else if (event.key === 'Escape') {
                hideAutocomplete();
            }
        });
        searchInput.addEventListener('blur', () => {
            window.setTimeout(hideAutocomplete, 120);
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
    newUserAdmin?.addEventListener('change', syncUserPermissionInputs);
    themeToggle?.addEventListener('click', toggleTheme);
}

async function initializeApp() {
    syncThemeToggle();
    syncUserPermissionInputs();
    initializeVisibleTab();
    await Promise.all([loadDirectories(), loadSpreadsheets()]);
    if (currentUser.permissions?.can_view_users) {
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

function initializeVisibleTab() {
    const firstTab = document.querySelector('.tab-btn');
    if (firstTab) {
        activateTab(firstTab.dataset.tabTarget);
    }
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

        if (toggleAllFilesBtn) {
            toggleAllFilesBtn.textContent = selectedFiles.size === spreadsheetData.length ? 'None' : 'All';
        }
        if (toggleAllColsBtn) {
            toggleAllColsBtn.textContent = selectedColumns.size === allColumns.length ? 'None' : 'All';
        }

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

    hideAutocomplete();
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

async function fetchAutocomplete(query) {
    if (autocompleteController) {
        autocompleteController.abort();
    }

    autocompleteController = new AbortController();

    const params = new URLSearchParams({ q: query });
    if (selectedColumns.size > 0 && selectedColumns.size < allColumns.length) {
        params.set('columns', Array.from(selectedColumns).join(','));
    }
    if (selectedFiles.size > 0 && selectedFiles.size < spreadsheetData.length) {
        params.set('files', Array.from(selectedFiles).join(','));
    }

    try {
        const response = await fetch(`/api/autocomplete?${params.toString()}`, {
            signal: autocompleteController.signal,
        });
        const data = await response.json();
        autocompleteItems = data.suggestions || [];
        activeSuggestionIndex = -1;
        renderAutocomplete();
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Autocomplete failed:', error);
        }
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
    const isAdmin = newUserAdmin.checked;

    try {
        const response = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                password,
                is_admin: isAdmin,
                permissions: {
                    can_view_search: permSearch?.checked ?? true,
                    can_view_settings: permSettings?.checked ?? false,
                    can_view_users: permUsers?.checked ?? false,
                },
            }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to create user.');
        }

        userForm.reset();
        syncUserPermissionInputs();
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
            if (toggleAllFilesBtn) {
                toggleAllFilesBtn.textContent = selectedFiles.size === spreadsheetData.length ? 'None' : 'All';
            }
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
            if (toggleAllColsBtn) {
                toggleAllColsBtn.textContent = selectedColumns.size === allColumns.length ? 'None' : 'All';
            }
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

function renderAutocomplete() {
    if (!autocompleteList) {
        return;
    }

    if (!autocompleteItems.length) {
        hideAutocomplete();
        return;
    }

    autocompleteList.innerHTML = autocompleteItems.map((item, index) => `
        <button class="autocomplete-item ${index === activeSuggestionIndex ? 'active' : ''}" type="button" data-index="${index}">
            <span class="autocomplete-value">${highlightText(item.value, searchInput.value.trim())}</span>
            <span class="autocomplete-meta">${escapeHtml(item.column)} · ${escapeHtml(item.source_file)}</span>
        </button>
    `).join('');

    autocompleteList.classList.remove('hidden');
    autocompleteList.querySelectorAll('.autocomplete-item').forEach((button) => {
        button.addEventListener('mousedown', () => {
            const index = Number(button.dataset.index);
            applySuggestion(autocompleteItems[index].value);
        });
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
                <span class="micro-pill muted">${user.permissions.can_view_search ? 'Search' : 'No search'}</span>
                <span class="micro-pill muted">${user.permissions.can_view_settings ? 'Settings' : 'No settings'}</span>
                <span class="micro-pill muted">${user.permissions.can_view_users ? 'Users' : 'No users'}</span>
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

function handleAutocompleteInput() {
    clearTimeout(autocompleteDebounce);
    const query = searchInput.value.trim();

    if (query.length < 2) {
        autocompleteItems = [];
        activeSuggestionIndex = -1;
        hideAutocomplete();
        return;
    }

    autocompleteDebounce = window.setTimeout(() => {
        fetchAutocomplete(query);
    }, 180);
}

function moveActiveSuggestion(direction) {
    if (!autocompleteItems.length) {
        return;
    }

    activeSuggestionIndex = (activeSuggestionIndex + direction + autocompleteItems.length) % autocompleteItems.length;
    renderAutocomplete();
}

function applySuggestion(value) {
    searchInput.value = value;
    hideAutocomplete();
    performSearch();
}

function hideAutocomplete() {
    if (!autocompleteList) {
        return;
    }
    autocompleteList.classList.add('hidden');
    autocompleteList.innerHTML = '';
    activeSuggestionIndex = -1;
}

function toggleAllFiles() {
    const allSelected = selectedFiles.size === spreadsheetData.length;
    selectedFiles = allSelected ? new Set() : new Set(spreadsheetData.map((file) => file.id));
    if (toggleAllFilesBtn) {
        toggleAllFilesBtn.textContent = allSelected ? 'All' : 'None';
    }
    renderFileList();
}

function toggleAllColumns() {
    const allSelected = selectedColumns.size === allColumns.length;
    selectedColumns = allSelected ? new Set() : new Set(allColumns);
    if (toggleAllColsBtn) {
        toggleAllColsBtn.textContent = allSelected ? 'All' : 'None';
    }
    renderColumnList();
}

function toggleTheme() {
    const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    if (nextTheme === 'dark') {
        document.documentElement.dataset.theme = 'dark';
    } else {
        delete document.documentElement.dataset.theme;
    }
    localStorage.setItem('ska-theme', nextTheme);
    syncThemeToggle();
}

function syncThemeToggle() {
    if (!themeToggle || !themeToggleLabel) {
        return;
    }
    const isDark = document.documentElement.dataset.theme === 'dark';
    themeToggle.setAttribute('aria-pressed', String(isDark));
    themeToggle.classList.toggle('active', isDark);
    themeToggleLabel.textContent = isDark ? 'Light mode' : 'Dark mode';
}

function syncUserPermissionInputs() {
    if (!newUserAdmin) {
        return;
    }

    const isAdmin = newUserAdmin.checked;
    const permissionInputs = [permSearch, permSettings, permUsers].filter(Boolean);

    permissionInputs.forEach((input) => {
        input.disabled = isAdmin;
    });

    if (isAdmin) {
        if (permSearch) permSearch.checked = true;
        if (permSettings) permSettings.checked = true;
        if (permUsers) permUsers.checked = true;
        return;
    }

    if (permSearch && !permSearch.checked) {
        permSearch.checked = true;
    }
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
