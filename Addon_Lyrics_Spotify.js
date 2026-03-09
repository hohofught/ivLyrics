/**
 * Spotify Lyrics Provider Addon
 * Spotify의 내장 가사 서비스를 통해 가사를 제공합니다.
 *
 * @addon-type lyrics
 * @id spotify
 * @name Spotify
 * @version 1.1.0
 * @author ivLis STUDIO
 * @supports karaoke: true
 * @supports synced: true
 * @supports unsynced: true
 */

(() => {
    'use strict';

    // ============================================
    // Addon Metadata
    // ============================================

    const ADDON_INFO = {
        id: 'spotify',
        name: 'Spotify',
        author: 'ivLis STUDIO',
        version: '1.1.0',
        description: {
            en: 'Get lyrics from Spotify\'s built-in lyrics service',
            ko: 'Spotify 내장 가사 서비스에서 가사를 가져옵니다'
        },
        // 지원하는 가사 유형
        supports: {
            karaoke: true,    // Spotify SYLLABLE_SYNCED를 실제 karaoke로 노출
            synced: true,     // 싱크 가사 지원
            unsynced: true    // 일반 가사 지원
        },
        // ivLyrics Sync 데이터 자동 적용 여부
        useIvLyricsSync: true,
        // 아이콘 (SVG path)
        icon: 'M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z'
    };

    // ============================================
    // API Endpoints
    // ============================================

    const LYRICS_API_BASE = 'https://spclient.wg.spotify.com/color-lyrics/v2/track/';

    // ============================================
    // Addon Implementation
    // ============================================

    const LINE_FALLBACK_DURATION_MS = 1800;
    const SPOTIFY_REFERENCE_CACHE_MS = 60000;

    function normalizeText(value) {
        return String(value || '').normalize('NFKC').replace(/\r/g, '').replace(/\s+/g, ' ').trim();
    }

    function deepCopy(value) {
        return value ? JSON.parse(JSON.stringify(value)) : value;
    }

    function getSharedSpotifyReferenceCache() {
        if (!window.__ivLyricsSpotifyReferenceCache) {
            window.__ivLyricsSpotifyReferenceCache = new Map();
        }
        return window.__ivLyricsSpotifyReferenceCache;
    }

    async function getCachedSpotifyReference(trackId, fetcher, ttlMs = SPOTIFY_REFERENCE_CACHE_MS) {
        const cache = getSharedSpotifyReferenceCache();
        const now = Date.now();
        const cached = cache.get(trackId);
        if (cached?.value !== undefined && cached.expiresAt > now) {
            return deepCopy(cached.value);
        }
        if (cached?.promise) {
            return deepCopy(await cached.promise);
        }
        const promise = Promise.resolve()
            .then(fetcher)
            .then(value => {
                cache.set(trackId, {
                    value: value || null,
                    expiresAt: Date.now() + ttlMs
                });
                return value || null;
            })
            .catch(error => {
                cache.delete(trackId);
                throw error;
            });
        cache.set(trackId, { promise, expiresAt: now + ttlMs });
        return deepCopy(await promise);
    }

    function parseMs(value) {
        if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
        if (typeof value === 'string' && value.trim()) {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) return Math.max(0, Math.round(parsed));
        }
        return null;
    }

    function splitDisplaySegments(text) {
        const raw = String(text || '').replace(/\r/g, '');
        if (!raw) return [];
        const matches = raw.match(/\S+\s*/g);
        return matches && matches.length > 0 ? matches : [raw];
    }

    function buildEvenlyTimedSyllables(segments, lineStart, lineEnd) {
        const values = (segments || []).map(item => String(item || '')).filter(Boolean);
        if (values.length === 0) return [];
        const safeStart = Number.isFinite(lineStart) ? lineStart : 0;
        const safeEnd = Number.isFinite(lineEnd) && lineEnd > safeStart ? lineEnd : safeStart + LINE_FALLBACK_DURATION_MS;
        const totalDuration = Math.max(1, safeEnd - safeStart);
        return values.map((text, index) => {
            const startTime = safeStart + Math.round((totalDuration * index) / values.length);
            const endTime = index === values.length - 1
                ? safeEnd
                : safeStart + Math.round((totalDuration * (index + 1)) / values.length);
            return {
                text,
                startTime,
                endTime: Math.max(startTime + 1, endTime)
            };
        });
    }

    function finalizeSyllables(syllables, lineEnd) {
        const items = (syllables || []).filter(item => item && Number.isFinite(item.startTime)).sort((a, b) => a.startTime - b.startTime);
        for (let index = 0; index < items.length; index += 1) {
            const current = items[index];
            const next = items[index + 1] || null;
            const fallbackEnd = next ? next.startTime : lineEnd;
            current.text = String(current.text || '');
            current.endTime = Math.max(current.startTime + 1, Number.isFinite(current.endTime) ? current.endTime : fallbackEnd);
        }
        return items;
    }

    function buildSyncedFromKaraoke(karaoke) {
        return (karaoke || []).map(line => ({
            startTime: Math.max(0, Math.round(line.startTime || 0)),
            endTime: Number.isFinite(line.endTime) ? Math.max(0, Math.round(line.endTime)) : undefined,
            text: normalizeText(line.originalText || line.text || '')
        })).filter(line => line.text);
    }

    function buildUnsyncedFromTimedLines(lines) {
        return (lines || []).map(line => ({
            text: normalizeText(line.originalText || line.text || '')
        })).filter(line => line.text);
    }

    function parseLineSyllables(line, lineStart, lineEnd) {
        const raw = Array.isArray(line?.syllables) ? line.syllables : [];
        if (raw.length === 0) return [];
        if (typeof raw[0] === 'string') {
            return buildEvenlyTimedSyllables(raw, lineStart, lineEnd);
        }
        const mapped = raw.map(item => ({
            text: String(item?.text ?? item?.words ?? item?.syllable ?? item?.label ?? ''),
            startTime: parseMs(item?.startTimeMs ?? item?.startTime ?? item?.startMs),
            endTime: parseMs(item?.endTimeMs ?? item?.endTime ?? item?.endMs)
        })).filter(item => item.text);
        if (mapped.length === 0) return [];
        if (mapped.every(item => Number.isFinite(item.startTime))) {
            return finalizeSyllables(mapped, lineEnd);
        }
        return buildEvenlyTimedSyllables(mapped.map(item => item.text), lineStart, lineEnd);
    }

    const SpotifyLyricsAddon = {
        ...ADDON_INFO,

        /**
         * 초기화
         */
        async init() {
            window.__ivLyricsDebugLog?.(`[Spotify Lyrics Addon] Initialized (v${ADDON_INFO.version})`);
        },

        /**
         * 설정 UI
         */
        getSettingsUI() {
            const React = Spicetify.React;

            return function SpotifyLyricsSettings() {
                return React.createElement('div', { className: 'ai-addon-settings spotify-settings' },
                    React.createElement('div', { className: 'ai-addon-setting', style: { marginTop: '20px' } },
                        React.createElement('div', { className: 'ai-addon-info-box' },
                            React.createElement('p', { style: { fontWeight: 'bold', marginBottom: '8px' } }, 'Spotify Premium Features'),
                            React.createElement('p', null, 'This addon retrieves lyrics directly from Spotify.'),
                            React.createElement('ul', { style: { paddingLeft: '20px', marginTop: '8px', opacity: 0.8 } },
                                React.createElement('li', null, 'Requires Spotify Premium'),
                                React.createElement('li', null, 'Supports multiple providers'),
                                React.createElement('li', null, 'High accuracy & sync quality')
                            )
                        )
                    )
                );
            };
        },

        /**
         * 가사 가져오기
         * @param {Object} info - 트랙 정보 { uri, title, artist, album, duration }
         * @returns {Promise<LyricsResult>}
         */
        async getLyrics(info) {
            const result = {
                uri: info.uri,
                provider: 'spotify',
                karaoke: null,
                synced: null,
                unsynced: null,
                copyright: null,
                error: null,
                // Spotify 내부 가사 provider 정보
                spotifyLyricsProvider: null
            };

            const trackId = info.uri.split(':')[2];

            // Spotify API 호출
            let body;
            try {
                body = await getCachedSpotifyReference(
                    trackId,
                    () => Spicetify.CosmosAsync.get(
                        `${LYRICS_API_BASE}${trackId}?format=json&vocalRemoval=false&market=from_token`
                    )
                );
            } catch (e) {
                result.error = 'Request error';
                return result;
            }

            const lyrics = body?.lyrics;
            if (!lyrics) {
                result.error = 'No lyrics';
                return result;
            }

            // Spotify 내부 가사 provider 추출
            const spotifyLyricsProvider = lyrics.provider || 'unknown';
            result.spotifyLyricsProvider = spotifyLyricsProvider;
            result.spotifySyncType = lyrics.syncType || 'UNSYNCED';
            result.spotifyLanguage = lyrics.language || '';

            // provider 필드를 세분화 (예: spotify-abc)
            result.provider = `spotify-${spotifyLyricsProvider}`;

            // 가사 파싱
            const lines = Array.isArray(lyrics.lines) ? lyrics.lines : [];
            const normalizedLines = lines.map((line, index) => {
                const startTime = parseMs(line?.startTimeMs) ?? parseMs(line?.startTime) ?? 0;
                const nextLine = lines[index + 1];
                const nextStart = nextLine ? (parseMs(nextLine?.startTimeMs) ?? parseMs(nextLine?.startTime)) : null;
                const endTime = parseMs(line?.endTimeMs) ?? parseMs(line?.endTime) ?? (nextStart ?? (startTime + LINE_FALLBACK_DURATION_MS));
                const text = normalizeText(line?.words || line?.text || '');
                return {
                    startTime,
                    endTime: Math.max(startTime + 1, endTime),
                    text,
                    syllables: parseLineSyllables(line, startTime, endTime)
                };
            }).filter(line => line.text);

            if (lyrics.syncType === 'SYLLABLE_SYNCED') {
                result.karaoke = normalizedLines.map(line => ({
                    startTime: line.startTime,
                    endTime: line.endTime,
                    text: line.text,
                    syllables: line.syllables.length > 0
                        ? line.syllables
                        : buildEvenlyTimedSyllables(splitDisplaySegments(line.text), line.startTime, line.endTime)
                }));
                result.synced = buildSyncedFromKaraoke(result.karaoke);
                result.unsynced = buildUnsyncedFromTimedLines(result.synced);
            } else if (lyrics.syncType === 'LINE_SYNCED') {
                result.synced = normalizedLines.map(line => ({
                    startTime: line.startTime,
                    endTime: line.endTime,
                    text: line.text
                }));
                result.unsynced = buildUnsyncedFromTimedLines(result.synced);
            } else {
                result.unsynced = normalizedLines.map(line => ({
                    text: line.text
                }));
            }

            return result;
        }
    };

    // ============================================
    // Registration
    // ============================================

    const registerAddon = () => {
        if (window.LyricsAddonManager) {
            window.LyricsAddonManager.register(SpotifyLyricsAddon);
        } else {
            setTimeout(registerAddon, 100);
        }
    };

    registerAddon();

    window.__ivLyricsDebugLog?.('[Spotify Lyrics Addon] Module loaded');
})();
