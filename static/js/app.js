/**
 * Xcelerate frontend application.
 */

const bootstrap = window.APP_BOOTSTRAP || { user: null, settings: {} };

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
let savedSearches = [];
let searchHistory = [];
let favoriteFiles = [];
let auditEntries = [];
let currentSearchState = { query: '', selected_files: [], selected_columns: [] };

const brandTitle = document.getElementById('brand-title');
const brandSubtitle = document.getElementById('brand-subtitle');
const logoFrame = document.getElementById('logo-frame');
const resultsArea = document.getElementById('results-area');
const resultsSummary = document.getElementById('results-summary');
const clearResultsBtn = document.getElementById('clear-results-btn');
const saveCurrentSearchBtn = document.getElementById('save-current-search-btn');
const exportResultsBtn = document.getElementById('export-results-btn');
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
const settingsIdleTimeout = document.getElementById('settings-idle-timeout');
const settingsLogo = document.getElementById('settings-logo');
const settingsLogoPreview = document.getElementById('settings-logo-preview');
const userForm = document.getElementById('user-form');
const userList = document.getElementById('user-list');
const newUserAdmin = document.getElementById('new-user-admin');
const permSearch = document.getElementById('perm-search');
const permSources = document.getElementById('perm-sources');
const permSettings = document.getElementById('perm-settings');
const permUsers = document.getElementById('perm-users');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
const themeToggle = document.getElementById('theme-toggle');
const themeToggleLabel = document.getElementById('theme-toggle-label');
const savedSearchForm = document.getElementById('saved-search-form');
const savedSearchName = document.getElementById('saved-search-name');
const savedSearchList = document.getElementById('saved-search-list');
const clearSavedSearchesBtn = document.getElementById('clear-saved-searches-btn');
const historyList = document.getElementById('history-list');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const favoritesList = document.getElementById('favorites-list');
const headerOverrideList = document.getElementById('header-override-list');
const auditLogList = document.getElementById('audit-log-list');

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

    searchBtn?.addEventListener('click', () => performSearch());
    clearResultsBtn?.addEventListener('click', clearResults);
    saveCurrentSearchBtn?.addEventListener('click', handleSaveCurrentSearchClick);
    exportResultsBtn?.addEventListener('click', exportResultsPdf);
    addDirectoryBtn?.addEventListener('click', addDirectory);
    reloadBtn?.addEventListener('click', reloadData);
    toggleAllFilesBtn?.addEventListener('click', toggleAllFiles);
    toggleAllColsBtn?.addEventListener('click', toggleAllColumns);
    settingsForm?.addEventListener('submit', saveSettings);
    settingsLogo?.addEventListener('change', previewLogo);
    userForm?.addEventListener('submit', createUser);
    newUserAdmin?.addEventListener('change', syncUserPermissionInputs);
    themeToggle?.addEventListener('click', toggleTheme);
    savedSearchForm?.addEventListener('submit', createSavedSearch);
    clearSavedSearchesBtn?.addEventListener('click', clearSavedSearches);
    clearHistoryBtn?.addEventListener('click', clearSearchHistory);
}

async function initializeApp() {
    syncThemeToggle();
    syncUserPermissionInputs();
    initializeVisibleTab();

    const tasks = [];
    if (currentUser.permissions?.can_view_sources) {
        tasks.push(loadDirectories());
    }
    if (currentUser.permissions?.can_view_search) {
        tasks.push(loadSpreadsheets());
        tasks.push(loadSavedSearches());
        tasks.push(loadSearchHistory());
        tasks.push(loadFavorites());
    }
    if (currentUser.permissions?.can_view_users) {
        tasks.push(loadUsers());
    }
    if (currentUser.is_admin) {
        tasks.push(loadAuditLog());
    }
    await Promise.all(tasks);
}

