/**
 * Marketplace UI Component for ivLyrics
 * 마켓플레이스 에드온 목록 표시, 상세 보기, 설치/제거 UI
 *
 * @author ivLis STUDIO
 */

const MarketplacePage = (() => {
    'use strict';

    const { useState, useEffect, useCallback, useMemo, useRef } = Spicetify.React;
    const react = Spicetify.React;

    // ============================================
    // Filter Constants
    // ============================================
    const FILTER_ALL = 'all';
    const FILTER_LYRICS = 'lyrics';
    const FILTER_AI = 'ai';

    // ============================================
    // AddonCard Component
    // ============================================

    const AddonCard = react.memo(({ addon, onClick }) => {
        const lang = window.I18n?.getCurrentLanguage?.() || 'en';
        const description = typeof addon.description === 'object'
            ? (addon.description[lang] || addon.description['en'] || '')
            : (addon.description || '');

        const badgeClass = addon.hasUpdate
            ? 'ivlyrics-marketplace-badge ivlyrics-marketplace-badge-update'
            : addon.isInstalled
                ? 'ivlyrics-marketplace-badge ivlyrics-marketplace-badge-installed'
                : 'ivlyrics-marketplace-badge ivlyrics-marketplace-badge-install';

        const badgeText = addon.hasUpdate
            ? I18n.t('marketplace.updateAvailable')
            : addon.isInstalled
                ? I18n.t('marketplace.installed')
                : I18n.t('marketplace.install');

        return react.createElement('div', {
            className: 'ivlyrics-marketplace-card',
            onClick: () => onClick(addon),
            tabIndex: 0,
            role: 'button',
            onKeyDown: (e) => { if (e.key === 'Enter') onClick(addon); }
        },
            // Preview Image
            react.createElement('div', { className: 'ivlyrics-marketplace-card-image' },
                addon.preview
                    ? react.createElement('img', {
                        src: addon.preview,
                        alt: addon.name,
                        loading: 'lazy',
                        onError: (e) => { e.target.style.display = 'none'; }
                    })
                    : react.createElement('div', { className: 'ivlyrics-marketplace-card-image-placeholder' },
                        react.createElement('svg', {
                            width: 48, height: 48, viewBox: '0 0 24 24',
                            fill: 'none', stroke: 'currentColor', strokeWidth: 1.5
                        },
                            react.createElement('path', {
                                d: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4'
                            })
                        )
                    )
            ),
            // Card Info
            react.createElement('div', { className: 'ivlyrics-marketplace-card-info' },
                react.createElement('div', { className: 'ivlyrics-marketplace-card-title' }, addon.name),
                react.createElement('div', { className: 'ivlyrics-marketplace-card-author' },
                    I18n.t('marketplace.by', { author: addon.author })
                ),
                react.createElement('div', { className: 'ivlyrics-marketplace-card-meta' },
                    react.createElement('span', { className: 'ivlyrics-marketplace-card-version' },
                        I18n.t('marketplace.version', { version: addon.version })
                    ),
                    addon.type && react.createElement('span', {
                        className: `ivlyrics-marketplace-card-type ivlyrics-marketplace-card-type-${addon.type}`
                    }, addon.type === 'lyrics' ? 'Lyrics' : 'AI')
                )
            ),
            // Badge
            react.createElement('div', { className: badgeClass }, badgeText)
        );
    });

    // ============================================
    // AddonDetail Component
    // ============================================

    const AddonDetail = react.memo(({ addon, onBack, onInstall, onUninstall, onUpdate }) => {
        const [actionLoading, setActionLoading] = useState(false);
        const lang = window.I18n?.getCurrentLanguage?.() || 'en';
        const description = typeof addon.description === 'object'
            ? (addon.description[lang] || addon.description['en'] || '')
            : (addon.description || '');

        const handleInstall = useCallback(async () => {
            setActionLoading(true);
            try {
                await onInstall(addon);
            } finally {
                setActionLoading(false);
            }
        }, [addon, onInstall]);

        const handleUninstall = useCallback(async () => {
            const confirmMsg = I18n.t('marketplace.uninstallConfirm', { name: addon.name });
            if (!confirm(confirmMsg)) return;
            setActionLoading(true);
            try {
                await onUninstall(addon.id);
            } finally {
                setActionLoading(false);
            }
        }, [addon, onUninstall]);

        const handleUpdate = useCallback(async () => {
            setActionLoading(true);
            try {
                await onUpdate(addon);
            } finally {
                setActionLoading(false);
            }
        }, [addon, onUpdate]);

        return react.createElement('div', { className: 'ivlyrics-marketplace-detail' },
            // Header
            react.createElement('div', { className: 'ivlyrics-marketplace-detail-header' },
                react.createElement('button', {
                    className: 'ivlyrics-marketplace-detail-back',
                    onClick: onBack,
                },
                    react.createElement('svg', {
                        width: 20, height: 20, viewBox: '0 0 24 24',
                        fill: 'none', stroke: 'currentColor', strokeWidth: 2
                    },
                        react.createElement('path', { d: 'M19 12H5m0 0l7 7m-7-7l7-7' })
                    ),
                    I18n.t('marketplace.backToLyrics')
                ),
            ),
            // Content
            react.createElement('div', { className: 'ivlyrics-marketplace-detail-content' },
                // Preview
                addon.preview && react.createElement('div', { className: 'ivlyrics-marketplace-detail-image' },
                    react.createElement('img', {
                        src: addon.preview,
                        alt: addon.name,
                        onError: (e) => { e.target.style.display = 'none'; }
                    })
                ),
                // Info
                react.createElement('div', { className: 'ivlyrics-marketplace-detail-info' },
                    react.createElement('h2', { className: 'ivlyrics-marketplace-detail-title' }, addon.name),
                    react.createElement('div', { className: 'ivlyrics-marketplace-detail-meta' },
                        react.createElement('span', null,
                            I18n.t('marketplace.by', { author: addon.author })
                        ),
                        react.createElement('span', null,
                            I18n.t('marketplace.version', { version: addon.version })
                        ),
                        addon.updated && react.createElement('span', null,
                            I18n.t('marketplace.updated', { date: addon.updated })
                        ),
                        addon.type && react.createElement('span', {
                            className: `ivlyrics-marketplace-card-type ivlyrics-marketplace-card-type-${addon.type}`
                        }, addon.type === 'lyrics' ? 'Lyrics' : 'AI')
                    ),
                    // Description
                    react.createElement('div', { className: 'ivlyrics-marketplace-detail-description' },
                        description
                    ),
                    // Action Buttons
                    react.createElement('div', { className: 'ivlyrics-marketplace-detail-actions' },
                        addon.hasUpdate && react.createElement('button', {
                            className: 'ivlyrics-marketplace-btn ivlyrics-marketplace-btn-update',
                            onClick: handleUpdate,
                            disabled: actionLoading
                        }, actionLoading ? I18n.t('marketplace.installing') : I18n.t('marketplace.update')),

                        addon.isInstalled
                            ? react.createElement('button', {
                                className: 'ivlyrics-marketplace-btn ivlyrics-marketplace-btn-uninstall',
                                onClick: handleUninstall,
                                disabled: actionLoading
                            }, actionLoading ? I18n.t('marketplace.uninstalling') : I18n.t('marketplace.uninstall'))
                            : react.createElement('button', {
                                className: 'ivlyrics-marketplace-btn ivlyrics-marketplace-btn-install',
                                onClick: handleInstall,
                                disabled: actionLoading
                            }, actionLoading ? I18n.t('marketplace.installing') : I18n.t('marketplace.install'))
                    )
                )
            )
        );
    });

    // ============================================
    // Main MarketplacePage Component
    // ============================================

    const MarketplacePageComponent = react.memo(({ onClose }) => {
        const [addons, setAddons] = useState([]);
        const [loading, setLoading] = useState(true);
        const [error, setError] = useState(null);
        const [filter, setFilter] = useState(FILTER_ALL);
        const [searchQuery, setSearchQuery] = useState('');
        const [selectedAddon, setSelectedAddon] = useState(null);
        const searchInputRef = useRef(null);

        // 에드온 목록 로드
        const loadAddons = useCallback(async (forceRefresh = false) => {
            setLoading(true);
            setError(null);
            try {
                const data = await window.MarketplaceManager.fetchAddonList(forceRefresh);
                setAddons(data.addons || []);
            } catch (e) {
                setError(e.message);
                setAddons([]);
            } finally {
                setLoading(false);
            }
        }, []);

        useEffect(() => {
            loadAddons();

            // 설치/제거 이벤트 리스닝으로 목록 갱신
            const handleChange = () => loadAddons(true);
            const unsub1 = window.MarketplaceManager?.on('addon:installed', handleChange);
            const unsub2 = window.MarketplaceManager?.on('addon:uninstalled', handleChange);
            const unsub3 = window.MarketplaceManager?.on('addon:updated', handleChange);

            return () => {
                if (typeof unsub1 === 'function') unsub1();
                if (typeof unsub2 === 'function') unsub2();
                if (typeof unsub3 === 'function') unsub3();
            };
        }, [loadAddons]);

        // 필터링된 에드온 목록
        const filteredAddons = useMemo(() => {
            let result = addons;

            // 타입 필터
            if (filter !== FILTER_ALL) {
                result = result.filter(a => a.type === filter);
            }

            // 검색 필터
            if (searchQuery.trim()) {
                const q = searchQuery.trim().toLowerCase();
                result = result.filter(a =>
                    a.name.toLowerCase().includes(q) ||
                    a.author.toLowerCase().includes(q) ||
                    (typeof a.description === 'string' && a.description.toLowerCase().includes(q)) ||
                    (typeof a.description === 'object' && Object.values(a.description).some(d => d.toLowerCase().includes(q)))
                );
            }

            return result;
        }, [addons, filter, searchQuery]);

        // 설치 핸들러
        const handleInstall = useCallback(async (addon) => {
            try {
                await window.MarketplaceManager.installAddon(addon);
                Spicetify.showNotification(I18n.t('marketplace.installSuccess', { name: addon.name }));
            } catch (e) {
                Spicetify.showNotification(I18n.t('marketplace.installError'), true);
            }
        }, []);

        // 제거 핸들러
        const handleUninstall = useCallback(async (addonId) => {
            try {
                const addon = window.MarketplaceManager.getInstalledAddon(addonId);
                await window.MarketplaceManager.uninstallAddon(addonId);
                Spicetify.showNotification(I18n.t('marketplace.uninstallSuccess', { name: addon?.name || addonId }));
            } catch (e) {
                Spicetify.showNotification(I18n.t('marketplace.installError'), true);
            }
        }, []);

        // 업데이트 핸들러
        const handleUpdate = useCallback(async (addon) => {
            try {
                await window.MarketplaceManager.updateAddon(addon);
                Spicetify.showNotification(I18n.t('marketplace.installSuccess', { name: addon.name }));
            } catch (e) {
                Spicetify.showNotification(I18n.t('marketplace.installError'), true);
            }
        }, []);

        // 상세 보기
        if (selectedAddon) {
            // 최신 설치 상태로 갱신
            const updatedAddon = addons.find(a => a.id === selectedAddon.id) || selectedAddon;
            return react.createElement(AddonDetail, {
                addon: updatedAddon,
                onBack: () => setSelectedAddon(null),
                onInstall: handleInstall,
                onUninstall: handleUninstall,
                onUpdate: handleUpdate
            });
        }

        // 메인 마켓플레이스 뷰
        return react.createElement('div', { className: 'ivlyrics-marketplace-container' },
            // Header
            react.createElement('div', { className: 'ivlyrics-marketplace-header' },
                react.createElement('div', { className: 'ivlyrics-marketplace-header-left' },
                    react.createElement('button', {
                        className: 'ivlyrics-marketplace-back-btn',
                        onClick: onClose,
                    },
                        react.createElement('svg', {
                            width: 20, height: 20, viewBox: '0 0 24 24',
                            fill: 'none', stroke: 'currentColor', strokeWidth: 2
                        },
                            react.createElement('path', { d: 'M19 12H5m0 0l7 7m-7-7l7-7' })
                        )
                    ),
                    react.createElement('h1', { className: 'ivlyrics-marketplace-title' },
                        I18n.t('marketplace.title')
                    )
                ),
                // Search
                react.createElement('div', { className: 'ivlyrics-marketplace-search-wrapper' },
                    react.createElement('svg', {
                        className: 'ivlyrics-marketplace-search-icon',
                        width: 16, height: 16, viewBox: '0 0 24 24',
                        fill: 'none', stroke: 'currentColor', strokeWidth: 2
                    },
                        react.createElement('circle', { cx: 11, cy: 11, r: 8 }),
                        react.createElement('path', { d: 'M21 21l-4.35-4.35' })
                    ),
                    react.createElement('input', {
                        ref: searchInputRef,
                        className: 'ivlyrics-marketplace-search-input',
                        type: 'text',
                        placeholder: I18n.t('marketplace.search'),
                        value: searchQuery,
                        onChange: (e) => setSearchQuery(e.target.value),
                    })
                )
            ),

            // Filter Tabs
            react.createElement('div', { className: 'ivlyrics-marketplace-filter-tabs' },
                [
                    { key: FILTER_ALL, label: I18n.t('marketplace.filterAll') },
                    { key: FILTER_LYRICS, label: I18n.t('marketplace.filterLyrics') },
                    { key: FILTER_AI, label: I18n.t('marketplace.filterAI') },
                ].map(tab =>
                    react.createElement('button', {
                        key: tab.key,
                        className: `ivlyrics-marketplace-filter-tab ${filter === tab.key ? 'active' : ''}`,
                        onClick: () => setFilter(tab.key)
                    }, tab.label)
                )
            ),

            // Content
            loading
                ? react.createElement('div', { className: 'ivlyrics-marketplace-loading' },
                    react.createElement('div', { className: 'ivlyrics-marketplace-spinner' }),
                    react.createElement('span', null, I18n.t('marketplace.installing'))
                )
                : error
                    ? react.createElement('div', { className: 'ivlyrics-marketplace-error' },
                        react.createElement('p', null, I18n.t('marketplace.loadError')),
                        react.createElement('p', { className: 'ivlyrics-marketplace-error-detail' }, error),
                        react.createElement('button', {
                            className: 'ivlyrics-marketplace-btn ivlyrics-marketplace-btn-install',
                            onClick: () => loadAddons(true)
                        }, I18n.t('marketplace.retry'))
                    )
                    : filteredAddons.length === 0
                        ? react.createElement('div', { className: 'ivlyrics-marketplace-empty' },
                            react.createElement('p', null, I18n.t('marketplace.noAddons'))
                        )
                        : react.createElement('div', { className: 'ivlyrics-marketplace-grid' },
                            filteredAddons.map(addon =>
                                react.createElement(AddonCard, {
                                    key: addon.id,
                                    addon,
                                    onClick: setSelectedAddon
                                })
                            )
                        )
        );
    });

    return MarketplacePageComponent;
})();
