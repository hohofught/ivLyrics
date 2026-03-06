/**
 * Marketplace Manager for ivLyrics
 * 마켓플레이스 에드온 설치, 저장, 동적 로딩을 관리하는 시스템
 *
 * @author ivLis STUDIO
 * @description IndexedDB에 에드온 코드를 저장하고, 앱 시작 시 동적으로 로드
 */

(function MarketplaceManagerInit() {
    'use strict';

    const MODULE_KEY = '__ivLyricsMarketplaceManagerModule';
    const moduleState = window[MODULE_KEY] || (window[MODULE_KEY] = {
        initialized: false,
        waitTimer: null
    });

    // Spicetify가 준비될 때까지 대기
    if (!window.Spicetify || !Spicetify.LocalStorage) {
        if (!moduleState.waitTimer) {
            moduleState.waitTimer = setTimeout(() => {
                moduleState.waitTimer = null;
                MarketplaceManagerInit();
            }, 300);
        }
        return;
    }

    moduleState.waitTimer = null;
    if (moduleState.initialized) {
        return;
    }
    moduleState.initialized = true;

    // ============================================
    // Constants
    // ============================================

    const DB_NAME = 'ivLyrics_marketplace';
    const DB_VERSION = 1;
    const STORE_NAME = 'addons';
    const STORAGE_PREFIX = 'ivLyrics:marketplace:';
    const FETCH_TIMEOUT = 15000;
    const GITHUB_TOPIC = 'ivlyrics-addon';
    const GITHUB_SEARCH_URL = `https://api.github.com/search/repositories?q=topic:${encodeURIComponent(GITHUB_TOPIC)}&per_page=100&sort=stars&order=desc`;
    const BLACKLIST_URL_LOCAL = 'blacklist.json';
    const BLACKLIST_URL_REMOTE = 'https://raw.githubusercontent.com/ivLis-Studio/ivLyrics/refs/heads/main/blacklist.json';

    // ============================================
    // MarketplaceManager Class
    // ============================================

    class MarketplaceManager {
        constructor() {
            this._db = null;
            this._addonListCache = null;
            this._addonListCacheTime = 0;
            this._addonListCacheTTL = 5 * 60 * 1000; // 5분 캐시
            this._blacklistCache = null;
            this._installedAddons = new Map(); // id -> { metadata, code }
            this._loadedScripts = new Map(); // id -> loaded script/style element
            this._events = new Map();
            this._onceEvents = new Map();

            // Readiness tracking
            this._readyResolve = null;
            this.readyPromise = new Promise((resolve) => {
                this._readyResolve = resolve;
            });

            this._init();
        }

        // ============================================
        // EventEmitter Methods
        // ============================================

        on(event, listener) {
            if (!this._events.has(event)) {
                this._events.set(event, new Set());
            }
            this._events.get(event).add(listener);
            return () => this.off(event, listener);
        }

        once(event, listener) {
            if (!this._onceEvents.has(event)) {
                this._onceEvents.set(event, new Set());
            }
            this._onceEvents.get(event).add(listener);
        }

        off(event, listener) {
            if (this._events.has(event)) {
                this._events.get(event).delete(listener);
            }
            if (this._onceEvents.has(event)) {
                this._onceEvents.get(event).delete(listener);
            }
        }

        emit(event, ...args) {
            if (this._events.has(event)) {
                for (const listener of this._events.get(event)) {
                    try { listener(...args); } catch (e) {
                        console.error(`[MarketplaceManager] Event listener error (${event}):`, e);
                    }
                }
            }
            if (this._onceEvents.has(event)) {
                for (const listener of this._onceEvents.get(event)) {
                    try { listener(...args); } catch (e) {
                        console.error(`[MarketplaceManager] Once listener error (${event}):`, e);
                    }
                }
                this._onceEvents.delete(event);
            }
        }

        // ============================================
        // Initialization
        // ============================================

        async _init() {
            try {
                await this._openDB();
                await this._loadInstalledAddons();
                console.log('[MarketplaceManager] Initialized successfully');
            } catch (e) {
                console.error('[MarketplaceManager] Initialization error:', e);
            } finally {
                // readyPromise는 항상 resolve (에러가 있어도 앱이 멈추면 안 됨)
                this._readyResolve();
            }
        }

        // ============================================
        // IndexedDB Operations
        // ============================================

        _openDB() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                        store.createIndex('type', 'metadata.type', { unique: false });
                        store.createIndex('installedAt', 'installedAt', { unique: false });
                    }
                };

                request.onsuccess = (event) => {
                    this._db = event.target.result;
                    resolve();
                };

                request.onerror = (event) => {
                    console.error('[MarketplaceManager] IndexedDB open error:', event.target.error);
                    reject(event.target.error);
                };
            });
        }

        _dbGet(id) {
            return new Promise((resolve, reject) => {
                if (!this._db) { resolve(null); return; }
                const tx = this._db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const request = store.get(id);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            });
        }

        _dbPut(data) {
            return new Promise((resolve, reject) => {
                if (!this._db) { reject(new Error('DB not open')); return; }
                const tx = this._db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const request = store.put(data);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }

        _dbDelete(id) {
            return new Promise((resolve, reject) => {
                if (!this._db) { reject(new Error('DB not open')); return; }
                const tx = this._db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const request = store.delete(id);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }

        _dbGetAll() {
            return new Promise((resolve, reject) => {
                if (!this._db) { resolve([]); return; }
                const tx = this._db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });
        }

        // ============================================
        // Addon Loading (Startup)
        // ============================================

        async _loadInstalledAddons() {
            const addons = await this._dbGetAll();

            if (addons.length === 0) {
                console.log('[MarketplaceManager] No marketplace addons installed');
                return;
            }

            console.log(`[MarketplaceManager] Loading ${addons.length} marketplace addon(s)...`);

            const loadPromises = addons.map(addon => this._executeAddonCode(addon));
            const results = await Promise.allSettled(loadPromises);

            let loaded = 0;
            let failed = 0;
            results.forEach((result, i) => {
                if (result.status === 'fulfilled') {
                    this._installedAddons.set(addons[i].id, addons[i]);
                    loaded++;
                } else {
                    console.error(`[MarketplaceManager] Failed to load addon "${addons[i].id}":`, result.reason);
                    failed++;
                }
            });

            // 매니저에 마켓플레이스 에드온으로 표시 (약간의 지연 - 에드온이 매니저에 등록될 시간 확보)
            setTimeout(() => {
                for (const addon of addons) {
                    const type = addon.metadata?.type;
                    if (type === 'lyrics' && window.LyricsAddonManager) {
                        window.LyricsAddonManager.markAsMarketplaceAddon(addon.id);
                    } else if (type === 'ai' && window.AIAddonManager) {
                        window.AIAddonManager.markAsMarketplaceAddon(addon.id);
                    }
                }
            }, 500);

            console.log(`[MarketplaceManager] Loaded: ${loaded}, Failed: ${failed}`);
        }

        _executeAddonCode(addon) {
            return new Promise((resolve, reject) => {
                try {
                    const type = String(addon?.metadata?.type || '').toLowerCase();

                    if (type === 'style') {
                        const style = document.createElement('style');
                        style.dataset.marketplaceAddon = addon.id;
                        style.textContent = addon.code || '';
                        document.head.appendChild(style);
                        this._loadedScripts.set(addon.id, style);
                        console.log(`[MarketplaceManager] Loaded style addon: ${addon.id}`);
                        resolve();
                        return;
                    }

                    if (type !== 'lyrics' && type !== 'ai') {
                        reject(new Error(`Unsupported addon type: ${type || 'unknown'}`));
                        return;
                    }

                    const blob = new Blob([addon.code], { type: 'text/javascript' });
                    const url = URL.createObjectURL(blob);
                    const script = document.createElement('script');

                    script.src = url;
                    script.dataset.marketplaceAddon = addon.id;

                    script.onload = () => {
                        URL.revokeObjectURL(url);
                        this._loadedScripts.set(addon.id, script);
                        console.log(`[MarketplaceManager] Loaded addon: ${addon.id}`);
                        resolve();
                    };

                    script.onerror = (e) => {
                        URL.revokeObjectURL(url);
                        script.remove();
                        reject(new Error(`Script load failed for ${addon.id}`));
                    };

                    document.head.appendChild(script);
                } catch (e) {
                    reject(e);
                }
            });
        }

        // ============================================
        // Addon List Fetching
        // ============================================

        _toNormalizedSet(values) {
            if (!Array.isArray(values)) return new Set();
            return new Set(
                values
                    .map(v => String(v || '').trim().toLowerCase())
                    .filter(Boolean)
            );
        }

        _normalizeRepoId(owner, repo) {
            const o = String(owner || '').trim().toLowerCase();
            const r = String(repo || '').trim().toLowerCase();
            return `${o}/${r}`.replace(/^\/+|\/+$/g, '');
        }

        _isRepoBlocked(repo, blacklist) {
            const owner = repo?.owner?.login || '';
            const repoName = repo?.name || '';
            const fullName = this._normalizeRepoId(owner, repoName);
            return blacklist.blockedRepos.has(fullName) || blacklist.blockedAuthors.has(owner.toLowerCase());
        }

        _buildManifestUrl(repo) {
            const defaultBranch = repo?.default_branch || 'main';
            const fullName = `${repo.owner?.login}/${repo.name}`;
            return `https://raw.githubusercontent.com/${fullName}/${defaultBranch}/manifest.json`;
        }

        _manifestAddonToMarketplaceAddon(manifestAddon, repo) {
            if (!manifestAddon || typeof manifestAddon !== 'object') return null;

            const owner = repo?.owner?.login || '';
            const repoName = repo?.name || '';
            const baseId = this._normalizeRepoId(owner, repoName);
            const type = String(manifestAddon.type || '').toLowerCase();

            if (!manifestAddon.name || !manifestAddon.downloadUrl) return null;
            if (type !== 'lyrics' && type !== 'ai' && type !== 'style') return null;

            // Generate unique ID per addon by slugifying the addon name
            const addonSlug = manifestAddon.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            const id = `${baseId}/${addonSlug}`;

            const description = manifestAddon.description || repo.description || '';
            const ownerAvatarUrl = repo?.owner?.avatar_url || '';

            return {
                id,
                name: manifestAddon.name,
                type,
                author: manifestAddon.author || owner || baseId,
                authorLogin: owner,
                authorAvatar: ownerAvatarUrl,
                version: manifestAddon.version || '0.0.0',
                updated: manifestAddon.updated || '',
                description,
                githubUrl: manifestAddon.githubUrl || repo.html_url || '',
                preview: manifestAddon.preview || '',
                downloadUrl: manifestAddon.downloadUrl,
                minAppVersion: manifestAddon.minAppVersion || '',
                sourceRepo: baseId,
                stars: repo?.stargazers_count || 0
            };
        }

        async _fetchRepoManifestAddons(repo) {
            const manifestUrl = this._buildManifestUrl(repo);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

            try {
                const response = await fetch(manifestUrl, {
                    signal: controller.signal,
                    cache: 'no-cache'
                });

                if (!response.ok) {
                    return [];
                }

                const data = await response.json();
                if (!data || !Array.isArray(data.addons)) {
                    return [];
                }

                const results = [];
                for (const manifestAddon of data.addons) {
                    const addon = this._manifestAddonToMarketplaceAddon(manifestAddon, repo);
                    if (addon) results.push(addon);
                }

                return results;
            } catch {
                return [];
            } finally {
                clearTimeout(timeoutId);
            }
        }

        async _loadBlacklist(forceRefresh = false) {
            if (!forceRefresh && this._blacklistCache) {
                return this._blacklistCache;
            }

            try {
                const urls = [BLACKLIST_URL_REMOTE, BLACKLIST_URL_LOCAL];
                let data = null;

                for (const url of urls) {
                    try {
                        const response = await fetch(url, { cache: 'no-cache' });
                        if (!response.ok) continue;
                        data = await response.json();
                        break;
                    } catch {
                        // Try next source
                    }
                }

                if (!data) {
                    this._blacklistCache = {
                        blockedRepos: new Set(),
                        blockedAuthors: new Set(),
                        blockedAddonIds: new Set()
                    };
                    return this._blacklistCache;
                }

                this._blacklistCache = {
                    blockedRepos: this._toNormalizedSet(data?.blockedRepos),
                    blockedAuthors: this._toNormalizedSet(data?.blockedAuthors),
                    blockedAddonIds: this._toNormalizedSet(data?.blockedAddonIds)
                };

                return this._blacklistCache;
            } catch {
                this._blacklistCache = {
                    blockedRepos: new Set(),
                    blockedAuthors: new Set(),
                    blockedAddonIds: new Set()
                };
                return this._blacklistCache;
            }
        }

        async _fetchTopicRepositories() {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

            try {
                const response = await fetch(GITHUB_SEARCH_URL, {
                    signal: controller.signal,
                    cache: 'no-cache',
                    headers: {
                        'Accept': 'application/vnd.github+json'
                    }
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();
                if (!data || !Array.isArray(data.items)) {
                    throw new Error('Invalid GitHub topic response');
                }

                return data.items.filter(repo => !repo.archived && !repo.disabled);
            } finally {
                clearTimeout(timeoutId);
            }
        }

        async fetchAddonList(forceRefresh = false) {
            if (!forceRefresh && this._addonListCache && (Date.now() - this._addonListCacheTime < this._addonListCacheTTL)) {
                return this._addonListCache;
            }

            try {
                const blacklist = await this._loadBlacklist(forceRefresh);
                const repos = await this._fetchTopicRepositories();
                const allowedRepos = repos.filter(repo => !this._isRepoBlocked(repo, blacklist));

                const manifestResults = await Promise.allSettled(
                    allowedRepos.map(repo => this._fetchRepoManifestAddons(repo))
                );

                const discoveredAddons = [];
                for (const result of manifestResults) {
                    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
                        discoveredAddons.push(...result.value);
                    }
                }

                const seenIds = new Set();
                const addons = [];
                for (const addon of discoveredAddons) {
                    const normalizedId = String(addon.id || '').toLowerCase();
                    if (!normalizedId) continue;
                    if (blacklist.blockedAddonIds.has(normalizedId)) continue;
                    if (seenIds.has(normalizedId)) continue;
                    seenIds.add(normalizedId);

                    addons.push({
                        ...addon,
                        isInstalled: this._installedAddons.has(addon.id),
                        installedVersion: this._installedAddons.get(addon.id)?.metadata?.version || null,
                        hasUpdate: this._installedAddons.has(addon.id) &&
                            this._compareVersions(addon.version, this._installedAddons.get(addon.id)?.metadata?.version) > 0
                    });
                }

                // Sort by stars descending
                addons.sort((a, b) => (b.stars || 0) - (a.stars || 0));

                this._addonListCache = {
                    version: 2,
                    source: `github-topic:${GITHUB_TOPIC}`,
                    addons
                };
                this._addonListCacheTime = Date.now();

                return this._addonListCache;
            } catch (e) {
                console.error('[MarketplaceManager] Failed to fetch addon list:', e);
                throw e;
            }
        }
        // ============================================
        // Install / Uninstall / Update
        // ============================================

        async installAddon(addonInfo) {
            const { id, downloadUrl, type } = addonInfo;

            if (this._installedAddons.has(id)) {
                console.warn(`[MarketplaceManager] Addon "${id}" is already installed`);
                return false;
            }

            try {
                this.emit('addon:installing', { id });

                // JS 코드 다운로드
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

                const response = await fetch(downloadUrl, {
                    signal: controller.signal,
                    cache: 'no-cache'
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`Download failed: HTTP ${response.status}`);
                }

                const code = await response.text();

                if (!code || code.trim().length === 0) {
                    throw new Error('Downloaded addon code is empty');
                }

                // IndexedDB에 저장
                const entry = {
                    id,
                    code,
                    metadata: {
                        name: addonInfo.name,
                        type: addonInfo.type,
                        author: addonInfo.author,
                        version: addonInfo.version,
                        description: addonInfo.description,
                        preview: addonInfo.preview,
                        downloadUrl: addonInfo.downloadUrl,
                        updated: addonInfo.updated,
                        minAppVersion: addonInfo.minAppVersion
                    },
                    installedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };

                await this._dbPut(entry);

                // 즉시 실행
                await this._executeAddonCode(entry);
                this._installedAddons.set(id, entry);

                // 매니저에 마켓플레이스 에드온으로 표시
                setTimeout(() => {
                    if (type === 'lyrics' && window.LyricsAddonManager) {
                        window.LyricsAddonManager.markAsMarketplaceAddon(id);
                    } else if (type === 'ai' && window.AIAddonManager) {
                        window.AIAddonManager.markAsMarketplaceAddon(id);
                    }
                }, 300);

                // Provider 순서에 추가 (맨 앞에)
                this._addToProviderOrder(id, type);

                // 캐시 무효화
                this._addonListCacheTime = 0;

                this.emit('addon:installed', { id, name: addonInfo.name, type });
                console.log(`[MarketplaceManager] Installed addon: ${id}`);
                return true;
            } catch (e) {
                console.error(`[MarketplaceManager] Install failed for "${id}":`, e);
                this.emit('addon:install-error', { id, error: e.message });
                throw e;
            }
        }

        async uninstallAddon(addonId) {
            if (!this._installedAddons.has(addonId)) {
                console.warn(`[MarketplaceManager] Addon "${addonId}" is not installed`);
                return false;
            }

            try {
                const addon = this._installedAddons.get(addonId);
                const type = addon?.metadata?.type;

                // IndexedDB에서 삭제
                await this._dbDelete(addonId);

                // 스크립트 태그 제거
                const loadedElement = this._loadedScripts.get(addonId);
                if (loadedElement) {
                    loadedElement.remove();
                    this._loadedScripts.delete(addonId);
                }

                // 매니저에서 등록 해제
                if (type === 'lyrics' && window.LyricsAddonManager) {
                    window.LyricsAddonManager.unregister(addonId);
                } else if (type === 'ai' && window.AIAddonManager) {
                    window.AIAddonManager.unregister(addonId);
                }

                // Provider 순서에서 제거
                this._removeFromProviderOrder(addonId, type);

                this._installedAddons.delete(addonId);

                // 캐시 무효화
                this._addonListCacheTime = 0;

                this.emit('addon:uninstalled', { id: addonId, name: addon?.metadata?.name });
                console.log(`[MarketplaceManager] Uninstalled addon: ${addonId}`);
                return true;
            } catch (e) {
                console.error(`[MarketplaceManager] Uninstall failed for "${addonId}":`, e);
                throw e;
            }
        }

        async updateAddon(addonInfo) {
            const { id } = addonInfo;

            if (!this._installedAddons.has(id)) {
                console.warn(`[MarketplaceManager] Addon "${id}" is not installed, cannot update`);
                return false;
            }

            try {
                this.emit('addon:updating', { id });

                // 기존 스크립트 제거
                const oldLoadedElement = this._loadedScripts.get(id);
                if (oldLoadedElement) {
                    oldLoadedElement.remove();
                    this._loadedScripts.delete(id);
                }

                // 매니저에서 기존 등록 해제
                const type = addonInfo.type;
                if (type === 'lyrics' && window.LyricsAddonManager) {
                    window.LyricsAddonManager.unregister(id);
                } else if (type === 'ai' && window.AIAddonManager) {
                    window.AIAddonManager.unregister(id);
                }

                // 새 코드 다운로드
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

                const response = await fetch(addonInfo.downloadUrl, {
                    signal: controller.signal,
                    cache: 'no-cache'
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    throw new Error(`Download failed: HTTP ${response.status}`);
                }

                const code = await response.text();

                // IndexedDB 업데이트
                const entry = {
                    id,
                    code,
                    metadata: {
                        name: addonInfo.name,
                        type: addonInfo.type,
                        author: addonInfo.author,
                        version: addonInfo.version,
                        description: addonInfo.description,
                        preview: addonInfo.preview,
                        downloadUrl: addonInfo.downloadUrl,
                        updated: addonInfo.updated,
                        minAppVersion: addonInfo.minAppVersion
                    },
                    installedAt: this._installedAddons.get(id)?.installedAt || new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };

                await this._dbPut(entry);

                // 새 코드 실행
                await this._executeAddonCode(entry);
                this._installedAddons.set(id, entry);

                // 캐시 무효화
                this._addonListCacheTime = 0;

                this.emit('addon:updated', { id, name: addonInfo.name, version: addonInfo.version });
                console.log(`[MarketplaceManager] Updated addon: ${id} to v${addonInfo.version}`);
                return true;
            } catch (e) {
                console.error(`[MarketplaceManager] Update failed for "${id}":`, e);
                this.emit('addon:update-error', { id, error: e.message });
                throw e;
            }
        }

        // ============================================
        // Provider Order Integration
        // ============================================

        _addToProviderOrder(addonId, type) {
            try {
                if (type === 'lyrics' && window.LyricsAddonManager) {
                    const order = window.LyricsAddonManager.getProviderOrder();
                    if (!order.includes(addonId)) {
                        order.unshift(addonId);
                        window.LyricsAddonManager.setProviderOrder(order);
                    }
                } else if (type === 'ai' && window.AIAddonManager) {
                    const order = window.AIAddonManager.getProviderOrder();
                    if (!order.includes(addonId)) {
                        order.unshift(addonId);
                        window.AIAddonManager.setProviderOrder(order);
                    }
                }
            } catch (e) {
                console.warn('[MarketplaceManager] Failed to update provider order:', e);
            }
        }

        _removeFromProviderOrder(addonId, type) {
            try {
                if (type === 'lyrics' && window.LyricsAddonManager) {
                    const order = window.LyricsAddonManager.getProviderOrder();
                    const filtered = order.filter(id => id !== addonId);
                    window.LyricsAddonManager.setProviderOrder(filtered);
                } else if (type === 'ai' && window.AIAddonManager) {
                    const order = window.AIAddonManager.getProviderOrder();
                    const filtered = order.filter(id => id !== addonId);
                    window.AIAddonManager.setProviderOrder(filtered);
                }
            } catch (e) {
                console.warn('[MarketplaceManager] Failed to update provider order:', e);
            }
        }

        // ============================================
        // Query Methods
        // ============================================

        isInstalled(addonId) {
            return this._installedAddons.has(addonId);
        }

        getInstalledAddons() {
            return Array.from(this._installedAddons.values()).map(a => ({
                id: a.id,
                ...a.metadata,
                installedAt: a.installedAt,
                updatedAt: a.updatedAt
            }));
        }

        getInstalledAddon(addonId) {
            const addon = this._installedAddons.get(addonId);
            if (!addon) return null;
            return {
                id: addon.id,
                ...addon.metadata,
                installedAt: addon.installedAt,
                updatedAt: addon.updatedAt
            };
        }

        getInstalledVersion(addonId) {
            return this._installedAddons.get(addonId)?.metadata?.version || null;
        }

        // ============================================
        // Utility Methods
        // ============================================

        _compareVersions(a, b) {
            if (!a || !b) return 0;
            const pa = a.split('.').map(Number);
            const pb = b.split('.').map(Number);
            const len = Math.max(pa.length, pb.length);
            for (let i = 0; i < len; i++) {
                const na = pa[i] || 0;
                const nb = pb[i] || 0;
                if (na > nb) return 1;
                if (na < nb) return -1;
            }
            return 0;
        }
    }

    // ============================================
    // Global Registration
    // ============================================

    if (!window.MarketplaceManager) {
        const manager = new MarketplaceManager();
        window.MarketplaceManager = manager;
    }

    console.log('[MarketplaceManager] MarketplaceManager registered globally');
})();