async function apiFetch(url, options = {}) {
    const response = await fetch(url, options);
    if (response.status === 401) {
        window.location.href = '/login';
        throw new Error('Session expired.');
    }
    return response;
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

async function loadDirectories() {
    if (!directoryListEl) {
        return;
    }

    try {
        const response = await apiFetch('/api/directories');
        sourceDirectories = await response.json();
        renderDirectoryList();
    } catch (error) {
        console.error('Failed to load directories:', error);
        showToast('Failed to load source folders.', 'error');
    }
}

async function loadSpreadsheets() {
    if (!fileListEl) {
        return;
    }

    try {
        const response = await apiFetch('/api/spreadsheets');
        spreadsheetData = await response.json();

        const previousFiles = new Set(selectedFiles);
        const previousColumns = new Set(selectedColumns);
        const columnSet = new Set();
        spreadsheetData.forEach((file) => file.columns.forEach((column) => columnSet.add(column)));
        allColumns = Array.from(columnSet).sort((left, right) => left.localeCompare(right));

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
        renderHeaderOverrides();
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
        const response = await apiFetch('/api/directories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to add directory.');
        }

        directoryInput.value = '';
        await Promise.all([loadDirectories(), loadSpreadsheets(), loadAuditLog()]);
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
        const response = await apiFetch('/api/directories', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to remove directory.');
        }

        await Promise.all([loadDirectories(), loadSpreadsheets(), loadAuditLog()]);
        showToast(data.message, 'success');
    } catch (error) {
        console.error('Failed to remove directory:', error);
        showToast(error.message || 'Failed to remove directory.', 'error');
    }
}

async function reloadData() {
    if (!reloadBtn) {
        return;
    }

    reloadBtn.disabled = true;
    reloadBtn.textContent = 'Reloading...';
    try {
        const response = await apiFetch('/api/reload', { method: 'POST' });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to reload spreadsheets.');
        }

        await Promise.all([loadDirectories(), loadSpreadsheets(), loadFavorites(), loadAuditLog()]);
        showToast(data.message, 'success');
    } catch (error) {
        console.error('Reload failed:', error);
        showToast(error.message || 'Failed to reload spreadsheets.', 'error');
    } finally {
        reloadBtn.disabled = false;
        reloadBtn.textContent = 'Reload';
    }
}

async function performSearch(nextState = null) {
    const state = nextState || getCurrentSearchStateFromUi();
    const query = state.query.trim();
    if (!query) {
        searchInput?.focus();
        return;
    }

    currentSearchState = state;
    hideAutocomplete();
    showLoading();

    const params = buildSearchParams(state);
    try {
        const response = await apiFetch(`/api/search?${params.toString()}`);
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Search failed.');
        }

        searchResults = data.results || [];
        currentPage = 1;
        renderResults(state.query);
        await loadSearchHistory();
    } catch (error) {
        console.error('Search failed:', error);
        showToast(error.message || 'Search failed. Please try again.', 'error');
        showEmptyState('Search failed', 'Please try again after reloading the spreadsheet sources.');
    }
}

