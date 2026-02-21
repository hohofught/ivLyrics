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
    // Markdown Renderer
    // ============================================

    const _mdCache = new Map();

    function renderMarkdownToHTML(md) {
        if (_mdCache.has(md)) return _mdCache.get(md);

        let html = md;

        // Normalize line endings
        html = html.replace(/\r\n/g, '\n');

        // Escape HTML entities (but preserve existing tags we'll generate)
        html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Code blocks (fenced) - must be before other inline rules
        html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
            return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`;
        });

        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Images: ![alt](url)
        html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
            return `<img src="${src}" alt="${alt}" style="max-width:100%;border-radius:8px;margin:8px 0;" loading="lazy" />`;
        });

        // Links: [text](url)
        html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

        // Headings
        html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
        html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
        html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

        // Bold + Italic
        html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

        // Strikethrough
        html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

        // Horizontal rules
        html = html.replace(/^---+$/gm, '<hr />');
        html = html.replace(/^\*\*\*+$/gm, '<hr />');

        // Blockquotes
        html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote>$1</blockquote>');

        // Unordered lists
        html = html.replace(/^[\s]*[-*+]\s+(.+)$/gm, '<li>$1</li>');
        html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

        // Ordered lists
        html = html.replace(/^[\s]*\d+\.\s+(.+)$/gm, '<li>$1</li>');

        // Tables
        html = html.replace(/^\|(.+)\|\s*\n\|[-| :]+\|\s*\n((?:\|.+\|\s*\n?)*)/gm, (_, header, body) => {
            const headers = header.split('|').map(h => h.trim()).filter(Boolean);
            const rows = body.trim().split('\n').map(row =>
                row.split('|').map(c => c.trim()).filter(Boolean)
            );
            let table = '<table><thead><tr>';
            headers.forEach(h => { table += `<th>${h}</th>`; });
            table += '</tr></thead><tbody>';
            rows.forEach(row => {
                table += '<tr>';
                row.forEach(c => { table += `<td>${c}</td>`; });
                table += '</tr>';
            });
            table += '</tbody></table>';
            return table;
        });

        // YouTube embeds (raw URLs on their own line)
        html = html.replace(
            /(?:^|\n)(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)(?:[^\s]*)?(?:\n|$)/gm,
            '\n<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:8px;margin:8px 0;"><iframe src="https://www.youtube.com/embed/$1" style="position:absolute;top:0;left:0;width:100%;height:100%;border:none;" allowfullscreen></iframe></div>\n'
        );

        // Paragraphs: wrap remaining standalone lines
        html = html.replace(/^(?!<[a-z/])((?!<).+)$/gm, '<p>$1</p>');

        // Clean up empty paragraphs
        html = html.replace(/<p>\s*<\/p>/g, '');

        // Merge consecutive blockquotes
        html = html.replace(/<\/blockquote>\s*<blockquote>/g, '<br/>');

        const result = html.trim();
        _mdCache.set(md, result);
        return result;
    }

    function isUrl(str) {
        return typeof str === 'string' && /^https?:\/\//i.test(str.trim());
    }

    // ============================================
    // MarkdownDescription Component
    // ============================================

    const MarkdownDescription = react.memo(({ description }) => {
        const [content, setContent] = useState(null);
        const [loading, setLoading] = useState(false);

        useEffect(() => {
            if (!description) {
                setContent('');
                return;
            }

            if (!isUrl(description)) {
                // description 자체가 마크다운 텍스트
                setContent(renderMarkdownToHTML(description));
                return;
            }

            // URL인 경우 fetch
            let cancelled = false;
            setLoading(true);

            fetch(description.trim(), { cache: 'no-cache' })
                .then(res => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    return res.text();
                })
                .then(md => {
                    if (!cancelled) {
                        setContent(renderMarkdownToHTML(md));
                    }
                })
                .catch(() => {
                    if (!cancelled) {
                        // URL 로드 실패 시 URL 자체를 링크로 표시
                        setContent(`<a href="${description}" target="_blank" rel="noopener noreferrer">${description}</a>`);
                    }
                })
                .finally(() => {
                    if (!cancelled) setLoading(false);
                });

            return () => { cancelled = true; };
        }, [description]);

        if (loading) {
            return react.createElement('div', { className: 'ivlyrics-marketplace-detail-description ivlyrics-marketplace-md-loading' },
                react.createElement('div', { className: 'ivlyrics-marketplace-spinner' }),
            );
        }

        if (!content) {
            return react.createElement('div', { className: 'ivlyrics-marketplace-detail-description' });
        }

        return react.createElement('div', {
            className: 'ivlyrics-marketplace-detail-description ivlyrics-marketplace-md',
            dangerouslySetInnerHTML: { __html: content }
        });
    });

    // ============================================
    // Star Count Helper
    // ============================================

    function formatStarCount(count) {
        if (typeof count !== 'number' || count < 0) return '0';
        if (count >= 1000) return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
        return String(count);
    }

    // ============================================
    // AddonCard Component
    // ============================================

    const AddonCard = react.memo(({ addon, onClick, onAuthorClick }) => {
        const handleAuthorClick = useCallback((e) => {
            e.stopPropagation();
            if (onAuthorClick && addon.authorLogin) {
                onAuthorClick(addon.authorLogin);
            }
        }, [addon.authorLogin, onAuthorClick]);

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
                    addon.authorLogin
                        ? react.createElement('span', {
                            className: 'ivlyrics-marketplace-author-link',
                            onClick: handleAuthorClick,
                            role: 'button',
                            tabIndex: 0
                        }, I18n.t('marketplace.by', { author: addon.author }))
                        : I18n.t('marketplace.by', { author: addon.author })
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
            // Star Count (top-right)
            react.createElement('div', { className: 'ivlyrics-marketplace-stars' },
                react.createElement('svg', {
                    width: 14, height: 14, viewBox: '0 0 24 24',
                    fill: 'currentColor'
                },
                    react.createElement('path', {
                        d: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'
                    })
                ),
                react.createElement('span', null, formatStarCount(addon.stars))
            )
        );
    });

    // ============================================
    // AddonDetail Component
    // ============================================

    // ============================================
    // Sidebar Mini Card (for sidebar popular addons)
    // ============================================

    const SidebarMiniCard = react.memo(({ addon, onClick }) => {
        return react.createElement('div', {
            className: 'ivlyrics-marketplace-sidebar-minicard',
            onClick: () => onClick(addon),
            role: 'button',
            tabIndex: 0
        },
            addon.preview
                ? react.createElement('img', {
                    className: 'ivlyrics-marketplace-sidebar-minicard-img',
                    src: addon.preview,
                    alt: addon.name,
                    loading: 'lazy',
                    onError: (e) => { e.target.style.display = 'none'; }
                })
                : react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-minicard-img ivlyrics-marketplace-sidebar-minicard-placeholder' },
                    react.createElement('svg', {
                        width: 20, height: 20, viewBox: '0 0 24 24',
                        fill: 'none', stroke: 'currentColor', strokeWidth: 1.5
                    },
                        react.createElement('path', {
                            d: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4'
                        })
                    )
                ),
            react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-minicard-info' },
                react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-minicard-name' }, addon.name),
                react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-minicard-meta' },
                    react.createElement('svg', {
                        width: 11, height: 11, viewBox: '0 0 24 24',
                        fill: 'currentColor', style: { color: '#fbbf24' }
                    },
                        react.createElement('path', {
                            d: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'
                        })
                    ),
                    react.createElement('span', null, formatStarCount(addon.stars))
                )
            )
        );
    });

    // ============================================
    // ConfirmModal Component
    // ============================================

    const ConfirmModal = react.memo(({ message, onConfirm, onCancel }) => {
        const handleOverlayClick = useCallback((e) => {
            if (e.target === e.currentTarget) onCancel();
        }, [onCancel]);

        useEffect(() => {
            const handleKey = (e) => {
                if (e.key === 'Escape') onCancel();
                if (e.key === 'Enter') onConfirm();
            };
            window.addEventListener('keydown', handleKey);
            return () => window.removeEventListener('keydown', handleKey);
        }, [onConfirm, onCancel]);

        return react.createElement('div', {
            className: 'ivlyrics-marketplace-confirm-overlay',
            onClick: handleOverlayClick
        },
            react.createElement('div', { className: 'ivlyrics-marketplace-confirm-modal' },
                react.createElement('div', { className: 'ivlyrics-marketplace-confirm-message' }, message),
                react.createElement('div', { className: 'ivlyrics-marketplace-confirm-buttons' },
                    react.createElement('button', {
                        className: 'ivlyrics-marketplace-confirm-btn ivlyrics-marketplace-confirm-btn-cancel',
                        onClick: onCancel
                    }, I18n.t('cancel')),
                    react.createElement('button', {
                        className: 'ivlyrics-marketplace-confirm-btn ivlyrics-marketplace-confirm-btn-ok',
                        onClick: onConfirm
                    }, I18n.t('confirm'))
                )
            )
        );
    });

    // ============================================
    // AddonDetail Component
    // ============================================

    const AddonDetail = react.memo(({ addon, allAddons, onBack, onInstall, onUninstall, onUpdate, onAuthorClick, onAddonClick }) => {
        const [actionLoading, setActionLoading] = useState(false);
        const [showConfirm, setShowConfirm] = useState(false);
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

        const handleUninstall = useCallback(() => {
            setShowConfirm(true);
        }, []);

        const handleConfirmUninstall = useCallback(async () => {
            setShowConfirm(false);
            setActionLoading(true);
            try {
                await onUninstall(addon.id);
            } finally {
                setActionLoading(false);
            }
        }, [addon, onUninstall]);

        const handleCancelUninstall = useCallback(() => {
            setShowConfirm(false);
        }, []);

        const handleUpdate = useCallback(async () => {
            setActionLoading(true);
            try {
                await onUpdate(addon);
            } finally {
                setActionLoading(false);
            }
        }, [addon, onUpdate]);

        const handleAuthorClick = useCallback(() => {
            if (onAuthorClick && addon.authorLogin) {
                onAuthorClick(addon.authorLogin);
            }
        }, [addon.authorLogin, onAuthorClick]);

        // Sidebar data
        const avatarUrl = addon.authorAvatar || (addon.authorLogin ? `https://github.com/${addon.authorLogin}.png?size=128` : '');

        const authorOtherAddons = useMemo(() => {
            if (!allAddons || !addon.authorLogin) return [];
            return allAddons.filter(a => a.authorLogin === addon.authorLogin && a.id !== addon.id);
        }, [allAddons, addon.authorLogin, addon.id]);

        const popularAddons = useMemo(() => {
            if (!allAddons) return [];
            return allAddons
                .filter(a => a.id !== addon.id)
                .sort((a, b) => (b.stars || 0) - (a.stars || 0))
                .slice(0, 5);
        }, [allAddons, addon.id]);

        return react.createElement('div', { className: 'ivlyrics-marketplace-detail' },
            // Header with back button + action buttons
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
                // Action Buttons in header
                react.createElement('div', { className: 'ivlyrics-marketplace-detail-header-actions' },
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
            ),
            // Two-column layout: main content + sidebar
            react.createElement('div', { className: 'ivlyrics-marketplace-detail-layout' },
                // Left: main content (scrollable)
                react.createElement('div', { className: 'ivlyrics-marketplace-detail-main' },
                    // Preview
                    addon.preview && react.createElement('div', { className: 'ivlyrics-marketplace-detail-image' },
                        react.createElement('img', {
                            src: addon.preview,
                            alt: addon.name,
                            onError: (e) => { e.target.style.display = 'none'; }
                        })
                    ),
                    // Title + meta
                    react.createElement('h2', { className: 'ivlyrics-marketplace-detail-title' }, addon.name),
                    react.createElement('div', { className: 'ivlyrics-marketplace-detail-meta' },
                        addon.authorLogin
                            ? react.createElement('span', {
                                className: 'ivlyrics-marketplace-author-link',
                                onClick: handleAuthorClick,
                                role: 'button',
                                tabIndex: 0
                            }, I18n.t('marketplace.by', { author: addon.author }))
                            : react.createElement('span', null,
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
                        }, addon.type === 'lyrics' ? 'Lyrics' : 'AI'),
                        react.createElement('span', { className: 'ivlyrics-marketplace-detail-stars' },
                            react.createElement('svg', {
                                width: 14, height: 14, viewBox: '0 0 24 24',
                                fill: 'currentColor',
                                style: { verticalAlign: 'middle', marginRight: '4px' }
                            },
                                react.createElement('path', {
                                    d: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'
                                })
                            ),
                            formatStarCount(addon.stars)
                        )
                    ),
                    // Description (Markdown rendered)
                    react.createElement(MarkdownDescription, { description })
                ),
                // Right: sidebar
                react.createElement('div', { className: 'ivlyrics-marketplace-detail-sidebar' },
                    // Developer card
                    addon.authorLogin && react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-section' },
                        react.createElement('div', {
                            className: 'ivlyrics-marketplace-sidebar-dev',
                            onClick: handleAuthorClick,
                            role: 'button',
                            tabIndex: 0
                        },
                            avatarUrl && react.createElement('img', {
                                className: 'ivlyrics-marketplace-sidebar-dev-avatar',
                                src: avatarUrl,
                                alt: addon.authorLogin,
                                onError: (e) => { e.target.style.display = 'none'; }
                            }),
                            react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-dev-text' },
                                react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-dev-name' }, addon.authorLogin),
                                react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-dev-label' },
                                    I18n.t('marketplace.developer') || 'Developer'
                                )
                            )
                        ),
                        // Author's other addons
                        authorOtherAddons.length > 0 && react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-list' },
                            react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-title' },
                                I18n.t('marketplace.moreByDeveloper') || 'More by this developer'
                            ),
                            authorOtherAddons.slice(0, 4).map(a =>
                                react.createElement(SidebarMiniCard, {
                                    key: a.id,
                                    addon: a,
                                    onClick: onAddonClick
                                })
                            )
                        )
                    ),
                    // Popular addons
                    popularAddons.length > 0 && react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-section' },
                        react.createElement('div', { className: 'ivlyrics-marketplace-sidebar-title' },
                            I18n.t('marketplace.popular') || 'Popular'
                        ),
                        popularAddons.map(a =>
                            react.createElement(SidebarMiniCard, {
                                key: a.id,
                                addon: a,
                                onClick: onAddonClick
                            })
                        )
                    )
                )
            ),
            showConfirm && react.createElement(ConfirmModal, {
                message: I18n.t('marketplace.uninstallConfirm', { name: addon.name }),
                onConfirm: handleConfirmUninstall,
                onCancel: handleCancelUninstall
            })
        );
    });

    // ============================================
    // DeveloperProfile Component
    // ============================================

    const DeveloperProfile = react.memo(({ authorLogin, addons, onBack, onAddonClick }) => {
        const avatarUrl = useMemo(() => {
            const addonWithAvatar = addons.find(a => a.authorAvatar);
            if (addonWithAvatar?.authorAvatar) return addonWithAvatar.authorAvatar;
            return `https://github.com/${authorLogin}.png?size=200`;
        }, [authorLogin, addons]);

        const githubProfileUrl = `https://github.com/${authorLogin}`;

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
            // Developer Profile Content
            react.createElement('div', { className: 'ivlyrics-marketplace-detail-content' },
                react.createElement('div', { className: 'ivlyrics-marketplace-dev-profile' },
                    react.createElement('img', {
                        className: 'ivlyrics-marketplace-dev-avatar',
                        src: avatarUrl,
                        alt: authorLogin,
                        onError: (e) => { e.target.style.display = 'none'; }
                    }),
                    react.createElement('div', { className: 'ivlyrics-marketplace-dev-info' },
                        react.createElement('h2', { className: 'ivlyrics-marketplace-dev-name' }, authorLogin),
                        react.createElement('a', {
                            className: 'ivlyrics-marketplace-dev-github-link',
                            href: githubProfileUrl,
                            target: '_blank',
                            rel: 'noopener noreferrer',
                            onClick: (e) => e.stopPropagation()
                        },
                            react.createElement('svg', {
                                width: 14, height: 14, viewBox: '0 0 24 24',
                                fill: 'currentColor'
                            },
                                react.createElement('path', {
                                    d: 'M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z'
                                })
                            ),
                            'GitHub'
                        ),
                        react.createElement('span', { className: 'ivlyrics-marketplace-dev-addon-count' },
                            I18n.t('marketplace.addonCount', { count: addons.length }) || `${addons.length} addon(s)`
                        )
                    )
                ),
                react.createElement('h3', { className: 'ivlyrics-marketplace-dev-section-title' },
                    I18n.t('marketplace.developerAddons') || 'Addons'
                ),
                react.createElement('div', { className: 'ivlyrics-marketplace-grid' },
                    addons.map(addon =>
                        react.createElement(AddonCard, {
                            key: addon.id,
                            addon,
                            onClick: onAddonClick
                        })
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
        const [selectedAuthor, setSelectedAuthor] = useState(null);
        const searchInputRef = useRef(null);

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

        const filteredAddons = useMemo(() => {
            let result = addons;

            if (filter !== FILTER_ALL) {
                result = result.filter(a => a.type === filter);
            }

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

        const authorAddons = useMemo(() => {
            if (!selectedAuthor) return [];
            return addons.filter(a => a.authorLogin === selectedAuthor);
        }, [addons, selectedAuthor]);

        const handleAuthorClick = useCallback((authorLogin) => {
            setSelectedAuthor(authorLogin);
            setSelectedAddon(null);
        }, []);

        const handleInstall = useCallback(async (addon) => {
            try {
                await window.MarketplaceManager.installAddon(addon);
                Toast.success(I18n.t('marketplace.installSuccess', { name: addon.name }));
            } catch (e) {
                Toast.error(I18n.t('marketplace.installError'));
            }
        }, []);

        const handleUninstall = useCallback(async (addonId) => {
            try {
                const addon = window.MarketplaceManager.getInstalledAddon(addonId);
                await window.MarketplaceManager.uninstallAddon(addonId);
                Toast.success(I18n.t('marketplace.uninstallSuccess', { name: addon?.name || addonId }));
            } catch (e) {
                Toast.error(I18n.t('marketplace.installError'));
            }
        }, []);

        const handleUpdate = useCallback(async (addon) => {
            try {
                await window.MarketplaceManager.updateAddon(addon);
                Toast.success(I18n.t('marketplace.installSuccess', { name: addon.name }));
            } catch (e) {
                Toast.error(I18n.t('marketplace.installError'));
            }
        }, []);

        let pageContent = null;

        if (selectedAddon) {
            const updatedAddon = addons.find(a => a.id === selectedAddon.id) || selectedAddon;
            pageContent = react.createElement(AddonDetail, {
                addon: updatedAddon,
                allAddons: addons,
                onBack: () => { setSelectedAddon(null); },
                onInstall: handleInstall,
                onUninstall: handleUninstall,
                onUpdate: handleUpdate,
                onAuthorClick: handleAuthorClick,
                onAddonClick: setSelectedAddon
            });
        } else if (selectedAuthor) {
            pageContent = react.createElement(DeveloperProfile, {
                authorLogin: selectedAuthor,
                addons: authorAddons,
                onBack: () => setSelectedAuthor(null),
                onAddonClick: setSelectedAddon
            });
        } else {
            pageContent = react.createElement('div', { className: 'ivlyrics-marketplace-container' },
                react.createElement('div', { className: 'ivlyrics-marketplace-top' },
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
                    )
                ),
                react.createElement('div', { className: 'ivlyrics-marketplace-content' },
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
                                            onClick: setSelectedAddon,
                                            onAuthorClick: handleAuthorClick
                                        })
                                    )
                                )
                )
            );
        }

        return react.createElement('div', { className: 'ivlyrics-marketplace-root' }, pageContent);
    });

    return MarketplacePageComponent;
})();