async function fetchAutocomplete(query) {
    if (autocompleteController) {
        autocompleteController.abort();
    }

    autocompleteController = new AbortController();
    const params = buildSearchParams({
        query,
        selected_files: Array.from(selectedFiles),
        selected_columns: Array.from(selectedColumns),
    });

    try {
        const response = await apiFetch(`/api/autocomplete?${params.toString()}`, {
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
        const response = await apiFetch('/api/settings', {
            method: 'POST',
            body: formData,
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to save settings.');
        }

        appSettings = data.settings;
        renderBranding();
        if (searchResults.length > 0) {
            renderResults(currentSearchState.query || searchInput?.value.trim() || '');
        }
        await loadAuditLog();
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
        const response = await apiFetch('/api/users');
        const users = await response.json();
        renderUsers(users);
    } catch (error) {
        console.error('Failed to load users:', error);
        userList.innerHTML = '<div class="loading-line">Unable to load users.</div>';
    }
}

async function toggleUserActive(userId, nextState) {
    try {
        const response = await apiFetch(`/api/users/${userId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: nextState }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to update user.');
        }

        await Promise.all([loadUsers(), loadAuditLog()]);
        showToast(data.message, 'success');
    } catch (error) {
        console.error('Failed to update user:', error);
        showToast(error.message || 'Failed to update user.', 'error');
    }
}

async function deleteUser(userId) {
    try {
        const response = await apiFetch(`/api/users/${userId}`, { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to delete user.');
        }

        await Promise.all([loadUsers(), loadAuditLog()]);
        showToast(data.message, 'success');
    } catch (error) {
        console.error('Failed to delete user:', error);
        showToast(error.message || 'Failed to delete user.', 'error');
    }
}

async function createUser(event) {
    event.preventDefault();
    const username = document.getElementById('new-username').value.trim();
    const password = document.getElementById('new-password').value;
    const isAdmin = newUserAdmin.checked;

    try {
        const response = await apiFetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username,
                password,
                is_admin: isAdmin,
                permissions: {
                    can_view_search: permSearch?.checked ?? true,
                    can_view_sources: permSources?.checked ?? false,
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
        await Promise.all([loadUsers(), loadAuditLog()]);
        showToast(data.message, 'success');
    } catch (error) {
        console.error('Failed to create user:', error);
        showToast(error.message || 'Failed to create user.', 'error');
    }
}

async function loadSavedSearches() {
    if (!savedSearchList) {
        return;
    }
    try {
        const response = await apiFetch('/api/saved-searches');
        savedSearches = await response.json();
        renderSavedSearches();
    } catch (error) {
        console.error('Failed to load saved searches:', error);
        savedSearchList.innerHTML = '<div class="loading-line">Unable to load saved searches.</div>';
    }
}

async function createSavedSearch(event) {
    event.preventDefault();
    const state = getCurrentSearchStateFromUi();
    if (!state.query) {
        showToast('Run or type a search before saving it.', 'error');
        return;
    }

    const name = savedSearchName?.value.trim();
    if (!name) {
        savedSearchName?.focus();
        return;
    }

    try {
        const response = await apiFetch('/api/saved-searches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, ...state }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to save search.');
        }

        savedSearchForm.reset();
        await loadSavedSearches();
        showToast(data.message, 'success');
    } catch (error) {
        console.error('Failed to save search:', error);
        showToast(error.message || 'Failed to save search.', 'error');
    }
}

async function clearSavedSearches() {
    try {
        const response = await apiFetch('/api/saved-searches', { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to clear saved searches.');
        }
        await loadSavedSearches();
        showToast(data.message, 'success');
    } catch (error) {
        console.error('Failed to clear saved searches:', error);
        showToast(error.message || 'Failed to clear saved searches.', 'error');
    }
}

async function deleteSavedSearch(itemId) {
    try {
        const response = await apiFetch(`/api/saved-searches/${itemId}`, { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to delete saved search.');
        }
        await loadSavedSearches();
        showToast(data.message, 'success');
    } catch (error) {
        console.error('Failed to delete saved search:', error);
        showToast(error.message || 'Failed to delete saved search.', 'error');
    }
}

async function loadSearchHistory() {
    if (!historyList) {
        return;
    }
    try {
        const response = await apiFetch('/api/search-history');
        searchHistory = await response.json();
        renderSearchHistory();
    } catch (error) {
        console.error('Failed to load search history:', error);
        historyList.innerHTML = '<div class="loading-line">Unable to load search history.</div>';
    }
}

async function clearSearchHistory() {
    try {
        const response = await apiFetch('/api/search-history', { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to clear search history.');
        }
        await loadSearchHistory();
        showToast(data.message, 'success');
    } catch (error) {
        console.error('Failed to clear search history:', error);
        showToast(error.message || 'Failed to clear search history.', 'error');
    }
}

async function deleteHistoryItem(itemId) {
    try {
        const response = await apiFetch(`/api/search-history/${itemId}`, { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to delete history item.');
        }
        await loadSearchHistory();
        showToast(data.message, 'success');
    } catch (error) {
        console.error('Failed to delete history item:', error);
        showToast(error.message || 'Failed to delete history item.', 'error');
    }
}

async function loadFavorites() {
    if (!favoritesList) {
        return;
    }

    try {
        const response = await apiFetch('/api/favorites');
        favoriteFiles = await response.json();
        renderFavorites();
    } catch (error) {
        console.error('Failed to load favorites:', error);
        favoritesList.innerHTML = '<div class="loading-line">Unable to load favorite files.</div>';
    }
}

async function toggleFavorite(fileId) {
    try {
        const response = await apiFetch('/api/favorites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: fileId }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to update favorite.');
        }
        await Promise.all([loadSpreadsheets(), loadFavorites()]);
    } catch (error) {
        console.error('Failed to update favorite:', error);
        showToast(error.message || 'Failed to update favorite.', 'error');
    }
}

async function saveHeaderOverride(fileId, headerRow) {
    try {
        const response = await apiFetch('/api/header-overrides', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: fileId, header_row: headerRow }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to save header override.');
        }
        await Promise.all([loadSpreadsheets(), loadAuditLog()]);
        showToast(data.message, 'success');
    } catch (error) {
        console.error('Failed to save header override:', error);
        showToast(error.message || 'Failed to save header override.', 'error');
    }
}

async function clearHeaderOverride(fileId) {
    try {
        const response = await apiFetch('/api/header-overrides', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: fileId }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Failed to clear header override.');
        }
        await Promise.all([loadSpreadsheets(), loadAuditLog()]);
        showToast(data.message, 'success');
    } catch (error) {
        console.error('Failed to clear header override:', error);
        showToast(error.message || 'Failed to clear header override.', 'error');
    }
}

async function loadAuditLog() {
    if (!auditLogList || !currentUser.is_admin) {
        return;
    }
    try {
        const response = await apiFetch('/api/audit-log');
        auditEntries = await response.json();
        renderAuditLog();
    } catch (error) {
        console.error('Failed to load audit log:', error);
        auditLogList.innerHTML = '<div class="loading-line">Unable to load audit log.</div>';
    }
}

function renderBranding() {
    if (brandTitle) {
        brandTitle.textContent = appSettings.app_name || 'Xcelerate';
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
    if (settingsIdleTimeout) {
        settingsIdleTimeout.value = appSettings.idle_timeout_minutes || 30;
    }
    renderLogoMarkup(appSettings.logo_url);
    syncEmptyStateBranding();
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

function getLogoMarkup(logoUrl, altText = 'Application logo') {
    if (logoUrl) {
        return `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(altText)}" class="brand-logo-image">`;
    }
    return '<div class="brand-logo-placeholder">SKA</div>';
}

function syncEmptyStateBranding() {
    const emptyMark = resultsArea?.querySelector('.empty-mark');
    if (!emptyMark) {
        return;
    }
    emptyMark.innerHTML = getLogoMarkup(appSettings.logo_url, `${appSettings.app_name || 'Application'} logo`);
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

        item.querySelector('[data-remove-path]')?.addEventListener('click', () => removeDirectory(directory.path));
        directoryListEl.appendChild(item);
    });
}

function renderFileList() {
    if (!fileListEl) {
        return;
    }
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
                <div class="stack-title-row">
                    <strong>${escapeHtml(file.filename)}</strong>
                    ${file.header_source === 'manual' ? '<span class="micro-pill success">Manual header</span>' : '<span class="micro-pill muted">Auto header</span>'}
                </div>
                <span class="stack-path">Header row ${file.header_row}</span>
            </div>
            <div class="inline-actions">
                <button class="icon-btn ${file.is_favorite ? 'active' : ''}" type="button" data-favorite="${escapeAttribute(file.id)}" title="Toggle favorite">★</button>
                <span class="micro-pill neutral">${file.row_count} rows</span>
            </div>
        `;

        const checkbox = item.querySelector('input');
        const favoriteButton = item.querySelector('[data-favorite]');

        favoriteButton?.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleFavorite(file.id);
        });

        item.addEventListener('click', (event) => {
            if (event.target === checkbox || event.target === favoriteButton) {
                return;
            }
            checkbox.checked = !checkbox.checked;
            updateFileSelection(file.id, checkbox.checked, item);
        });

        checkbox.addEventListener('change', () => {
            updateFileSelection(file.id, checkbox.checked, item);
        });

        fileListEl.appendChild(item);
    });
}

function updateFileSelection(fileId, checked, item) {
    if (checked) {
        selectedFiles.add(fileId);
    } else {
        selectedFiles.delete(fileId);
    }
    item.classList.toggle('active', checked);
    if (toggleAllFilesBtn) {
        toggleAllFilesBtn.textContent = selectedFiles.size === spreadsheetData.length ? 'None' : 'All';
    }
}

function renderColumnList() {
    if (!columnListEl) {
        return;
    }
    columnListEl.innerHTML = '';

    if (!allColumns.length) {
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
            if (event.target === checkbox) {
                return;
            }
            checkbox.checked = !checkbox.checked;
            updateColumnSelection(column, checkbox.checked, item);
        });
        checkbox.addEventListener('change', () => {
            updateColumnSelection(column, checkbox.checked, item);
        });
        columnListEl.appendChild(item);
    });
}

function updateColumnSelection(column, checked, item) {
    if (checked) {
        selectedColumns.add(column);
    } else {
        selectedColumns.delete(column);
    }
    item.classList.toggle('active', checked);
    if (toggleAllColsBtn) {
        toggleAllColsBtn.textContent = selectedColumns.size === allColumns.length ? 'None' : 'All';
    }
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
                <div class="result-fields-grid">
                    ${fieldsMarkup}
                </div>
            </article>
        `;
    }).join('');

    resultsArea.innerHTML = `
        <div class="results-grid">${cardsMarkup}</div>
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
                <span class="micro-pill muted">${user.permissions.can_view_sources ? 'Sources' : 'No sources'}</span>
                <span class="micro-pill muted">${user.permissions.can_view_settings ? 'Settings' : 'No settings'}</span>
                <span class="micro-pill muted">${user.permissions.can_view_users ? 'Users' : 'No users'}</span>
            </div>
            <div class="user-card-actions">
                <button class="ghost-btn user-action-btn" type="button" data-user-toggle="${user.id}" data-next-active="${!user.is_active}">
                    ${user.is_active ? 'Deactivate' : 'Activate'}
                </button>
                <button class="ghost-btn user-action-btn danger-btn" type="button" data-user-delete="${user.id}">Delete</button>
            </div>
        </article>
    `).join('');

    userList.querySelectorAll('[data-user-toggle]').forEach((button) => {
        button.addEventListener('click', () => toggleUserActive(Number(button.dataset.userToggle), button.dataset.nextActive === 'true'));
    });
    userList.querySelectorAll('[data-user-delete]').forEach((button) => {
        button.addEventListener('click', () => deleteUser(Number(button.dataset.userDelete)));
    });
}

function renderSavedSearches() {
    if (!savedSearchList) {
        return;
    }
    if (!savedSearches.length) {
        savedSearchList.innerHTML = '<div class="loading-line">No saved searches yet.</div>';
        return;
    }

    savedSearchList.innerHTML = savedSearches.map((item) => `
        <article class="stack-item feature-card">
            <div class="stack-main">
                <div class="stack-title-row">
                    <strong>${escapeHtml(item.name)}</strong>
                    <span class="micro-pill neutral">${escapeHtml(item.query)}</span>
                </div>
                <span class="stack-path">${item.selected_files.length} files · ${item.selected_columns.length} columns · saved ${escapeHtml(item.created_at)}</span>
            </div>
            <div class="inline-actions">
                <button class="ghost-btn" type="button" data-run-saved="${item.id}">Run</button>
                <button class="ghost-btn danger-btn" type="button" data-delete-saved="${item.id}">Delete</button>
            </div>
        </article>
    `).join('');

    savedSearchList.querySelectorAll('[data-run-saved]').forEach((button) => {
        button.addEventListener('click', () => {
            const item = savedSearches.find((saved) => saved.id === Number(button.dataset.runSaved));
            if (item) {
                applySearchState(item);
            }
        });
    });
    savedSearchList.querySelectorAll('[data-delete-saved]').forEach((button) => {
        button.addEventListener('click', () => deleteSavedSearch(Number(button.dataset.deleteSaved)));
    });
}

function renderSearchHistory() {
    if (!historyList) {
        return;
    }
    if (!searchHistory.length) {
        historyList.innerHTML = '<div class="loading-line">No search history yet.</div>';
        return;
    }

    historyList.innerHTML = searchHistory.map((item) => `
        <article class="stack-item feature-card">
            <div class="stack-main">
                <div class="stack-title-row">
                    <strong>${escapeHtml(item.query)}</strong>
                    <span class="micro-pill neutral">${item.result_count} matches</span>
                </div>
                <span class="stack-path">${item.selected_files.length} files · ${item.selected_columns.length} columns · ${escapeHtml(item.created_at)}</span>
            </div>
            <div class="inline-actions">
                <button class="ghost-btn" type="button" data-run-history="${item.id}">Run Again</button>
                <button class="ghost-btn danger-btn" type="button" data-delete-history="${item.id}">Delete</button>
            </div>
        </article>
    `).join('');

    historyList.querySelectorAll('[data-run-history]').forEach((button) => {
        button.addEventListener('click', () => {
            const item = searchHistory.find((entry) => entry.id === Number(button.dataset.runHistory));
            if (item) {
                applySearchState(item);
            }
        });
    });
    historyList.querySelectorAll('[data-delete-history]').forEach((button) => {
        button.addEventListener('click', () => deleteHistoryItem(Number(button.dataset.deleteHistory)));
    });
}

function renderFavorites() {
    if (!favoritesList) {
        return;
    }
    if (!favoriteFiles.length) {
        favoritesList.innerHTML = '<div class="loading-line">No favorite files yet.</div>';
        return;
    }

    favoritesList.innerHTML = favoriteFiles.map((item) => `
        <article class="stack-item feature-card">
            <div class="stack-main">
                <div class="stack-title-row">
                    <strong>${escapeHtml(item.filename)}</strong>
                    <span class="micro-pill ${item.available ? 'success' : 'warning'}">${item.available ? 'Available' : 'Missing'}</span>
                </div>
                <span class="stack-path">${item.available ? `${item.row_count} rows · header row ${item.header_row}` : 'Not currently loaded'} · added ${escapeHtml(item.created_at)}</span>
            </div>
            <div class="inline-actions">
                <button class="ghost-btn" type="button" data-open-favorite="${escapeAttribute(item.file_id)}">Use in Search</button>
                <button class="ghost-btn danger-btn" type="button" data-remove-favorite="${escapeAttribute(item.file_id)}">Remove</button>
            </div>
        </article>
    `).join('');

    favoritesList.querySelectorAll('[data-open-favorite]').forEach((button) => {
        button.addEventListener('click', () => {
            const fileId = button.dataset.openFavorite;
            const favorite = favoriteFiles.find((item) => escapeAttribute(item.file_id) === fileId);
            if (favorite && favorite.available) {
                selectedFiles = new Set([favorite.file_id]);
                renderFileList();
                activateTab('search-panel');
                searchInput?.focus();
            }
        });
    });
    favoritesList.querySelectorAll('[data-remove-favorite]').forEach((button) => {
        button.addEventListener('click', () => {
            const fileId = button.dataset.removeFavorite;
            const favorite = favoriteFiles.find((item) => escapeAttribute(item.file_id) === fileId);
            if (favorite) {
                toggleFavorite(favorite.file_id);
            }
        });
    });
}

function renderHeaderOverrides() {
    if (!headerOverrideList) {
        return;
    }
    if (!spreadsheetData.length) {
        headerOverrideList.innerHTML = '<div class="loading-line">No spreadsheets available for header overrides.</div>';
        return;
    }

    headerOverrideList.innerHTML = spreadsheetData.map((file) => `
        <article class="stack-item feature-card">
            <div class="stack-main">
                <div class="stack-title-row">
                    <strong>${escapeHtml(file.filename)}</strong>
                    <span class="micro-pill ${file.header_source === 'manual' ? 'success' : 'neutral'}">${file.header_source === 'manual' ? 'Manual row' : 'Auto detected'}</span>
                </div>
                <span class="stack-path">Current header row ${file.header_row}</span>
            </div>
            <div class="inline-form compact-form">
                <input type="number" class="text-input compact-input" min="1" value="${file.header_row}" data-header-input="${escapeAttribute(file.id)}">
                <button class="ghost-btn" type="button" data-save-header="${escapeAttribute(file.id)}">Apply</button>
                <button class="ghost-btn danger-btn" type="button" data-clear-header="${escapeAttribute(file.id)}">Clear</button>
            </div>
        </article>
    `).join('');

    headerOverrideList.querySelectorAll('[data-save-header]').forEach((button) => {
        button.addEventListener('click', () => {
            const fileId = button.dataset.saveHeader;
            const targetFile = spreadsheetData.find((item) => escapeAttribute(item.id) === fileId);
            const input = headerOverrideList.querySelector(`[data-header-input="${fileId}"]`);
            const value = Number(input?.value || 0);
            if (targetFile) {
                saveHeaderOverride(targetFile.id, value);
            }
        });
    });
    headerOverrideList.querySelectorAll('[data-clear-header]').forEach((button) => {
        button.addEventListener('click', () => {
            const fileId = button.dataset.clearHeader;
            const targetFile = spreadsheetData.find((item) => escapeAttribute(item.id) === fileId);
            if (targetFile) {
                clearHeaderOverride(targetFile.id);
            }
        });
    });
}

function renderAuditLog() {
    if (!auditLogList) {
        return;
    }
    if (!auditEntries.length) {
        auditLogList.innerHTML = '<div class="loading-line">No audit entries yet.</div>';
        return;
    }

    auditLogList.innerHTML = auditEntries.map((item) => `
        <article class="stack-item feature-card">
            <div class="stack-main">
                <div class="stack-title-row">
                    <strong>${escapeHtml(item.action.replaceAll('_', ' '))}</strong>
                    <span class="micro-pill neutral">${escapeHtml(item.entity_type)}</span>
                </div>
                <span class="stack-path">${escapeHtml(item.actor_username)} · ${escapeHtml(item.created_at)}</span>
                <span class="stack-path">${escapeHtml(formatAuditDetails(item.details))}</span>
            </div>
        </article>
    `).join('');
}

function updateStats() {
    if (!statsFiles || !statsRows || !statsCols) {
        return;
    }
    const totalFiles = spreadsheetData.length;
    const totalRows = spreadsheetData.reduce((sum, file) => sum + file.row_count, 0);
    const totalCols = allColumns.length;
    statsFiles.textContent = totalFiles;
    statsRows.textContent = totalRows.toLocaleString();
    statsCols.textContent = totalCols;
}

function handleAutocompleteInput() {
    clearTimeout(autocompleteDebounce);
    const query = searchInput.value.trim();
    if (query.length < 2) {
        autocompleteItems = [];
        activeSuggestionIndex = -1;
        hideAutocomplete();
        return;
    }
    autocompleteDebounce = window.setTimeout(() => fetchAutocomplete(query), 180);
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
    const permissionInputs = [permSearch, permSources, permSettings, permUsers].filter(Boolean);
    permissionInputs.forEach((input) => {
        input.disabled = isAdmin;
    });

    if (isAdmin) {
        if (permSearch) permSearch.checked = true;
        if (permSources) permSources.checked = true;
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

function handleSaveCurrentSearchClick() {
    const state = getCurrentSearchStateFromUi();
    if (!state.query) {
        showToast('Type a query first so there is something to save.', 'error');
        return;
    }
    activateTab('saved-panel');
    if (savedSearchName) {
        savedSearchName.value = savedSearchName.value || state.query;
        savedSearchName.focus();
        savedSearchName.select();
    }
}

function exportResultsPdf() {
    const state = getCurrentSearchStateFromUi();
    if (!state.query) {
        showToast('Run a search before exporting.', 'error');
        return;
    }
    const params = buildSearchParams(state);
    window.location.href = `/api/export/pdf?${params.toString()}`;
}

function getCurrentSearchStateFromUi() {
    return {
        query: searchInput?.value.trim() || '',
        selected_files: Array.from(selectedFiles),
        selected_columns: Array.from(selectedColumns),
    };
}

function buildSearchParams(state) {
    const params = new URLSearchParams({ q: state.query });
    if (state.selected_columns.length > 0 && state.selected_columns.length < allColumns.length) {
        params.set('columns', state.selected_columns.join(','));
    }
    if (state.selected_files.length > 0 && state.selected_files.length < spreadsheetData.length) {
        params.set('files', state.selected_files.join(','));
    }
    return params;
}

function applySearchState(state) {
    currentSearchState = {
        query: state.query || '',
        selected_files: Array.isArray(state.selected_files) ? state.selected_files : [],
        selected_columns: Array.isArray(state.selected_columns) ? state.selected_columns : [],
    };
    if (searchInput) {
        searchInput.value = currentSearchState.query;
    }
    selectedFiles = new Set(currentSearchState.selected_files.length ? currentSearchState.selected_files : spreadsheetData.map((file) => file.id));
    selectedColumns = new Set(currentSearchState.selected_columns.length ? currentSearchState.selected_columns : allColumns);
    renderFileList();
    renderColumnList();
    activateTab('search-panel');
    performSearch(currentSearchState);
}

function showLoading() {
    resultsArea.innerHTML = '<div class="loading-panel">Searching connected spreadsheets...</div>';
}

function clearResults() {
    searchResults = [];
    currentPage = 1;
    currentSearchState = { query: '', selected_files: Array.from(selectedFiles), selected_columns: Array.from(selectedColumns) };
    if (searchInput) {
        searchInput.value = '';
    }
    hideAutocomplete();
    if (resultsSummary) {
        resultsSummary.textContent = 'Ready to search';
    }
    showEmptyState('Search across your connected spreadsheets', 'Run a search to see paginated result cards that stay readable on smaller screens.');
}

function showEmptyState(title, copy) {
    resultsArea.innerHTML = `
        <div class="empty-state">
            <div class="empty-mark">${getLogoMarkup(appSettings.logo_url, `${appSettings.app_name || 'Application'} logo`)}</div>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(copy)}</p>
        </div>
    `;
}

function formatAuditDetails(details) {
    if (!details || typeof details !== 'object') {
        return '';
    }
    return Object.entries(details)
        .map(([key, value]) => `${key.replaceAll('_', ' ')}: ${value}`)
        .join(' · ');
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
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
