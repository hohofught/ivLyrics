/**
 * Better Lyrics Engine Addon
 * @addon-type lyrics
 * @id betterlyrics-engine
 * @name Better Lyrics Engine
 * @version 0.4.0
 * @author ivLis STUDIO
 * @supports karaoke: true
 * @supports synced: true
 * @supports unsynced: true
 */

(() => {
    'use strict';

    const ADDON_INFO = {
        id: 'betterlyrics-engine',
        name: 'Better Lyrics Engine',
        author: 'ivLis STUDIO',
        version: '0.4.0',
        description: {
            en: 'Better Lyrics style multi-source engine with Spotify reference alignment',
            ko: 'Spotify 기준 정렬 기반 Better Lyrics 멀티소스 엔진'
        },
        supports: { karaoke: true, synced: true, unsynced: true },
        useIvLyricsSync: true,
        icon: 'M4 4h11l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4zm10 1.5V10h4.5L14 5.5zM8 13h8v2H8v-2zm0 4h6v2H8v-2z'
    };

    const WAIT_RETRY_MS = 100;
    const STORAGE_PREFIX = 'ivLyrics:betterlyrics-engine:';
    const TURNSTILE_TIMEOUT_MS = 30000;
    const JWT_REFRESH_MARGIN_MS = 45000;
    const DEFAULT_TIMEOUT_MS = 10000;
    const LINE_FALLBACK_DURATION_MS = 1800;
    const SPOTIFY_ALIGN_ACCEPT_THRESHOLD = 0.5;
    const SPOTIFY_ALIGN_REBUILD_THRESHOLD = 0.7;
    const BLYRICS_INSTRUMENTAL_GAP_MS = 5000;
    const INSTRUMENTAL_NOTE_TEXT = '\u266A';
    const HELPER_PORT = 15124;
    const HELPER_BASE = `http://127.0.0.1:${HELPER_PORT}`;
    const HELPER_HEALTH_CACHE_MS = 5000;
    const HELPER_LAUNCH_PROTOCOL = 'ivlyrics-cubey-helper://launch';
    const HELPER_LAUNCH_COOLDOWN_MS = 8000;
    const HELPER_LAUNCH_WAIT_MS = 12000;
    const HELPER_LAUNCH_POLL_MS = 500;
    const HELPER_AUTH_POLL_MS = 700;
    const HELPER_AUTH_TIMEOUT_MS = 90000;
    const SOURCE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    const SOURCE_FAILURE_COOLDOWN_MS = 60000;
    const SOURCE_UNAVAILABLE_COOLDOWN_MS = 10 * 60 * 1000;
    const SPOTIFY_REFERENCE_CACHE_MS = 60000;
    const DEBUG_LOG_COOLDOWN_MS = 15000;
    const CACHE_VERSION = 2;
    const BLYRICS_API_URL = 'https://lyrics-api.boidu.dev/getLyrics';
    const LEGATO_API_URL = 'https://lyrics-api.boidu.dev/kugou/getLyrics';
    const LRCLIB_API_BASE = 'https://lrclib.net/api';
    const KARAOKE_TEXT_GRAFT_PRESERVE_THRESHOLD = 0.92;

    const TRANSPORT = Object.freeze({
        HELPER: 'helper',
        DIRECT: 'direct',
        MANUAL: 'manual'
    });

    const SOURCE = Object.freeze({
        BLYRICS_RICHSYNCED: 'blyrics-richsynced',
        MUSIXMATCH_RICHSYNC: 'musixmatch-richsync',
        SPOTIFY_SYLLABLE: 'spotify-syllable',
        SPOTIFY_LINE: 'spotify-line',
        BLYRICS_SYNCED: 'blyrics-synced',
        LRCLIB_SYNCED: 'lrclib-synced',
        LEGATO_SYNCED: 'legato-synced',
        MUSIXMATCH_SYNCED: 'musixmatch-synced',
        LRCLIB_PLAIN: 'lrclib-plain'
    });

    const DEFAULT_SOURCE_PREFERENCE_LIST = Object.freeze([
        SOURCE.BLYRICS_RICHSYNCED,
        SOURCE.MUSIXMATCH_RICHSYNC,
        SOURCE.SPOTIFY_SYLLABLE,
        SOURCE.BLYRICS_SYNCED,
        SOURCE.LRCLIB_SYNCED,
        SOURCE.LEGATO_SYNCED,
        SOURCE.SPOTIFY_LINE,
        SOURCE.MUSIXMATCH_SYNCED,
        SOURCE.LRCLIB_PLAIN
    ]);

    const FETCHABLE_SOURCE_KEYS = Object.freeze([
        SOURCE.BLYRICS_RICHSYNCED,
        SOURCE.MUSIXMATCH_RICHSYNC,
        SOURCE.BLYRICS_SYNCED,
        SOURCE.LRCLIB_SYNCED,
        SOURCE.LEGATO_SYNCED,
        SOURCE.MUSIXMATCH_SYNCED,
        SOURCE.LRCLIB_PLAIN
    ]);

    const SOURCE_CONFIG = Object.freeze({
        [SOURCE.BLYRICS_RICHSYNCED]: {
            label: 'Better Lyrics',
            syncType: 'syllable',
            description: 'BoiDu TTML rich-sync fallback.',
            unavailableReason: 'Direct bLyrics Fallback is off.',
            runtimeEnabled: settings => settings.enableBLyricsDirect
        },
        [SOURCE.MUSIXMATCH_RICHSYNC]: {
            label: 'Musixmatch',
            syncType: 'word',
            description: 'Cubey rich-sync lyrics and metadata correction.',
            unavailableReason: 'Enable Cubey is off.',
            runtimeEnabled: settings => settings.enableCubey
        },
        [SOURCE.SPOTIFY_SYLLABLE]: {
            label: 'Spotify Official',
            syncType: 'syllable',
            description: 'Official Spotify syllable-synced lyrics.',
            unavailableReason: 'Spotify Reference Layer is off.',
            runtimeEnabled: settings => settings.enableSpotifyValidation
        },
        [SOURCE.SPOTIFY_LINE]: {
            label: 'Spotify Official',
            syncType: 'line',
            description: 'Official Spotify line-synced lyrics.',
            unavailableReason: 'Spotify Reference Layer is off.',
            runtimeEnabled: settings => settings.enableSpotifyValidation
        },
        [SOURCE.BLYRICS_SYNCED]: {
            label: 'Better Lyrics',
            syncType: 'line',
            description: 'BoiDu TTML line-sync fallback.',
            unavailableReason: 'Direct bLyrics Fallback is off.',
            runtimeEnabled: settings => settings.enableBLyricsDirect
        },
        [SOURCE.LRCLIB_SYNCED]: {
            label: 'LRCLIB',
            syncType: 'line',
            description: 'LRCLIB synced lyrics fallback.',
            unavailableReason: 'Direct LRCLIB Fallback is off.',
            runtimeEnabled: settings => settings.enableLrclibDirect
        },
        [SOURCE.LEGATO_SYNCED]: {
            label: 'Legato',
            syncType: 'line',
            description: 'Legato/Kugou synced lyrics fallback.',
            unavailableReason: 'Direct Legato Fallback is off.',
            runtimeEnabled: settings => settings.enableLegatoDirect
        },
        [SOURCE.MUSIXMATCH_SYNCED]: {
            label: 'Musixmatch',
            syncType: 'line',
            description: 'Cubey Musixmatch line-sync fallback.',
            unavailableReason: 'Enable Cubey is off.',
            runtimeEnabled: settings => settings.enableCubey
        },
        [SOURCE.LRCLIB_PLAIN]: {
            label: 'LRCLIB',
            syncType: 'unsynced',
            description: 'LRCLIB plain lyrics fallback.',
            unavailableReason: 'Direct LRCLIB Fallback is off.',
            runtimeEnabled: settings => settings.enableLrclibDirect
        }
    });

    const SOURCE_SYNC_LABEL = Object.freeze({
        syllable: 'Syllable',
        word: 'Word',
        line: 'Line',
        unsynced: 'Plain'
    });

    const DEFAULT_SETTINGS = Object.freeze({
        enable_cubey: true,
        enable_blyrics_direct: true,
        enable_legato_direct: true,
        enable_lrclib_direct: true,
        enable_spotify_validation: true,
        source_preference_list: DEFAULT_SOURCE_PREFERENCE_LIST,
        transport_mode: TRANSPORT.HELPER,
        cubey_base_url: 'https://lyrics.api.dacubeking.com',
        helper_url: HELPER_BASE,
        helper_auto_launch: true,
        cubey_auto_auth: true,
        cubey_manual_token: '',
        request_timeout_ms: DEFAULT_TIMEOUT_MS,
        debug: false
    });

    const RuntimeState = {
        lastFailure: null,
        helperConnected: null,
        helperSessionId: null,
        helperSessionExp: 0,
        helperLastHealthCheck: 0,
        helperLastUrl: '',
        helperLaunchAt: 0,
        helperLaunchPromise: null,
        helperAuthPromise: null,
        sourceCooldowns: new Map(),
        debugLogCooldowns: new Map()
    };

    function getManager() {
        return window.LyricsAddonManager || null;
    }

    function getSetting(key, defaultValue) {
        return getManager()?.getAddonSetting(ADDON_INFO.id, key, defaultValue) ?? defaultValue;
    }

    function setSetting(key, value) {
        getManager()?.setAddonSetting(ADDON_INFO.id, key, value);
    }

    function clampNumber(value, fallback, min, max) {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.max(min, Math.min(max, Math.round(parsed)));
    }

    function normalizeText(value) {
        return String(value || '').normalize('NFKC').replace(/\r/g, '').replace(/\s+/g, ' ').trim();
    }

    function stripBracketContent(value) {
        return String(value || '')
            .replace(/\((?:\s*cv\s*[:：].*?|tv\s*size.*?)\)/gi, ' ')
            .replace(/（(?:\s*cv\s*[:：].*?|tv\s*size.*?)）/gi, ' ')
            .replace(/\[(?:tv\s*size|inst\.?|instrumental|off vocal|ver\.?.*?)\]/gi, ' ');
    }

    function normalizeQueryText(value) {
        return normalizeText(stripBracketContent(value))
            .replace(/\b(?:feat|featuring|with)\b.*$/i, ' ')
            .replace(/\s*\/\s*.+$/, ' ')
            .replace(/\s*-\s*(?:tv\s*size|inst\.?|instrumental|ver\.?.*)$/i, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function buildArtistVariants(value) {
        const raw = normalizeQueryText(value)
            .replace(/(?:^|[\s,])(?:cv|cast)\s*[:：].*$/i, ' ')
            .replace(/[|;]/g, ',');
        const parts = raw.split(/(?:,|&|\/|／|\bfeat\.?\b|\bwith\b)/i)
            .map(part => normalizeText(part))
            .filter(Boolean);
        const variants = [];
        const push = item => {
            const normalized = normalizeText(item);
            if (!normalized || variants.includes(normalized)) return;
            variants.push(normalized);
        };
        push(raw);
        parts.forEach(push);
        if (parts.length > 1) push(parts[0]);
        return variants;
    }

    function normalizeTrackQuery(info) {
        const title = normalizeQueryText(info?.title || '');
        const album = normalizeQueryText(info?.album || '');
        const artistVariants = buildArtistVariants(info?.artist || '');
        return {
            title,
            album,
            artistVariants,
            artist: artistVariants[0] || normalizeQueryText(info?.artist || ''),
            duration: Number(info?.duration) || 0
        };
    }

    function buildQueryVariants(info, metadataSource = null) {
        const base = normalizeTrackQuery(metadataSource || info || {});
        const variants = [];
        const seen = new Set();
        const push = candidate => {
            const normalized = {
                title: normalizeQueryText(candidate?.title || ''),
                artist: normalizeQueryText(candidate?.artist || ''),
                album: normalizeQueryText(candidate?.album || ''),
                duration: Number(candidate?.duration) || 0
            };
            const key = `${normalized.title}__${normalized.artist}__${normalized.album}__${normalized.duration}`;
            if (!normalized.title || !normalized.artist || seen.has(key)) return;
            seen.add(key);
            variants.push(normalized);
        };

        push(base);
        base.artistVariants.forEach(artist => push({ ...base, artist, album: base.album }));
        base.artistVariants.forEach(artist => push({ ...base, artist, album: '' }));
        base.artistVariants.forEach(artist => push({ ...base, artist, album: '', duration: 0 }));
        if (metadataSource) {
            const normalizedMeta = normalizeTrackQuery(metadataSource);
            push(normalizedMeta);
            normalizedMeta.artistVariants.forEach(artist => push({ ...normalizedMeta, artist, album: normalizedMeta.album }));
            normalizedMeta.artistVariants.forEach(artist => push({ ...normalizedMeta, artist, album: '' }));
        }
        return variants;
    }

    function normalizeBaseUrl(rawUrl) {
        const raw = String(rawUrl || '').trim().replace(/\/+$/, '');
        if (!raw) return '';
        try {
            const parsed = new URL(raw);
            parsed.hash = '';
            parsed.search = '';
            return parsed.toString().replace(/\/+$/, '');
        } catch {
            return raw;
        }
    }

    function isLocalHelperUrl(rawUrl) {
        try {
            const parsed = new URL(normalizeBaseUrl(rawUrl) || HELPER_BASE);
            return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
        } catch {
            return false;
        }
    }

    function normalizeSourcePreferenceList(rawList) {
        const knownSourceIds = new Set(DEFAULT_SOURCE_PREFERENCE_LIST);
        const nextList = [];
        const seen = new Set();

        if (Array.isArray(rawList)) {
            rawList.forEach(item => {
                const raw = String(item || '').trim();
                if (!raw) return;
                const disabled = raw.startsWith('d_');
                const sourceId = disabled ? raw.slice(2) : raw;
                if (!knownSourceIds.has(sourceId) || seen.has(sourceId)) return;
                seen.add(sourceId);
                nextList.push(disabled ? `d_${sourceId}` : sourceId);
            });
        }

        DEFAULT_SOURCE_PREFERENCE_LIST.forEach(sourceId => {
            if (seen.has(sourceId)) return;
            seen.add(sourceId);
            nextList.push(sourceId);
        });

        return nextList.length > 0 ? nextList : [...DEFAULT_SOURCE_PREFERENCE_LIST];
    }

    function getSourcePreferenceEntries(rawList) {
        return normalizeSourcePreferenceList(rawList).map(item => {
            const enabled = !item.startsWith('d_');
            return {
                id: enabled ? item : item.slice(2),
                enabled
            };
        });
    }

    function serializeSourcePreferenceEntries(entries) {
        return normalizeSourcePreferenceList(
            (entries || []).map(entry => (entry?.enabled === false ? `d_${entry.id}` : entry.id))
        );
    }

    function isSourceRuntimeEnabled(settings, sourceId) {
        const config = SOURCE_CONFIG[sourceId];
        return !!(config && typeof config.runtimeEnabled === 'function' && config.runtimeEnabled(settings));
    }

    function isSpotifyValidationExemptSource(sourceId) {
        return sourceId === SOURCE.BLYRICS_RICHSYNCED || sourceId === SOURCE.BLYRICS_SYNCED;
    }

    function getSourceRuntimeUnavailableReason(settings, sourceId) {
        const config = SOURCE_CONFIG[sourceId];
        if (!config || isSourceRuntimeEnabled(settings, sourceId)) return '';
        return config.unavailableReason || 'Currently unavailable.';
    }

    function buildSelectionSteps(settings) {
        const enabledSourceIds = getSourcePreferenceEntries(settings.sourcePreferenceList)
            .filter(entry => entry.enabled)
            .map(entry => entry.id);
        const steps = [];

        enabledSourceIds.forEach(sourceId => {
            if (!isSourceRuntimeEnabled(settings, sourceId)) return;
            if (sourceId === SOURCE.SPOTIFY_SYLLABLE) {
                steps.push({ kind: 'spotify-syllable', sourceId });
                return;
            }
            if (sourceId === SOURCE.SPOTIFY_LINE) {
                steps.push({ kind: 'spotify-line', sourceId });
                return;
            }
            steps.push({ kind: 'source', sourceKey: sourceId });
        });

        if (
            settings.enableSpotifyValidation &&
            (enabledSourceIds.includes(SOURCE.SPOTIFY_SYLLABLE) || enabledSourceIds.includes(SOURCE.SPOTIFY_LINE))
        ) {
            steps.push({ kind: 'spotify-fallback' });
        }

        return steps;
    }

    function initializeSpotifySourceState(context, settings, spotifyReference) {
        const canUseSpotify = !!settings.enableSpotifyValidation;
        const hasSyllable = canUseSpotify
            && spotifyReference?.syncType === 'SYLLABLE_SYNCED'
            && hasLyricsPayload(spotifyReference.nativeResult);
        const hasLine = canUseSpotify
            && spotifyReference?.syncType === 'LINE_SYNCED'
            && hasLyricsPayload(spotifyReference.nativeResult);

        context.availableSources[SOURCE.SPOTIFY_SYLLABLE] = !!hasSyllable;
        context.availableSources[SOURCE.SPOTIFY_LINE] = !!hasLine;
        setSourceDiagnostic(context, SOURCE.SPOTIFY_SYLLABLE, {
            acquisitionState: !canUseSpotify ? 'master_unavailable' : (hasSyllable ? 'selected' : 'not_available')
        });
        setSourceDiagnostic(context, SOURCE.SPOTIFY_LINE, {
            acquisitionState: !canUseSpotify ? 'master_unavailable' : (hasLine ? 'selected' : 'not_available')
        });
    }

    function getRuntimeSettings() {
        const sourcePreferenceList = normalizeSourcePreferenceList(
            getSetting('source_preference_list', DEFAULT_SETTINGS.source_preference_list)
        );
        return {
            enableCubey: !!getSetting('enable_cubey', DEFAULT_SETTINGS.enable_cubey),
            enableBLyricsDirect: !!getSetting('enable_blyrics_direct', DEFAULT_SETTINGS.enable_blyrics_direct),
            enableLegatoDirect: !!getSetting('enable_legato_direct', DEFAULT_SETTINGS.enable_legato_direct),
            enableLrclibDirect: !!getSetting('enable_lrclib_direct', DEFAULT_SETTINGS.enable_lrclib_direct),
            enableSpotifyValidation: !!getSetting('enable_spotify_validation', DEFAULT_SETTINGS.enable_spotify_validation),
            sourcePreferenceList,
            transportMode: getSetting('transport_mode', DEFAULT_SETTINGS.transport_mode),
            cubeyBaseUrl: normalizeBaseUrl(getSetting('cubey_base_url', DEFAULT_SETTINGS.cubey_base_url)),
            helperUrl: normalizeBaseUrl(getSetting('helper_url', DEFAULT_SETTINGS.helper_url)) || HELPER_BASE,
            helperAutoLaunch: !!getSetting('helper_auto_launch', DEFAULT_SETTINGS.helper_auto_launch),
            cubeyAutoAuth: !!getSetting('cubey_auto_auth', DEFAULT_SETTINGS.cubey_auto_auth),
            cubeyManualToken: String(getSetting('cubey_manual_token', DEFAULT_SETTINGS.cubey_manual_token) || '').trim(),
            requestTimeoutMs: clampNumber(getSetting('request_timeout_ms', DEFAULT_SETTINGS.request_timeout_ms), DEFAULT_TIMEOUT_MS, 2000, 30000),
            debug: !!getSetting('debug', DEFAULT_SETTINGS.debug)
        };
    }

    function debugLog(...args) {
        if (getRuntimeSettings().debug) console.log('[BetterLyricsEngine]', ...args);
    }

    function debugLogOnce(key, ...args) {
        if (!getRuntimeSettings().debug) return;
        const now = Date.now();
        const lastAt = RuntimeState.debugLogCooldowns.get(key) || 0;
        if ((now - lastAt) < DEBUG_LOG_COOLDOWN_MS) return;
        RuntimeState.debugLogCooldowns.set(key, now);
        console.log('[BetterLyricsEngine]', ...args);
    }

    function readStorage(key) {
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
    }

    function writeStorage(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch {}
    }

    function rememberFailure(stage, detail) {
        RuntimeState.lastFailure = { stage, at: Date.now(), ...detail };
        debugLog('Failure captured', RuntimeState.lastFailure);
    }

    function clearFailure() {
        RuntimeState.lastFailure = null;
    }

    function formatFailureMessage(failure) {
        if (!failure) return 'No lyrics';
        if (failure.reason === 'cors_blocked') return 'Cubey direct fetch blocked by CORS. Use helper mode.';
        if (failure.reason === 'helper_offline') return `cubey-helper is not running on port ${HELPER_PORT}.`;
        if (failure.reason === 'auth_unavailable') return 'Cubey auth token is not available.';
        if (failure.reason === 'http_error') {
            if (failure.upstreamStatus) return `Cubey upstream failed with HTTP ${failure.upstreamStatus}.`;
            if (failure.status) return `Cubey request failed with HTTP ${failure.status}.`;
        }
        return failure.message || 'No lyrics';
    }

    function isProbablyCorsFetchError(error) {
        return /Failed to fetch/i.test(String(error?.message || error || ''));
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

    function getSourceCooldownKey(context, sourceKey) {
        const trackId = context?.trackId || '';
        const title = normalizeText(context?.baseInfo?.title || context?.queryInfo?.title || '');
        const artist = normalizeText(context?.baseInfo?.artist || context?.queryInfo?.artist || '');
        return `${sourceKey}::${trackId || `${title}::${artist}`}`;
    }

    function isSourceCoolingDown(context, sourceKey) {
        const key = getSourceCooldownKey(context, sourceKey);
        const expiresAt = RuntimeState.sourceCooldowns.get(key) || 0;
        if (expiresAt <= Date.now()) {
            RuntimeState.sourceCooldowns.delete(key);
            return false;
        }
        return true;
    }

    function setSourceCooldown(context, sourceKey, ttlMs = SOURCE_FAILURE_COOLDOWN_MS) {
        RuntimeState.sourceCooldowns.set(getSourceCooldownKey(context, sourceKey), Date.now() + ttlMs);
    }

    function clearSourceCooldown(context, sourceKey) {
        RuntimeState.sourceCooldowns.delete(getSourceCooldownKey(context, sourceKey));
    }

    function createEmptyResult(info) {
        return {
            uri: info?.uri || '',
            provider: ADDON_INFO.id,
            sourceId: null,
            karaoke: null,
            synced: null,
            unsynced: null,
            contributors: null,
            copyright: null,
            error: null,
            debug: {
                selectedSource: null,
                spotifyCoverage: null,
                spotifyAligned: false,
                alignmentMode: null,
                validationState: null,
                acquisitionState: null
            }
        };
    }

    function hasLyricsPayload(payload) {
        return !!(payload?.karaoke?.length || payload?.synced?.length || payload?.unsynced?.length);
    }

    function similarity(a, b) {
        const left = normalizeText(a).toLowerCase();
        const right = normalizeText(b).toLowerCase();
        if (!left || !right) return 0;
        if (left === right) return 1;
        const la = left.length;
        const lb = right.length;
        const maxLen = Math.max(la, lb);
        let prev = Array.from({ length: lb + 1 }, (_, i) => i);
        for (let i = 1; i <= la; i++) {
            const curr = [i];
            for (let j = 1; j <= lb; j++) {
                const cost = left[i - 1] === right[j - 1] ? 0 : 1;
                curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
            }
            prev = curr;
        }
        return 1 - prev[lb] / maxLen;
    }

    async function requestText(url, options = {}) {
        const controller = new AbortController();
        const timeoutMs = clampNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 60000);
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                method: options.method || 'GET',
                headers: options.headers,
                body: options.body,
                credentials: options.credentials,
                cache: options.cache || 'no-cache',
                signal: controller.signal
            });
            return { ok: response.ok, status: response.status, text: await response.text(), error: null };
        } catch (error) {
            return { ok: false, status: 0, text: '', error };
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async function requestJson(url, options = {}) {
        const response = await requestText(url, options);
        let data = null;
        if (response.text) {
            try { data = JSON.parse(response.text); } catch { data = null; }
        }
        return { ...response, data };
    }

    function parseMs(value) {
        if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
        if (typeof value === 'string' && value.trim()) {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) return Math.max(0, Math.round(parsed));
        }
        return null;
    }

    function isInstrumentalLine(line) {
        return !!line?.isInstrumental;
    }

    function getLineBaseText(line) {
        return normalizeText(line?.originalText || line?.text || '');
    }

    function sortTimedSegments(segments) {
        return (segments || []).filter(Boolean).slice().sort((left, right) => (left?.startTime || 0) - (right?.startTime || 0));
    }

    function getLeadLineSyllables(line) {
        if (line?.vocals?.lead?.syllables?.length) {
            return sortTimedSegments(Array.isArray(line.vocals.lead.syllables) ? line.vocals.lead.syllables : []);
        }
        return Array.isArray(line?.syllables) ? sortTimedSegments(line.syllables) : [];
    }

    function getBackgroundGroups(line) {
        return Array.isArray(line?.vocals?.background)
            ? line.vocals.background.filter(group => Array.isArray(group?.syllables) && group.syllables.length > 0)
            : [];
    }

    function getAllLineSyllables(line) {
        const lead = getLeadLineSyllables(line);
        const background = getBackgroundGroups(line)
            .flatMap(group => Array.isArray(group?.syllables) ? group.syllables : []);
        return sortTimedSegments([...lead, ...background]);
    }

    function getLineSyllables(line) {
        return getLeadLineSyllables(line);
    }

    function lineHasBackgroundVocals(line) {
        return getBackgroundGroups(line).length > 0;
    }

    function lineHasNativePhonetic(line) {
        const original = normalizeText(line?.originalText || '');
        const phonetic = normalizeText(line?.text || '');
        return !!(original && phonetic && original !== phonetic);
    }

    function lineHasNativeTranslation(line) {
        return !!normalizeText(line?.text2 || line?.translation || line?.translationText || '');
    }

    function annotateLineMetadata(line, extra = {}) {
        if (!line || typeof line !== 'object') return line;
        const hasNativePhonetic = lineHasNativePhonetic(line);
        const hasNativeTranslation = lineHasNativeTranslation(line);
        const hasBackgroundVocals = lineHasBackgroundVocals(line);
        const next = {
            ...line,
            layout: {
                subLineCount: (hasNativePhonetic ? 1 : 0) + (hasNativeTranslation ? 1 : 0),
                hasNativePhonetic,
                hasNativeTranslation,
                hasBackgroundVocals,
                contaminationSafe: extra.contaminationSafe !== false
            },
            annotations: {
                phoneticOrigin: hasNativePhonetic ? (extra.phoneticOrigin || 'provider') : null,
                translationOrigin: hasNativeTranslation ? (extra.translationOrigin || 'provider') : null
            }
        };
        return next;
    }

    function annotateResultPayload(result, debugPatch = {}) {
        if (!result || typeof result !== 'object') return result;
        const next = deepCopy(result);
        const annotateLines = lines => Array.isArray(lines)
            ? lines.map(line => annotateLineMetadata(line, {
                contaminationSafe: line?.layout?.contaminationSafe !== false,
                phoneticOrigin: line?.annotations?.phoneticOrigin || 'provider',
                translationOrigin: line?.annotations?.translationOrigin || 'provider'
            }))
            : lines;
        next.karaoke = annotateLines(next.karaoke);
        next.synced = annotateLines(next.synced);
        next.unsynced = annotateLines(next.unsynced);
        next.debug = {
            ...(next.debug || {}),
            ...debugPatch
        };
        return next;
    }

    function collectCandidateText(result) {
        const lines = result?.karaoke || result?.synced || result?.unsynced || [];
        return normalizeText(
            lines
                .filter(line => !isInstrumentalLine(line))
                .map(line => getLineBaseText(line) || normalizeText(line?.text || ''))
                .join('\n')
        );
    }

    function buildUnsyncedFromPlainText(rawText) {
        return String(rawText || '').replace(/\r/g, '').split('\n')
            .map(line => normalizeText(line))
            .filter(Boolean)
            .map(text => ({ text }));
    }

    function finalizeSyllableGroup(syllables, lineStart, nextLineStart, lineFallbackEnd) {
        const sorted = (syllables || []).filter(item => item && Number.isFinite(item.startTime)).sort((a, b) => a.startTime - b.startTime);
        if (sorted.length === 0) return [];
        for (let i = 0; i < sorted.length; i++) {
            const current = sorted[i];
            const next = sorted[i + 1] || null;
            const fallbackEnd = next ? next.startTime : (Number.isFinite(lineFallbackEnd) ? lineFallbackEnd : (Number.isFinite(nextLineStart) ? nextLineStart : lineStart + LINE_FALLBACK_DURATION_MS));
            current.text = String(current.text || '');
            current.endTime = Math.max((current.startTime || 0) + 1, Number.isFinite(current.endTime) ? current.endTime : fallbackEnd);
        }
        return sorted;
    }

    function finalizeKaraokeLines(lines) {
        const sorted = (lines || []).filter(line => line && Number.isFinite(line.startTime)).sort((a, b) => a.startTime - b.startTime);
        for (let i = 0; i < sorted.length; i++) {
            const line = sorted[i];
            const nextLine = sorted[i + 1] || null;
            const nextLineStart = nextLine ? nextLine.startTime : null;
            const lineFallbackEnd = Number.isFinite(line.endTime) ? line.endTime : (nextLineStart ?? (line.startTime + LINE_FALLBACK_DURATION_MS));
            const displayBaseText = line.text || line.originalText || '';
            if (Array.isArray(line.syllables) && line.syllables.length > 0) {
                line.syllables = reconcileDisplaySegmentsWithSyllables(
                    displayBaseText,
                    finalizeSyllableGroup(line.syllables, line.startTime, nextLineStart, lineFallbackEnd)
                );
            }
            if (line?.vocals?.lead?.syllables?.length) {
                line.vocals.lead.syllables = reconcileDisplaySegmentsWithSyllables(
                    displayBaseText,
                    finalizeSyllableGroup(line.vocals.lead.syllables, line.startTime, nextLineStart, lineFallbackEnd)
                );
            }
            if (Array.isArray(line?.vocals?.background)) {
                line.vocals.background = line.vocals.background.map(group => ({
                    ...group,
                    syllables: reconcileDisplaySegmentsWithSyllables(
                        group?.text || '',
                        finalizeSyllableGroup(group?.syllables || [], line.startTime, nextLineStart, lineFallbackEnd)
                    )
                })).filter(group => group.syllables.length > 0);
            }
            const primarySyllables = getLeadLineSyllables(line);
            const timingSyllables = getAllLineSyllables(line);
            const displaySyllables = primarySyllables.length > 0 ? primarySyllables : timingSyllables;
            line.text = normalizeText(line.text || line.originalText || displaySyllables.map(item => item.text || '').join(''));
            line.endTime = timingSyllables.length > 0
                ? Math.max(line.endTime || 0, timingSyllables[timingSyllables.length - 1].endTime, nextLineStart ?? (line.startTime + LINE_FALLBACK_DURATION_MS))
                : Math.max(line.endTime || 0, nextLineStart ?? (line.startTime + LINE_FALLBACK_DURATION_MS));
        }
        return sorted.filter(line => line.text);
    }

    function buildSyncedFromKaraoke(karaoke) {
        return (karaoke || []).map(line => {
            const text = getLineBaseText(line);
            return {
                startTime: Math.max(0, Math.round(line.startTime || 0)),
                endTime: Number.isFinite(line.endTime) ? Math.max(0, Math.round(line.endTime)) : undefined,
                text,
                isInstrumental: !!line?.isInstrumental,
                originalText: line?.originalText || undefined,
                text2: line?.text2 || line?.translation || line?.translationText || undefined,
                translation: line?.translation || line?.text2 || line?.translationText || undefined,
                translationText: line?.translationText || line?.text2 || line?.translation || undefined
            };
        }).filter(line => line.text);
    }

    function buildUnsyncedFromTimedLines(lines) {
        return (lines || []).map(line => {
            const text = getLineBaseText(line);
            return {
                text,
                isInstrumental: !!line?.isInstrumental,
                originalText: line?.originalText || undefined,
                text2: line?.text2 || line?.translation || line?.translationText || undefined,
                translation: line?.translation || line?.text2 || line?.translationText || undefined,
                translationText: line?.translationText || line?.text2 || line?.translation || undefined
            };
        }).filter(line => line.text);
    }

    function splitDisplaySegments(text) {
        const raw = String(text || '').replace(/\r/g, '');
        if (!raw) return [];
        const matches = raw.match(/\S+\s*/g);
        return matches && matches.length > 0 ? matches : [raw];
    }

    function reconcileDisplaySegmentsWithSyllables(displayText, syllables) {
        const safeSyllables = Array.isArray(syllables) ? syllables.filter(Boolean) : [];
        if (safeSyllables.length === 0) return safeSyllables;
        const displaySegments = splitDisplaySegments(displayText);
        if (displaySegments.length !== safeSyllables.length) return safeSyllables;
        const displaySignature = displaySegments.map(normalizeTokenForAlignment).join('|');
        const syllableSignature = safeSyllables.map(item => normalizeTokenForAlignment(item?.text || '')).join('|');
        if (!displaySignature || displaySignature !== syllableSignature) return safeSyllables;
        return safeSyllables.map((syllable, index) => ({
            ...syllable,
            text: displaySegments[index]
        }));
    }

    function buildEvenlyTimedSyllables(segments, lineStart, lineEnd) {
        const tokens = (segments || []).map(text => String(text || '')).filter(text => text.length > 0);
        if (tokens.length === 0) return [];
        const safeStart = Number.isFinite(lineStart) ? lineStart : 0;
        const safeEnd = Number.isFinite(lineEnd) && lineEnd > safeStart ? lineEnd : safeStart + LINE_FALLBACK_DURATION_MS;
        const weights = tokens.map(token => Math.max(1, normalizeText(token).length || token.length));
        const totalWeight = weights.reduce((sum, value) => sum + value, 0) || tokens.length;
        let cursor = safeStart;
        return tokens.map((text, index) => {
            const remainingWeight = weights.slice(index).reduce((sum, value) => sum + value, 0) || weights[index];
            const isLast = index === tokens.length - 1;
            const segmentDuration = isLast ? (safeEnd - cursor) : Math.max(1, Math.round((safeEnd - cursor) * (weights[index] / remainingWeight)));
            const startTime = cursor;
            const endTime = isLast ? safeEnd : Math.min(safeEnd, startTime + segmentDuration);
            cursor = endTime;
            return { text, startTime, endTime: Math.max(startTime + 1, endTime) };
        });
    }

    function buildTimingBoundaryArray(syllables, lineStart, lineEnd) {
        const safeSyllables = Array.isArray(syllables) ? syllables.filter(Boolean) : [];
        const safeStart = Number.isFinite(lineStart)
            ? lineStart
            : (Number.isFinite(safeSyllables[0]?.startTime) ? safeSyllables[0].startTime : 0);
        const safeEnd = Number.isFinite(lineEnd) && lineEnd > safeStart
            ? lineEnd
            : (Number.isFinite(safeSyllables[safeSyllables.length - 1]?.endTime)
                ? Math.max(safeStart + 1, safeSyllables[safeSyllables.length - 1].endTime)
                : safeStart + LINE_FALLBACK_DURATION_MS);
        if (safeSyllables.length === 0) return [safeStart, safeEnd];
        const boundaries = [safeStart];
        for (let index = 1; index < safeSyllables.length; index += 1) {
            const boundary = Number.isFinite(safeSyllables[index]?.startTime)
                ? safeSyllables[index].startTime
                : boundaries[boundaries.length - 1];
            boundaries.push(Math.max(boundaries[boundaries.length - 1], boundary));
        }
        boundaries.push(Math.max(boundaries[boundaries.length - 1] + 1, safeEnd));
        return boundaries;
    }

    function interpolateBoundaryTime(boundaries, position) {
        if (!Array.isArray(boundaries) || boundaries.length === 0) return 0;
        const maxPosition = boundaries.length - 1;
        const clamped = Math.max(0, Math.min(maxPosition, Number.isFinite(position) ? position : 0));
        const lower = Math.floor(clamped);
        const upper = Math.ceil(clamped);
        if (lower === upper) return Math.max(0, Math.round(boundaries[lower] || 0));
        const lowerTime = Number(boundaries[lower] || 0);
        const upperTime = Number(boundaries[upper] || lowerTime);
        const ratio = clamped - lower;
        return Math.max(0, Math.round(lowerTime + ((upperTime - lowerTime) * ratio)));
    }

    function normalizeTokenForAlignment(value) {
        return normalizeText(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    }

    function tokenizeTextForAlignment(text, preferWholeSegments = false) {
        const raw = normalizeText(text).toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim();
        if (!raw) return [];
        if (preferWholeSegments) {
            const token = normalizeTokenForAlignment(raw);
            return token ? [token] : [];
        }
        const wordTokens = raw.split(/\s+/).map(normalizeTokenForAlignment).filter(Boolean);
        if (wordTokens.length > 1) return wordTokens;
        const normalized = normalizeTokenForAlignment(raw);
        return normalized ? Array.from(normalized) : [];
    }

    function buildReferenceSegmentBoundaryAnchors(sourceSyllables, referenceSegments) {
        const sourceCount = Array.isArray(sourceSyllables) ? sourceSyllables.length : 0;
        const referenceCount = Array.isArray(referenceSegments) ? referenceSegments.length : 0;
        const sourceTokens = (sourceSyllables || [])
            .map((syllable, index) => ({ index, token: normalizeTokenForAlignment(syllable?.text || '') }))
            .filter(item => item.token);
        const referenceTokens = (referenceSegments || [])
            .map((text, index) => ({ index, token: normalizeTokenForAlignment(text) }))
            .filter(item => item.token);
        const anchors = [
            { refBoundary: 0, sourceBoundary: 0 },
            { refBoundary: referenceCount, sourceBoundary: sourceCount }
        ];
        if (sourceTokens.length === 0 || referenceTokens.length === 0) return anchors;

        const matches = computeLcsMatches(sourceTokens, referenceTokens);
        matches.forEach(([sourceMatchIndex, referenceMatchIndex]) => {
            const sourceIndex = sourceTokens[sourceMatchIndex].index;
            const referenceIndex = referenceTokens[referenceMatchIndex].index;
            anchors.push({ refBoundary: referenceIndex, sourceBoundary: sourceIndex });
            anchors.push({ refBoundary: referenceIndex + 1, sourceBoundary: sourceIndex + 1 });
        });

        const collapsed = [];
        anchors
            .sort((left, right) => left.refBoundary - right.refBoundary || left.sourceBoundary - right.sourceBoundary)
            .forEach(anchor => {
                const previous = collapsed[collapsed.length - 1];
                const safeSourceBoundary = Math.max(
                    previous ? previous.sourceBoundary : 0,
                    Math.min(sourceCount, Number(anchor.sourceBoundary) || 0)
                );
                if (previous && previous.refBoundary === anchor.refBoundary) {
                    previous.sourceBoundary = Math.max(previous.sourceBoundary, safeSourceBoundary);
                    return;
                }
                collapsed.push({
                    refBoundary: Math.max(0, Math.min(referenceCount, Number(anchor.refBoundary) || 0)),
                    sourceBoundary: safeSourceBoundary
                });
            });
        return collapsed;
    }

    function mapReferenceBoundaryToSourceBoundary(boundaryIndex, referenceCount, sourceCount, anchors) {
        const safeBoundary = Math.max(0, Math.min(referenceCount, Number(boundaryIndex) || 0));
        const safeAnchors = Array.isArray(anchors) && anchors.length > 0
            ? anchors
            : [{ refBoundary: 0, sourceBoundary: 0 }, { refBoundary: referenceCount, sourceBoundary: sourceCount }];
        let previous = safeAnchors[0];
        let next = safeAnchors[safeAnchors.length - 1];
        for (let index = 0; index < safeAnchors.length; index += 1) {
            const anchor = safeAnchors[index];
            if (anchor.refBoundary <= safeBoundary) previous = anchor;
            if (anchor.refBoundary >= safeBoundary) {
                next = anchor;
                break;
            }
        }
        if (!next || next.refBoundary === previous.refBoundary) return previous.sourceBoundary;
        const ratio = (safeBoundary - previous.refBoundary) / Math.max(1, next.refBoundary - previous.refBoundary);
        return previous.sourceBoundary + ((next.sourceBoundary - previous.sourceBoundary) * ratio);
    }

    function retextSyllablesFromReferenceText(referenceText, sourceSyllables, lineStart, lineEnd) {
        const referenceSegments = splitDisplaySegments(referenceText);
        if (referenceSegments.length === 0) return [];
        const safeSourceSyllables = finalizeSyllableGroup(
            (sourceSyllables || []).map(syllable => ({
                text: String(syllable?.text || ''),
                startTime: Number.isFinite(syllable?.startTime) ? syllable.startTime : lineStart,
                endTime: Number.isFinite(syllable?.endTime) ? syllable.endTime : lineEnd
            })).filter(syllable => Number.isFinite(syllable.startTime)),
            lineStart,
            null,
            lineEnd
        );
        if (safeSourceSyllables.length === 0) return buildEvenlyTimedSyllables(referenceSegments, lineStart, lineEnd);

        const boundaries = buildTimingBoundaryArray(safeSourceSyllables, lineStart, lineEnd);
        const anchors = buildReferenceSegmentBoundaryAnchors(safeSourceSyllables, referenceSegments);
        const sourceCount = safeSourceSyllables.length;
        const referenceCount = referenceSegments.length;
        const retexted = [];

        for (let index = 0; index < referenceSegments.length; index += 1) {
            const fallbackStart = (index / referenceCount) * sourceCount;
            const fallbackEnd = ((index + 1) / referenceCount) * sourceCount;
            const rawStartBoundary = mapReferenceBoundaryToSourceBoundary(index, referenceCount, sourceCount, anchors);
            const rawEndBoundary = mapReferenceBoundaryToSourceBoundary(index + 1, referenceCount, sourceCount, anchors);
            const startBoundary = Number.isFinite(rawStartBoundary) ? rawStartBoundary : fallbackStart;
            const endBoundary = Number.isFinite(rawEndBoundary) && rawEndBoundary > startBoundary
                ? rawEndBoundary
                : Math.max(startBoundary + 0.05, fallbackEnd);
            const startTime = interpolateBoundaryTime(boundaries, startBoundary);
            const endTime = interpolateBoundaryTime(boundaries, endBoundary);
            retexted.push({
                text: referenceSegments[index],
                startTime,
                endTime: Math.max(startTime + 1, endTime)
            });
        }

        return finalizeSyllableGroup(retexted, lineStart, null, lineEnd);
    }

    function parseSpotifyLineSyllables(line, lineStart, lineEnd) {
        const rawSyllables = Array.isArray(line?.syllables) ? line.syllables : [];
        if (rawSyllables.length === 0) return [];
        if (typeof rawSyllables[0] === 'string') {
            return buildEvenlyTimedSyllables(rawSyllables, lineStart, lineEnd);
        }
        const mapped = rawSyllables.map(item => ({
            text: String(item?.text ?? item?.words ?? item?.syllable ?? item?.label ?? ''),
            startTime: parseMs(item?.startTimeMs ?? item?.startTime ?? item?.startMs),
            endTime: parseMs(item?.endTimeMs ?? item?.endTime ?? item?.endMs)
        })).filter(item => item.text);
        if (mapped.length === 0) return [];
        if (mapped.every(item => Number.isFinite(item.startTime))) {
            return finalizeSyllableGroup(
                mapped.map(item => ({ text: item.text, startTime: item.startTime, endTime: item.endTime })),
                lineStart,
                lineEnd,
                lineEnd
            );
        }
        return buildEvenlyTimedSyllables(mapped.map(item => item.text), lineStart, lineEnd);
    }

    function buildSpotifyReferenceResult(info, reference, sourceId) {
        if (!reference) return null;
        const result = createEmptyResult(info);
        result.sourceId = sourceId;
        result.spotifySyncType = reference.syncType;
        result.spotifyLyricsProvider = reference.provider;
        result.spotifyLanguage = reference.language || '';
        if (reference.karaoke?.length) result.karaoke = deepCopy(reference.karaoke);
        if (reference.synced?.length) result.synced = deepCopy(reference.synced);
        if (reference.unsynced?.length) result.unsynced = deepCopy(reference.unsynced);
        return hasLyricsPayload(result)
            ? annotateResultPayload(result, {
                selectedSource: sourceId,
                spotifyAligned: sourceId?.startsWith('spotify') || false,
                alignmentMode: sourceId?.startsWith('spotify') ? 'native-spotify' : null,
                validationState: 'native'
            })
            : null;
    }

    async function fetchSpotifyReference(trackId, info) {
        if (!trackId || !Spicetify?.CosmosAsync) return null;
        try {
            const body = await getCachedSpotifyReference(
                trackId,
                () => Spicetify.CosmosAsync.get(
                    `https://spclient.wg.spotify.com/color-lyrics/v2/track/${trackId}?format=json&vocalRemoval=false&market=from_token`
                )
            );
            const lyrics = body?.lyrics;
            const rawLines = Array.isArray(lyrics?.lines) ? lyrics.lines : [];
            if (!lyrics || rawLines.length === 0) return null;
            const normalizedLines = rawLines.map((line, index) => {
                const startTime = parseMs(line?.startTimeMs) ?? parseMs(line?.startTime) ?? 0;
                const nextRaw = rawLines[index + 1];
                const nextStart = nextRaw ? (parseMs(nextRaw?.startTimeMs) ?? parseMs(nextRaw?.startTime)) : null;
                const endTime = parseMs(line?.endTimeMs) ?? parseMs(line?.endTime) ?? (nextStart ?? (startTime + LINE_FALLBACK_DURATION_MS));
                const text = normalizeText(line?.words || line?.text || '');
                const syllables = parseSpotifyLineSyllables(line, startTime, endTime);
                return {
                    startTime,
                    endTime: Math.max(startTime + 1, endTime),
                    text,
                    normalizedText: normalizeText(text).toLowerCase(),
                    syllables
                };
            }).filter(line => line.text);
            if (normalizedLines.length === 0) return null;
            const syncType = String(lyrics?.syncType || 'UNSYNCED');
            const karaoke = syncType === 'SYLLABLE_SYNCED'
                ? finalizeKaraokeLines(normalizedLines.map(line => ({
                    startTime: line.startTime,
                    endTime: line.endTime,
                    text: line.text,
                    syllables: line.syllables.length > 0 ? line.syllables : buildEvenlyTimedSyllables(splitDisplaySegments(line.text), line.startTime, line.endTime)
                })))
                : null;
            const synced = karaoke?.length
                ? buildSyncedFromKaraoke(karaoke)
                : (syncType === 'LINE_SYNCED'
                    ? normalizedLines.map(line => ({ startTime: line.startTime, endTime: line.endTime, text: line.text }))
                    : null);
            const unsynced = karaoke?.length
                ? buildUnsyncedFromTimedLines(buildSyncedFromKaraoke(karaoke))
                : (synced?.length ? buildUnsyncedFromTimedLines(synced) : buildUnsyncedFromPlainText(normalizedLines.map(line => line.text).join('\n')));
            return {
                provider: String(lyrics?.provider || 'spotify').trim() || 'spotify',
                providerDisplayName: String(lyrics?.providerDisplayName || lyrics?.provider || 'Spotify').trim() || 'Spotify',
                syncType,
                normalizedText: normalizeText(normalizedLines.map(line => line.text).join('\n')).toLowerCase(),
                lines: normalizedLines,
                karaoke,
                synced,
                unsynced,
                language: String(lyrics?.language || ''),
                isRtlLanguage: !!lyrics?.isRtlLanguage,
                nativeResult: buildSpotifyReferenceResult(info, {
                    karaoke,
                    synced,
                    unsynced,
                    syncType,
                    provider: String(lyrics?.provider || 'spotify'),
                    language: String(lyrics?.language || '')
                }, syncType === 'SYLLABLE_SYNCED'
                    ? SOURCE.SPOTIFY_SYLLABLE
                    : (syncType === 'LINE_SYNCED' ? SOURCE.SPOTIFY_LINE : 'spotify-official-fallback'))
            };
        } catch {
            return null;
        }
    }

    function parseLrcTimestampToMs(rawValue) {
        const raw = String(rawValue || '').trim();
        if (!raw) return null;
        const hms = raw.match(/^(\d+):(\d{2}):(\d{2})(?:[.:](\d{1,3}))?$/);
        if (hms) return ((+hms[1] * 3600) + (+hms[2] * 60) + +hms[3]) * 1000 + (hms[4] ? Math.round(Number(`0.${hms[4]}`) * 1000) : 0);
        const ms = raw.match(/^(\d+):(\d{2})(?:[.:](\d{1,3}))?$/);
        if (ms) return ((+ms[1] * 60) + +ms[2]) * 1000 + (ms[3] ? Math.round(Number(`0.${ms[3]}`) * 1000) : 0);
        return null;
    }

    function applyLrcFixers(karaoke) {
        for (const line of karaoke) {
            const parts = Array.isArray(line?.syllables) ? line.syllables : [];
            for (let i = 1; i < parts.length; i++) {
                const current = parts[i];
                const previous = parts[i - 1];
                const currentText = String(current?.text || '');
                const previousText = String(previous?.text || '');
                if (currentText === ' ' && previousText !== ' ') {
                    const currentDuration = Math.max(0, Number(current.endTime || 0) - Number(current.startTime || 0));
                    const previousDuration = Math.max(0, Number(previous.endTime || 0) - Number(previous.startTime || 0));
                    const delta = currentDuration - previousDuration;
                    if (Math.abs(delta) <= 15 || currentDuration <= 100) {
                        previous.endTime = Math.max(previous.startTime + 1, previous.endTime + currentDuration);
                        current.startTime = previous.endTime;
                        current.endTime = Math.max(current.startTime + 1, current.endTime);
                    }
                }
            }
        }

        let shortDurationCount = 0;
        let durationCount = 0;
        for (const line of karaoke) {
            const parts = Array.isArray(line?.syllables) ? line.syllables : [];
            for (let i = 0; i < parts.length - 2; i++) {
                const part = parts[i];
                const partText = String(part?.text || '');
                if (partText !== ' ') {
                    if ((Number(part.endTime || 0) - Number(part.startTime || 0)) <= 100) shortDurationCount++;
                    durationCount++;
                }
            }
        }

        if (durationCount > 0 && (shortDurationCount / durationCount) > 0.5) {
            for (let i = 0; i < karaoke.length; i++) {
                const line = karaoke[i];
                const parts = Array.isArray(line?.syllables) ? line.syllables : [];
                for (let j = 0; j < parts.length; j++) {
                    const part = parts[j];
                    const duration = Number(part.endTime || 0) - Number(part.startTime || 0);
                    if (String(part?.text || '') === ' ' || duration > 400) continue;
                    let nextPart = null;
                    if (j + 1 < parts.length) nextPart = parts[j + 1];
                    else if (i + 1 < karaoke.length && Array.isArray(karaoke[i + 1]?.syllables) && karaoke[i + 1].syllables.length > 0) nextPart = karaoke[i + 1].syllables[0];
                    if (!nextPart) {
                        part.endTime = part.startTime + 300;
                    } else if (String(nextPart?.text || '') === ' ') {
                        const nextDuration = Math.max(0, Number(nextPart.endTime || 0) - Number(nextPart.startTime || 0));
                        part.endTime = Math.max(part.startTime + 1, Number(part.endTime || 0) + nextDuration);
                        nextPart.startTime = part.endTime;
                        nextPart.endTime = Math.max(nextPart.startTime + 1, nextPart.endTime);
                    } else {
                        part.endTime = Math.max(part.startTime + 1, nextPart.startTime);
                    }
                }
            }
        }
    }

    // ── Sync Grafting ─────────────────────────────────────────────────────────
    // MXM richsync has good word boundaries but bad absolute timing.
    // Accurate line-sync sources (Spotify, bLyrics TTML, MXM synced) have
    // correct line timing.  Proportionally remap word timings onto the
    // accurate line window so relative word spacing is preserved while
    // absolute positions match the better source.

    function matchKaraokeToSyncedLines(karaokeLines, syncedLines) {
        if (!karaokeLines?.length || !syncedLines?.length) return null;
        const syncedTokens = syncedLines.map(line => normalizeTokenForAlignment(line.text || ''));
        const matched = [];
        let syncIdx = 0;
        for (const kLine of karaokeLines) {
            if (kLine.isInstrumental) {
                matched.push({ karaokeLine: kLine, syncedLine: null });
                continue;
            }
            const kToken = normalizeTokenForAlignment(kLine.text || kLine.originalText || '');
            if (!kToken) {
                matched.push({ karaokeLine: kLine, syncedLine: null });
                continue;
            }
            let bestIdx = -1;
            let bestScore = 0;
            const searchEnd = Math.min(syncedTokens.length, syncIdx + 5);
            for (let i = syncIdx; i < searchEnd; i++) {
                if (!syncedTokens[i]) continue;
                const score = similarity(kToken, syncedTokens[i]);
                if (score > bestScore) {
                    bestScore = score;
                    bestIdx = i;
                }
            }
            if (bestScore >= 0.7 && bestIdx >= 0) {
                matched.push({ karaokeLine: kLine, syncedLine: syncedLines[bestIdx] });
                syncIdx = bestIdx + 1;
            } else {
                matched.push({ karaokeLine: kLine, syncedLine: null });
            }
        }
        const matchedCount = matched.filter(m => m.syncedLine).length;
        return matchedCount >= karaokeLines.length * 0.4 ? matched : null;
    }

    function graftWordSyncOntoLineSync(mxmKaraoke, accurateLineSynced) {
        const pairs = matchKaraokeToSyncedLines(mxmKaraoke, accurateLineSynced);
        if (!pairs) return mxmKaraoke;

        return pairs.map(({ karaokeLine, syncedLine }) => {
            if (!syncedLine) return karaokeLine;

            const syllables = karaokeLine.syllables
                || karaokeLine.vocals?.lead?.syllables
                || [];
            if (syllables.length === 0) {
                return { ...karaokeLine, startTime: syncedLine.startTime, endTime: syncedLine.endTime };
            }

            const mxmStart = karaokeLine.startTime;
            const mxmEnd = karaokeLine.endTime;
            const mxmSpan = mxmEnd - mxmStart;
            if (mxmSpan <= 0) {
                return { ...karaokeLine, startTime: syncedLine.startTime, endTime: syncedLine.endTime };
            }

            const accStart = syncedLine.startTime;
            const accEnd = syncedLine.endTime;
            const accSpan = accEnd - accStart;

            const remap = (t) => Math.round(accStart + ((t - mxmStart) / mxmSpan) * accSpan);

            const remappedSyllables = syllables.map(syl => ({
                ...syl,
                startTime: remap(syl.startTime),
                endTime: Math.max(remap(syl.startTime) + 1, remap(syl.endTime))
            }));

            const result = { ...karaokeLine, startTime: accStart, endTime: accEnd };
            if (karaokeLine.syllables) {
                result.syllables = remappedSyllables;
            } else if (karaokeLine.vocals?.lead?.syllables) {
                result.vocals = {
                    ...karaokeLine.vocals,
                    lead: { ...karaokeLine.vocals.lead, syllables: remappedSyllables }
                };
            }
            return result;
        });
    }

    function parseLrc(rawText, songDurationMs = 0) {
        const raw = String(rawText || '');
        if (!raw.trim()) return null;
        const idTags = {};
        const plain = [];
        const timedLines = [];
        const timeTagRegex = /\[(\d+:\d+(?:\.\d+)?)\]/g;
        const enhancedWordRegex = /<(\d+:\d+(?:\.\d+)?)>/g;
        const possibleIdTags = new Set(['ti', 'ar', 'al', 'au', 'lr', 'length', 'by', 'offset', 're', 'tool', 've', '#']);

        for (const sourceLine of raw.replace(/\r/g, '').split('\n')) {
            const rawLine = String(sourceLine || '').trim();
            if (!rawLine) continue;
            const idTagMatch = rawLine.match(/^\[(\w+):(.*)\]$/);
            if (idTagMatch && possibleIdTags.has(idTagMatch[1])) {
                idTags[idTagMatch[1]] = idTagMatch[2];
                continue;
            }

            const timeTags = [];
            let match;
            while ((match = timeTagRegex.exec(rawLine)) !== null) {
                const parsed = parseLrcTimestampToMs(match[1]);
                if (Number.isFinite(parsed)) timeTags.push(parsed);
            }
            if (timeTags.length === 0) {
                const textOnly = normalizeText(rawLine.replace(/<[^>]+>/g, ''));
                if (textOnly) plain.push({ text: textOnly });
                continue;
            }

            const lyricPart = rawLine.replace(timeTagRegex, '').trim();
            const syllables = [];
            let lastTime = null;
            let plainText = '';
            lyricPart.split(enhancedWordRegex).forEach((fragment, index) => {
                if (index % 2 === 0) {
                    const value = String(fragment || '');
                    plainText += value;
                    if (syllables.length > 0 && Number.isFinite(syllables[syllables.length - 1].startTime)) {
                        syllables[syllables.length - 1].text += value;
                    }
                } else {
                    const startTime = parseLrcTimestampToMs(fragment);
                    if (!Number.isFinite(startTime)) return;
                    if (lastTime !== null && syllables.length > 0) syllables[syllables.length - 1].endTime = startTime;
                    syllables.push({ startTime, endTime: 0, text: '' });
                    lastTime = startTime;
                }
            });

            timedLines.push({
                startTime: Math.min(...timeTags),
                endTime: Math.max(...timeTags),
                text: normalizeText(plainText),
                syllables: syllables.length > 0 ? syllables : null
            });
        }

        timedLines.sort((a, b) => a.startTime - b.startTime);
        for (let i = 0; i < timedLines.length; i++) {
            const line = timedLines[i];
            const nextLine = timedLines[i + 1] || null;
            if (line.endTime === line.startTime) {
                line.endTime = nextLine ? Math.max(line.startTime + 1, nextLine.startTime) : Math.max(line.startTime + 1, songDurationMs || (line.startTime + LINE_FALLBACK_DURATION_MS));
            }
            if (Array.isArray(line.syllables) && line.syllables.length > 0) {
                const last = line.syllables[line.syllables.length - 1];
                if (!Number.isFinite(last.endTime) || last.endTime <= last.startTime) {
                    last.endTime = nextLine ? Math.max(last.startTime + 1, nextLine.startTime) : Math.max(last.startTime + 1, songDurationMs || line.endTime);
                }
            }
        }

        const offsetRaw = Number(idTags.offset);
        if (Number.isFinite(offsetRaw) && offsetRaw !== 0) {
            // LRC [offset:] is already expressed in milliseconds.
            const offsetMs = Math.round(offsetRaw);
            timedLines.forEach(line => {
                line.startTime -= offsetMs;
                line.endTime -= offsetMs;
                if (Array.isArray(line.syllables)) {
                    line.syllables.forEach(part => {
                        part.startTime -= offsetMs;
                        part.endTime -= offsetMs;
                    });
                }
            });
        }

        const karaoke = timedLines.filter(line => Array.isArray(line.syllables) && line.syllables.length > 0)
            .map(line => ({
                startTime: Math.max(0, Math.round(line.startTime)),
                endTime: Math.max(0, Math.round(line.endTime)),
                text: normalizeText(line.text),
                syllables: line.syllables.map(part => ({
                    text: String(part.text || ''),
                    startTime: Math.max(0, Math.round(part.startTime)),
                    endTime: Math.max(0, Math.round(part.endTime))
                }))
            }));

        if (karaoke.length > 0) {
            applyLrcFixers(karaoke);
            const finalKaraoke = finalizeKaraokeLines(karaoke);
            const syncedFromKaraoke = buildSyncedFromKaraoke(finalKaraoke);
            return { karaoke: finalKaraoke, synced: syncedFromKaraoke, unsynced: buildUnsyncedFromTimedLines(syncedFromKaraoke) };
        }

        if (timedLines.length > 0) {
            const sorted = timedLines.map(line => ({
                startTime: Math.max(0, Math.round(line.startTime)),
                endTime: Math.max(0, Math.round(line.endTime)),
                text: normalizeText(line.text)
            })).filter(line => line.text);
            return { karaoke: null, synced: sorted, unsynced: buildUnsyncedFromTimedLines(sorted) };
        }
        if (plain.length > 0) return { karaoke: null, synced: null, unsynced: plain };
        return null;
    }

    function parseTtmlTimeToMs(raw) {
        const str = String(raw || '').trim();
        if (!str) return null;
        const parts = str.split(':');
        if (parts.length >= 1 && parts.length <= 3 && /^\d+(?:\.\d+)?$/.test(parts[parts.length - 1])) {
            let seconds = 0;
            if (parts.length === 3) seconds = (+parts[0] * 3600) + (+parts[1] * 60) + parseFloat(parts[2]);
            else if (parts.length === 2) seconds = (+parts[0] * 60) + parseFloat(parts[1]);
            else seconds = parseFloat(parts[0]);
            if (Number.isFinite(seconds)) return Math.round(seconds * 1000);
        }
        const ms = str.match(/^(\d+(?:\.\d+)?)ms$/);
        if (ms) return Math.round(Number(ms[1]));
        const sec = str.match(/^(\d+(?:\.\d+)?)s$/);
        if (sec) return Math.round(Number(sec[1]) * 1000);
        return null;
    }

    function isMetaTtmlRole(role) {
        return role === 'x-bg' || role === 'x-translation' || role === 'x-transliteration';
    }

    function getNodeLocalName(node) {
        return String(node?.localName || node?.tagName || '').toLowerCase().replace(/^.*:/, '');
    }

    function getTtmlRole(element) {
        return String(element?.getAttribute?.('ttm:role') || element?.getAttribute?.('role') || '').trim();
    }

    function collectVisibleTtmlText(node) {
        if (!node) return '';
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        const element = node;
        const role = getTtmlRole(element);
        if (isMetaTtmlRole(role)) return '';
        if (getNodeLocalName(element) === 'br') return '\n';
        let text = '';
        for (const child of element.childNodes) text += collectVisibleTtmlText(child);
        return text;
    }

    function extractCleanTtmlText(node) {
        return normalizeText(collectVisibleTtmlText(node));
    }

    function getChildElementsByLocalName(root, name) {
        return Array.from(root?.children || []).filter(element => getNodeLocalName(element) === name);
    }

    function getDescendantsByLocalName(root, name) {
        return Array.from(root?.getElementsByTagName?.('*') || []).filter(element => getNodeLocalName(element) === name);
    }

    function getElementsIncludingRootByLocalName(root, name) {
        const elements = [];
        if (root && getNodeLocalName(root) === name) elements.push(root);
        return elements.concat(getDescendantsByLocalName(root, name));
    }

    function hasAncestorWithTtmlRole(element, boundary, role) {
        let current = element?.parentElement || null;
        while (current && current !== boundary) {
            if (getTtmlRole(current) === role) return true;
            current = current.parentElement;
        }
        return false;
    }

    function extractTtmlAgentMapping(doc) {
        const mapping = new Map();
        let voiceIndex = 0;
        getDescendantsByLocalName(doc, 'agent').forEach(agentElement => {
            const originalId = agentElement.getAttribute('xml:id') || agentElement.getAttribute('id') || '';
            const agentType = agentElement.getAttribute('type') || agentElement.getAttribute('ttm:type') || '';
            if (!originalId) return;
            if (agentType === 'person' || agentType === 'character') {
                voiceIndex += 1;
                mapping.set(originalId, `v${voiceIndex}`);
                return;
            }
            mapping.set(originalId, 'v1000');
        });
        return mapping;
    }

    function extractTtmlTranslationMap(doc) {
        const translations = new Map();
        getDescendantsByLocalName(doc, 'translation').forEach(item => {
            const key = item.getAttribute('for') || '';
            if (!key) return;
            let parent = item.parentElement;
            while (parent && getNodeLocalName(parent) !== 'translations') parent = parent.parentElement;
            const lang = String(parent?.getAttribute?.('lang') || parent?.getAttribute?.('xml:lang') || '').trim();
            const text = normalizeText(item.textContent || '');
            if (text) translations.set(key, { text, lang });
        });
        return translations;
    }

    function extractTtmlTransliterationMap(doc) {
        const transliterations = new Map();
        getDescendantsByLocalName(doc, 'transliteration').forEach(item => {
            const key = item.getAttribute('for') || '';
            if (!key) return;
            const textContainer = getDescendantsByLocalName(item, 'text')[0] || item;
            const text = extractCleanTtmlText(textContainer);
            if (text) transliterations.set(key, text);
        });
        return transliterations;
    }

    function normalizeTtmlTextFragment(value) {
        const raw = String(value || '').replace(/\r/g, '');
        if (!raw) return '';
        const compact = raw.replace(/[\n\t]+/g, ' ');
        if (!compact.trim()) return compact.includes(' ') ? ' ' : '';
        return compact.replace(/\s+/g, ' ');
    }

    function getLastTtmlSegmentEndTime(segments, fallbackStart) {
        if (!Array.isArray(segments) || segments.length === 0) {
            return Number.isFinite(fallbackStart) ? fallbackStart : 0;
        }
        const last = segments[segments.length - 1];
        const lastStart = Number.isFinite(last?.startTime) ? last.startTime : (Number.isFinite(fallbackStart) ? fallbackStart : 0);
        const lastEnd = Number.isFinite(last?.endTime) ? last.endTime : lastStart;
        return Math.max(lastStart, lastEnd);
    }

    function pushTtmlTextSegment(segments, rawText, lineStart, isBackground = false) {
        const text = normalizeTtmlTextFragment(rawText);
        if (!text) return;
        const startTime = getLastTtmlSegmentEndTime(segments, lineStart);
        segments.push({
            text,
            startTime,
            endTime: startTime + 1,
            isBackground
        });
    }

    function extractTtmlTimedSyllables(root, lineStart, lineEnd, includeBackground = false) {
        const orderedSegments = [];
        let hasTimedSegment = false;

        const visitNode = (node, inheritedBackground = false) => {
            if (!node) return;
            if (node.nodeType === Node.TEXT_NODE) {
                pushTtmlTextSegment(orderedSegments, node.nodeValue || '', lineStart, inheritedBackground);
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;

            const element = node;
            const role = getTtmlRole(element);
            if (isMetaTtmlRole(role)) return;

            const isBackground = inheritedBackground || role === 'x-bg';
            if (!includeBackground && isBackground) return;

            if (getNodeLocalName(element) === 'br') {
                pushTtmlTextSegment(orderedSegments, ' ', lineStart, isBackground);
                return;
            }

            const startTime = parseTtmlTimeToMs(element.getAttribute('begin'));
            if (getNodeLocalName(element) === 'span' && Number.isFinite(startTime)) {
                const text = extractCleanTtmlText(element);
                if (!text) return;
                const explicitEnd = parseTtmlTimeToMs(element.getAttribute('end'));
                orderedSegments.push({
                    text,
                    startTime,
                    endTime: Math.max(startTime + 1, Number.isFinite(explicitEnd) ? explicitEnd : startTime + 1),
                    isBackground
                });
                hasTimedSegment = true;
                return;
            }

            Array.from(element.childNodes || []).forEach(child => visitNode(child, isBackground));
        };

        Array.from(root?.childNodes || []).forEach(child => visitNode(child, false));

        if (hasTimedSegment && orderedSegments.length > 0) {
            return finalizeSyllableGroup(orderedSegments, lineStart, null, lineEnd);
        }
        if (includeBackground) {
            const text = extractCleanTtmlText(root);
            if (text) return buildEvenlyTimedSyllables(splitDisplaySegments(text), lineStart, lineEnd);
        }
        return [];
    }

    function extractTtmlBackgroundGroups(lineElement, lineStart, lineEnd, agentMapping) {
        return getDescendantsByLocalName(lineElement, 'span')
            .filter(span => getTtmlRole(span) === 'x-bg' && !hasAncestorWithTtmlRole(span, lineElement, 'x-bg'))
            .map((groupElement, index) => {
                const rawAgent = groupElement.getAttribute('agent')
                    || lineElement.getAttribute('agent')
                    || lineElement.parentElement?.getAttribute('agent')
                    || '';
                const syllables = extractTtmlTimedSyllables(groupElement, lineStart, lineEnd, true);
                const text = extractCleanTtmlText(groupElement);
                return {
                    agent: rawAgent ? (agentMapping.get(rawAgent) || rawAgent) : `bg${index + 1}`,
                    text,
                    syllables
                };
            })
            .filter(group => group.syllables.length > 0 || group.text);
    }

    function insertTtmlInstrumentalBreaks(lines, songDurationMs = 0) {
        const sorted = (lines || []).slice().sort((a, b) => a.startTime - b.startTime);
        if (sorted.length === 0) return sorted;
        const result = [];
        const createInstrumental = (startTime, endTime) => ({
            startTime,
            endTime,
            text: INSTRUMENTAL_NOTE_TEXT,
            mainText: INSTRUMENTAL_NOTE_TEXT,
            displayText: INSTRUMENTAL_NOTE_TEXT,
            isInstrumental: true
        });
        if (sorted[0].startTime > BLYRICS_INSTRUMENTAL_GAP_MS) {
            result.push(createInstrumental(0, sorted[0].startTime));
        }
        for (let index = 0; index < sorted.length; index += 1) {
            const current = sorted[index];
            result.push(current);
            const next = sorted[index + 1] || null;
            if (!next) continue;
            const gap = Math.max(0, next.startTime - current.endTime);
            if (gap > BLYRICS_INSTRUMENTAL_GAP_MS) {
                result.push(createInstrumental(current.endTime, next.startTime));
            }
        }
        const last = sorted[sorted.length - 1];
        if (songDurationMs > 0) {
            const outroGap = Math.max(0, songDurationMs - last.endTime);
            if (outroGap > BLYRICS_INSTRUMENTAL_GAP_MS) {
                result.push(createInstrumental(last.endTime, songDurationMs));
            }
        }
        return result;
    }

    function parseTtml(rawXml) {
        if (!rawXml || typeof rawXml !== 'string') return null;
        let doc;
        try { doc = new DOMParser().parseFromString(rawXml, 'text/xml'); } catch { return null; }
        if (doc.querySelector('parsererror')) return null;
        const pElements = getDescendantsByLocalName(doc, 'p');
        if (pElements.length === 0) return null;
        const bodyElement = getDescendantsByLocalName(doc, 'body')[0] || null;
        const songDurationMs = parseTtmlTimeToMs(bodyElement?.getAttribute?.('dur') || doc.documentElement?.getAttribute?.('dur'));
        const agentMapping = extractTtmlAgentMapping(doc);
        const translations = extractTtmlTranslationMap(doc);
        const transliterations = extractTtmlTransliterationMap(doc);
        const timedLines = [];

        pElements.forEach((p, index) => {
            if (isMetaTtmlRole(getTtmlRole(p))) return;
            const parentDiv = p.closest?.('div') || null;
            const startTime = parseTtmlTimeToMs(p.getAttribute('begin') || parentDiv?.getAttribute('begin'));
            const endTime = parseTtmlTimeToMs(p.getAttribute('end') || parentDiv?.getAttribute('end'))
                || (Number.isFinite(startTime) ? startTime + LINE_FALLBACK_DURATION_MS : 0);
            if (!Number.isFinite(startTime)) return;
            const rawText = extractCleanTtmlText(p);
            if (!rawText) return;
            const key = p.getAttribute('key') || parentDiv?.getAttribute('key') || String(index);
            const transliterationText = transliterations.get(key) || '';
            const translationMeta = translations.get(key) || null;
            const leadSyllables = extractTtmlTimedSyllables(p, startTime, endTime, false);
            const backgroundGroups = extractTtmlBackgroundGroups(p, startTime, endTime, agentMapping);
            const rawAgent = p.getAttribute('agent') || parentDiv?.getAttribute('agent') || '';
            const originalText = transliterationText && normalizeText(transliterationText) !== normalizeText(rawText) ? rawText : undefined;
            timedLines.push({
                key,
                startTime,
                endTime: Math.max(startTime + 1, endTime),
                mainText: rawText,
                displayText: transliterationText || rawText,
                originalText,
                text2: translationMeta?.text || undefined,
                translation: translationMeta?.text || undefined,
                translationText: translationMeta?.text || undefined,
                translationLang: translationMeta?.lang || undefined,
                romanizationText: transliterationText || undefined,
                leadSyllables,
                backgroundGroups,
                agent: rawAgent ? (agentMapping.get(rawAgent) || rawAgent) : undefined,
                isTimed: leadSyllables.length > 0 || backgroundGroups.some(group => group.syllables.length > 0)
            });
        });

        if (timedLines.length === 0) return null;
        const normalizedLines = insertTtmlInstrumentalBreaks(timedLines, songDurationMs || 0);
        const hasWordSync = normalizedLines.some(line => line.isTimed);

        if (hasWordSync) {
            const karaoke = normalizedLines.map(line => {
            const baseLine = {
                startTime: line.startTime,
                endTime: line.endTime,
                text: line.displayText || line.text,
                isInstrumental: !!line.isInstrumental,
                originalText: line.originalText || (line.displayText && line.mainText && normalizeText(line.displayText) !== normalizeText(line.mainText) ? line.mainText : undefined),
                text2: line.text2,
                translation: line.translation,
                translationText: line.translationText,
                translationLang: line.translationLang
                };
                if (line.isInstrumental) return baseLine;
                if (line.backgroundGroups.length > 0) {
                    return {
                        ...baseLine,
                        vocals: {
                            lead: {
                                agent: line.agent,
                                syllables: line.leadSyllables.slice()
                            },
                            background: line.backgroundGroups.map(group => ({
                                agent: group.agent,
                                text: group.text,
                                syllables: group.syllables.slice()
                            }))
                        }
                    };
                }
                if (line.leadSyllables.length > 0) {
                    return {
                        ...baseLine,
                        syllables: line.leadSyllables.slice()
                    };
                }
                return baseLine;
            });
            const finalKaraoke = finalizeKaraokeLines(karaoke);
            const syncedFromKaraoke = buildSyncedFromKaraoke(finalKaraoke);
            return { karaoke: finalKaraoke, synced: syncedFromKaraoke, unsynced: buildUnsyncedFromTimedLines(syncedFromKaraoke) };
        }

        const synced = normalizedLines
            .map(line => ({
                startTime: line.startTime,
                endTime: line.endTime,
                text: line.displayText || line.text,
                isInstrumental: !!line.isInstrumental,
                originalText: line.originalText || (line.displayText && line.mainText && normalizeText(line.displayText) !== normalizeText(line.mainText) ? line.mainText : undefined),
                text2: line.text2,
                translation: line.translation,
                translationText: line.translationText,
                translationLang: line.translationLang
            }))
            .filter(line => normalizeText(line.text || line.originalText || ''));
        return synced.length > 0
            ? { karaoke: null, synced, unsynced: buildUnsyncedFromTimedLines(synced) }
            : null;
    }

    function buildResultFromMode(info, sourceId, parsed, mode) {
        if (!parsed) return null;
        const result = createEmptyResult(info);
        result.sourceId = sourceId;
        if (mode === 'richsynced') {
            result.karaoke = deepCopy(parsed.karaoke);
            result.synced = deepCopy(parsed.synced) || (result.karaoke ? buildSyncedFromKaraoke(result.karaoke) : null);
            result.unsynced = deepCopy(parsed.unsynced) || (result.synced ? buildUnsyncedFromTimedLines(result.synced) : null);
        } else if (mode === 'synced') {
            result.synced = deepCopy(parsed.synced) || (parsed.karaoke ? buildSyncedFromKaraoke(parsed.karaoke) : null);
            result.unsynced = deepCopy(parsed.unsynced) || (result.synced ? buildUnsyncedFromTimedLines(result.synced) : null);
        } else {
            result.unsynced = deepCopy(parsed.unsynced) || buildUnsyncedFromPlainText('');
        }
        return hasLyricsPayload(result)
            ? annotateResultPayload(result, { selectedSource: sourceId })
            : null;
    }

    function buildPlainResult(info, sourceId, rawText) {
        const result = createEmptyResult(info);
        result.sourceId = sourceId;
        result.unsynced = buildUnsyncedFromPlainText(rawText);
        return hasLyricsPayload(result)
            ? annotateResultPayload(result, { selectedSource: sourceId })
            : null;
    }

    function buildInstrumentalResult(info, sourceId = 'cubey-instrumental') {
        const result = createEmptyResult(info);
        const text = INSTRUMENTAL_NOTE_TEXT;
        result.sourceId = sourceId;
        result.synced = [{ startTime: 0, text, isInstrumental: true }];
        result.unsynced = [{ text, isInstrumental: true }];
        return result;
    }

    const HelperTransport = {
        async checkHealth(helperUrl) {
            try {
                const resp = await requestJson(`${helperUrl}/health`, { timeoutMs: 3000 });
                return resp.ok && resp.data?.ok === true;
            } catch {
                return false;
            }
        },
        async startAuth(helperUrl, cubeyBaseUrl) {
            const resp = await requestJson(`${helperUrl}/cubey/auth/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ baseUrl: cubeyBaseUrl }),
                timeoutMs: 20000
            });
            if (!resp.ok || !resp.data?.success) {
                return {
                    success: false,
                    error: resp.data?.error || resp.error?.message || 'Helper auth start failed',
                    upstreamStatus: Number(resp.data?.upstreamStatus || 0)
                };
            }
            return { success: true, authId: resp.data.authId || '', state: resp.data.state || 'pending' };
        },
        async getAuthStatus(helperUrl, authId) {
            const resp = await requestJson(`${helperUrl}/cubey/auth/status?authId=${encodeURIComponent(authId)}`, { timeoutMs: 15000 });
            return {
                ok: !!(resp.ok && resp.data),
                status: resp.status || 0,
                data: resp.data || null,
                error: resp.error?.message || null
            };
        },
        async fetchLyrics(helperUrl, sessionId, song, artist, album, durationSeconds, trackId) {
            const params = new URLSearchParams();
            params.set('sessionId', sessionId);
            params.set('song', song);
            params.set('artist', artist);
            if (album) params.set('album', album);
            if (durationSeconds > 0) params.set('duration', String(durationSeconds));
            if (trackId) params.set('videoId', trackId);
            const resp = await requestJson(`${helperUrl}/cubey/lyrics?${params.toString()}`, { timeoutMs: 15000 });
            if (resp.error || resp.status === 0) return { reauth: false, data: null, offline: true, error: resp.error?.message || 'Helper request failed' };
            if (resp.status === 401 && resp.data?.reauthRequired) return { reauth: true, data: null };
            if (!resp.ok || !resp.data?.success) {
                return {
                    reauth: false,
                    data: null,
                    offline: false,
                    error: resp.data?.error || `HTTP ${resp.status}`,
                    upstreamStatus: Number(resp.data?.upstreamStatus || 0)
                };
            }
            return { reauth: false, data: resp.data.data, offline: false };
        },
        async fetchProxyJson(helperUrl, endpoint, query, timeoutMs) {
            const params = new URLSearchParams();
            Object.entries(query || {}).forEach(([key, value]) => {
                const normalized = String(value ?? '').trim();
                if (!normalized) return;
                params.set(key, normalized);
            });
            const resp = await requestJson(`${helperUrl}${endpoint}?${params.toString()}`, { timeoutMs });
            if (!resp.ok || !resp.data?.success) {
                return {
                    ok: false,
                    status: resp.status || 0,
                    error: resp.data?.error || resp.error?.message || 'Helper proxy request failed',
                    data: null,
                    upstreamStatus: Number(resp.data?.upstreamStatus || 0),
                    upstreamBodyExcerpt: resp.data?.upstreamBodyExcerpt || ''
                };
            }
            return {
                ok: true,
                status: resp.status || 200,
                data: resp.data.data ?? null,
                notFound: !!resp.data?.notFound,
                notAvailable: !!resp.data?.notAvailable
            };
        }
    };

    async function refreshHelperHealth(helperUrl, force = false) {
        const normalizedUrl = normalizeBaseUrl(helperUrl) || HELPER_BASE;
        const now = Date.now();
        const shouldCheck = force || RuntimeState.helperConnected === null || RuntimeState.helperLastUrl !== normalizedUrl || (now - RuntimeState.helperLastHealthCheck) >= HELPER_HEALTH_CACHE_MS;
        if (!shouldCheck) return RuntimeState.helperConnected === true;
        RuntimeState.helperConnected = await HelperTransport.checkHealth(normalizedUrl);
        RuntimeState.helperLastHealthCheck = now;
        RuntimeState.helperLastUrl = normalizedUrl;
        return RuntimeState.helperConnected === true;
    }

    function triggerHelperProtocolLaunch(protocolUrl = HELPER_LAUNCH_PROTOCOL) {
        const target = String(protocolUrl || '').trim() || HELPER_LAUNCH_PROTOCOL;
        if (!document.body) return false;
        try {
            const anchor = document.createElement('a');
            anchor.href = target;
            anchor.style.display = 'none';
            anchor.rel = 'noopener noreferrer';
            document.body.appendChild(anchor);
            anchor.click();
            setTimeout(() => anchor.remove(), 0);
            return true;
        } catch {
            try {
                window.location.assign(target);
                return true;
            } catch {
                return false;
            }
        }
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function ensureHelperRunning(settings, force = false) {
        const helperUrl = settings?.helperUrl || HELPER_BASE;
        if (await refreshHelperHealth(helperUrl, force)) return true;
        if (!settings?.helperAutoLaunch || !isLocalHelperUrl(helperUrl)) return false;
        const now = Date.now();
        if (!force && RuntimeState.helperLaunchPromise) return await RuntimeState.helperLaunchPromise;
        if (!force && (now - RuntimeState.helperLaunchAt) < HELPER_LAUNCH_COOLDOWN_MS) return false;
        RuntimeState.helperLaunchAt = now;
        RuntimeState.helperLaunchPromise = (async () => {
            if (!triggerHelperProtocolLaunch()) return false;
            const attempts = Math.max(1, Math.ceil(HELPER_LAUNCH_WAIT_MS / HELPER_LAUNCH_POLL_MS));
            for (let i = 0; i < attempts; i++) {
                await sleep(HELPER_LAUNCH_POLL_MS);
                if (await refreshHelperHealth(helperUrl, true)) return true;
            }
            return false;
        })().finally(() => { RuntimeState.helperLaunchPromise = null; });
        return await RuntimeState.helperLaunchPromise;
    }

    async function ensureHelperSession(settings) {
        if (RuntimeState.helperAuthPromise) {
            return await RuntimeState.helperAuthPromise;
        }
        if (RuntimeState.helperSessionId && (!RuntimeState.helperSessionExp || RuntimeState.helperSessionExp - Date.now() > JWT_REFRESH_MARGIN_MS)) {
            return { success: true, sessionId: RuntimeState.helperSessionId, expiresAt: RuntimeState.helperSessionExp };
        }

        RuntimeState.helperAuthPromise = (async () => {
            const started = await HelperTransport.startAuth(settings.helperUrl, settings.cubeyBaseUrl);
            if (!started?.success || !started.authId) {
                rememberFailure('helper-auth', { reason: 'auth_failed', message: started?.error || 'Helper auth start failed', upstreamStatus: started?.upstreamStatus || 0 });
                return { success: false, error: started?.error || 'Helper auth start failed' };
            }

            const deadline = Date.now() + HELPER_AUTH_TIMEOUT_MS;
            while (Date.now() < deadline) {
                await sleep(HELPER_AUTH_POLL_MS);
                const status = await HelperTransport.getAuthStatus(settings.helperUrl, started.authId);
                if (!status.ok) {
                    rememberFailure('helper-auth', { reason: 'auth_failed', message: status.error || 'Helper auth status failed' });
                    return { success: false, error: status.error || 'Helper auth status failed' };
                }
                if (status.data?.state === 'ready' && status.data?.sessionId) {
                    RuntimeState.helperSessionId = status.data.sessionId;
                    RuntimeState.helperSessionExp = Number(status.data.expiresAt) || 0;
                    clearFailure();
                    return { success: true, sessionId: RuntimeState.helperSessionId, expiresAt: RuntimeState.helperSessionExp };
                }
                if (status.data?.state === 'error') {
                    rememberFailure('helper-auth', {
                        reason: 'auth_failed',
                        message: status.data?.error || 'Helper auth failed',
                        upstreamStatus: Number(status.data?.upstreamStatus || 0)
                    });
                    return { success: false, error: status.data?.error || 'Helper auth failed' };
                }
            }

            rememberFailure('helper-auth', { reason: 'auth_failed', message: 'Helper auth timed out' });
            return { success: false, error: 'Helper auth timed out' };
        })().finally(() => {
            RuntimeState.helperAuthPromise = null;
        });
        return await RuntimeState.helperAuthPromise;
    }

    const CubeyAuth = (() => {
        const inflightByBaseUrl = new Map();
        const keyFor = baseUrl => `${STORAGE_PREFIX}cubey-jwt:${encodeURIComponent(baseUrl)}`;
        const decodeJwtExpMs = token => {
            try {
                const parts = String(token || '').split('.');
                if (parts.length < 2) return 0;
                const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                const padded = payloadBase64.padEnd(Math.ceil(payloadBase64.length / 4) * 4, '=');
                const payload = JSON.parse(atob(padded));
                return Number.isFinite(payload?.exp) ? Math.round(payload.exp * 1000) : 0;
            } catch {
                return 0;
            }
        };
        const readStored = baseUrl => {
            try {
                const raw = readStorage(keyFor(baseUrl));
                return raw ? JSON.parse(raw) : null;
            } catch {
                return null;
            }
        };
        const writeStored = (baseUrl, token, expMs) => writeStorage(keyFor(baseUrl), JSON.stringify({ token, expMs, issuedAt: Date.now() }));
        const clear = baseUrlRaw => {
            const baseUrl = normalizeBaseUrl(baseUrlRaw);
            if (!baseUrl) return;
            try { localStorage.removeItem(keyFor(baseUrl)); } catch {}
            inflightByBaseUrl.delete(baseUrl);
        };
        async function requestTurnstileToken(baseUrl, timeoutMs) {
            return await new Promise((resolve, reject) => {
                const iframe = document.createElement('iframe');
                const expectedOrigin = (() => { try { return new URL(baseUrl).origin; } catch { return ''; } })();
                let settled = false;
                const timer = setTimeout(() => finish({ error: 'turnstile_timeout' }), timeoutMs);
                const cleanup = () => {
                    clearTimeout(timer);
                    window.removeEventListener('message', onMessage);
                    iframe.remove();
                };
                const finish = ({ token, error }) => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    if (token) resolve(token);
                    else reject(new Error(error || 'turnstile_failed'));
                };
                const onMessage = event => {
                    if (event.source !== iframe.contentWindow) return;
                    if (expectedOrigin && event.origin !== expectedOrigin) return;
                    const payload = event.data || {};
                    if (payload.type === 'turnstile-token' && payload.token) finish({ token: payload.token });
                    else if (payload.type === 'turnstile-expired') iframe.contentWindow?.postMessage({ type: 'reset-turnstile' }, '*');
                    else if (payload.type === 'turnstile-error') finish({ error: payload.error || 'turnstile_error' });
                    else if (payload.type === 'turnstile-timeout') finish({ error: 'turnstile_timeout' });
                };
                iframe.src = `${baseUrl}/challenge`;
                iframe.style.cssText = 'position:fixed;bottom:20px;right:20px;width:0;height:0;border:none;';
                iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
                iframe.addEventListener('error', () => finish({ error: 'turnstile_iframe_error' }));
                window.addEventListener('message', onMessage);
                document.body.appendChild(iframe);
            });
        }
        async function verifyTurnstileToken(baseUrl, turnstileToken, timeoutMs) {
            const endpoint = `${baseUrl}/verify-turnstile`;
            const response = await requestJson(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ token: turnstileToken }),
                timeoutMs
            });
            if (response.error && isProbablyCorsFetchError(response.error)) {
                rememberFailure('verify-turnstile', { reason: 'cors_blocked', endpoint });
                return null;
            }
            if (!response.ok || !response.data) {
                rememberFailure('verify-turnstile', { reason: 'http_error', status: response.status });
                return null;
            }
            clearFailure();
            return String(response.data.jwt || response.data.token || response.data?.data?.jwt || response.data?.data?.token || '').trim() || null;
        }
        async function fetchNewJwt(baseUrl, timeoutMs) {
            const turnstileToken = await requestTurnstileToken(baseUrl, TURNSTILE_TIMEOUT_MS);
            const jwt = await verifyTurnstileToken(baseUrl, turnstileToken, timeoutMs);
            if (!jwt) return null;
            const expMs = decodeJwtExpMs(jwt);
            if (expMs > 0) writeStored(baseUrl, jwt, expMs);
            return jwt;
        }
        return {
            clear,
            async getToken({ baseUrl, manualToken, autoAuth, forceNew, timeoutMs }) {
                const normalized = normalizeBaseUrl(baseUrl);
                const manual = String(manualToken || '').trim();
                if (manual && !forceNew) return manual;
                if (!normalized) return null;
                if (!autoAuth) return manual || null;
                if (!forceNew) {
                    const cached = readStored(normalized);
                    if (cached?.token && Number.isFinite(cached?.expMs) && (cached.expMs - Date.now()) > JWT_REFRESH_MARGIN_MS) return cached.token;
                } else {
                    clear(normalized);
                }
                const existing = inflightByBaseUrl.get(normalized);
                if (existing) return await existing;
                const inflight = fetchNewJwt(normalized, timeoutMs).catch(() => null).finally(() => inflightByBaseUrl.delete(normalized));
                inflightByBaseUrl.set(normalized, inflight);
                return await inflight;
            },
            requestTurnstileToken
        };
    })();

    async function fetchViaHelper(info) {
        const settings = getRuntimeSettings();
        if (!(await ensureHelperRunning(settings))) {
            rememberFailure('helper', { reason: 'helper_offline' });
            return null;
        }
        const title = normalizeText(info?.title);
        const artist = normalizeText(info?.artist);
        const album = normalizeText(info?.album);
        if (!title || !artist) return null;
        const trackId = info?.uri?.split(':')?.[2] || '';
        const durationValue = Number(info?.duration);
        const durationSeconds = Number.isFinite(durationValue) && durationValue > 0 ? (durationValue > 1000 ? Math.round(durationValue / 1000) : Math.round(durationValue)) : 0;
        const helperSession = await ensureHelperSession(settings);
        if (!helperSession?.success) return null;
        let response = await HelperTransport.fetchLyrics(settings.helperUrl, RuntimeState.helperSessionId, title, artist, album, durationSeconds, trackId);
        if (response.offline) {
            rememberFailure('helper', { reason: 'helper_offline' });
            return null;
        }
        if (response.reauth) {
            RuntimeState.helperSessionId = null;
            RuntimeState.helperSessionExp = 0;
            const refreshed = await ensureHelperSession(settings);
            if (!refreshed?.success) return null;
            response = await HelperTransport.fetchLyrics(settings.helperUrl, RuntimeState.helperSessionId, title, artist, album, durationSeconds, trackId);
        }
        if (!response.data) {
            rememberFailure('lyrics', { reason: 'http_error', message: response.error || 'No data', upstreamStatus: response.upstreamStatus || 0 });
            return null;
        }
        clearFailure();
        return response.data;
    }

    async function fetchViaDirect(info) {
        const settings = getRuntimeSettings();
        if (!settings.cubeyBaseUrl) return null;
        const title = normalizeText(info?.title);
        const artist = normalizeText(info?.artist);
        const album = normalizeText(info?.album);
        const trackId = getTrackId(info);
        if (!title || !artist) return null;
        const cubeyUrl = new URL(`${settings.cubeyBaseUrl}/lyrics`);
        cubeyUrl.searchParams.set('song', title);
        cubeyUrl.searchParams.set('artist', artist);
        cubeyUrl.searchParams.set('alwaysFetchMetadata', 'true');
        const durationValue = Number(info?.duration);
        if (Number.isFinite(durationValue) && durationValue > 0) cubeyUrl.searchParams.set('duration', String(durationValue > 1000 ? Math.round(durationValue / 1000) : Math.round(durationValue)));
        if (album) cubeyUrl.searchParams.set('album', album);
        if (trackId) cubeyUrl.searchParams.set('videoId', trackId);
        const fetchWithToken = async forceNew => {
            const token = await CubeyAuth.getToken({
                baseUrl: settings.cubeyBaseUrl,
                manualToken: settings.cubeyManualToken,
                autoAuth: settings.cubeyAutoAuth,
                forceNew,
                timeoutMs: settings.requestTimeoutMs
            });
            if (!token) {
                rememberFailure('lyrics-auth', { reason: 'auth_unavailable' });
                return { ok: false, status: 0, data: null, error: new Error('cubey_auth_unavailable') };
            }
            return await requestJson(cubeyUrl.toString(), {
                headers: { Authorization: `Bearer ${token}` },
                credentials: 'include',
                timeoutMs: settings.requestTimeoutMs
            });
        };
        let response = await fetchWithToken(false);
        if ((response.status === 401 || response.status === 403) && settings.cubeyAutoAuth) {
            CubeyAuth.clear(settings.cubeyBaseUrl);
            response = await fetchWithToken(true);
        }
        if (response.error && isProbablyCorsFetchError(response.error)) {
            rememberFailure('lyrics', { reason: 'cors_blocked', endpoint: cubeyUrl.toString() });
            return null;
        }
        if (!response.ok || !response.data || typeof response.data !== 'object') {
            rememberFailure('lyrics', { reason: 'http_error', status: response.status, message: response.status ? `HTTP ${response.status}` : 'Request failed' });
            return null;
        }
        clearFailure();
        return response.data;
    }

    async function fetchCubeyLyrics(info) {
        const settings = getRuntimeSettings();
        if (!settings.enableCubey || !settings.cubeyBaseUrl) return null;
        clearFailure();
        if (settings.transportMode === TRANSPORT.HELPER) return await fetchViaHelper(info);
        if (settings.transportMode === TRANSPORT.MANUAL && !settings.cubeyManualToken) {
            rememberFailure('manual', { reason: 'auth_unavailable', message: 'No manual token set' });
            return null;
        }
        return await fetchViaDirect(info);
    }

    function readSourceCache() {
        return undefined;
    }

    function writeSourceCache() {
        return undefined;
    }

    function newSourceMap() {
        return {
            [SOURCE.BLYRICS_RICHSYNCED]: { filled: false, lyricSourceResult: null, filler: fillFromBLyrics },
            [SOURCE.MUSIXMATCH_RICHSYNC]: { filled: false, lyricSourceResult: null, filler: fillFromCubey },
            [SOURCE.BLYRICS_SYNCED]: { filled: false, lyricSourceResult: null, filler: fillFromBLyrics },
            [SOURCE.MUSIXMATCH_SYNCED]: { filled: false, lyricSourceResult: null, filler: fillFromCubey },
            [SOURCE.LEGATO_SYNCED]: { filled: false, lyricSourceResult: null, filler: fillFromLegato },
            [SOURCE.LRCLIB_SYNCED]: { filled: false, lyricSourceResult: null, filler: fillFromLrclib },
            [SOURCE.LRCLIB_PLAIN]: { filled: false, lyricSourceResult: null, filler: fillFromLrclib }
        };
    }

    function createSourceContext(info, trackId) {
        const normalized = normalizeTrackQuery(info);
        return {
            baseInfo: {
                uri: info?.uri || '',
                title: info?.title || '',
                artist: info?.artist || '',
                album: info?.album || '',
                duration: Number(info?.duration) || 0
            },
            queryInfo: {
                uri: info?.uri || '',
                title: normalized.title || info?.title || '',
                artist: normalized.artist || info?.artist || '',
                album: normalized.album || info?.album || '',
                duration: Number(info?.duration) || 0
            },
            queryVariants: buildQueryVariants(info),
            trackId,
            sourceMap: newSourceMap(),
            inflightFillers: new Map(),
            availableSources: {},
            metadataSource: null,
            sourceDiagnostics: {},
            rejections: []
        };
    }

    function absorbSharedMetadata(context, result) {
        if (!result || typeof result !== 'object') return;
        if (result.availableSources && typeof result.availableSources === 'object') {
            context.availableSources = { ...context.availableSources, ...result.availableSources };
        }
        if (result.sourceDiagnostics && typeof result.sourceDiagnostics === 'object') {
            context.sourceDiagnostics = { ...context.sourceDiagnostics, ...result.sourceDiagnostics };
        }
        if (result.metadataSource && typeof result.metadataSource === 'object') {
            context.metadataSource = { ...result.metadataSource };
            if (context.metadataSource.title) context.queryInfo.title = context.metadataSource.title;
            if (context.metadataSource.artist) context.queryInfo.artist = context.metadataSource.artist;
            if (context.metadataSource.album) context.queryInfo.album = context.metadataSource.album;
            if (Number(context.metadataSource.duration) > 0) context.queryInfo.duration = Number(context.metadataSource.duration) * 1000;
            context.queryVariants = buildQueryVariants(context.baseInfo, context.metadataSource);
        }
    }

    function attachSharedMetadata(result, context) {
        if (!result) return null;
        const next = annotateResultPayload(deepCopy(result));
        next.provider = ADDON_INFO.id;
        if (context.availableSources) next.availableSources = { ...context.availableSources };
        if (context.sourceDiagnostics) next.sourceDiagnostics = { ...context.sourceDiagnostics };
        if (context.metadataSource) next.metadataSource = { ...context.metadataSource };
        return next;
    }

    function setSourceDiagnostic(context, sourceKey, patch) {
        context.sourceDiagnostics[sourceKey] = {
            ...(context.sourceDiagnostics[sourceKey] || {}),
            ...patch
        };
    }

    function setSourceResult(context, sourceKey, result) {
        const slot = context.sourceMap[sourceKey];
        if (!slot) return;
        slot.filled = true;
        slot.lyricSourceResult = attachSharedMetadata(result, context);
        absorbSharedMetadata(context, slot.lyricSourceResult);
        writeSourceCache(context, sourceKey, slot.lyricSourceResult);
    }

    function markSourcesFilledWithNull(context, sourceKeys) {
        sourceKeys.forEach(sourceKey => setSourceResult(context, sourceKey, null));
    }

    function applyCubeyMetadataCorrection(context, payload) {
        const next = {
            title: normalizeQueryText(payload?.song || context.queryInfo.title),
            artist: normalizeQueryText(payload?.artist || context.queryInfo.artist),
            album: normalizeQueryText(payload?.album || context.queryInfo.album),
            duration: Number(payload?.duration) || (Number(context.queryInfo.duration) > 1000 ? Math.round(Number(context.queryInfo.duration) / 1000) : Number(context.queryInfo.duration) || 0)
        };
        const changes = [];
        if (next.title && next.title !== normalizeText(context.queryInfo.title)) { context.queryInfo.title = next.title; changes.push(`title="${next.title}"`); }
        if (next.artist && next.artist !== normalizeText(context.queryInfo.artist)) { context.queryInfo.artist = next.artist; changes.push(`artist="${next.artist}"`); }
        if (next.album && next.album !== normalizeText(context.queryInfo.album)) { context.queryInfo.album = next.album; changes.push(`album="${next.album}"`); }
        const currentDurationSec = Number(context.queryInfo.duration) > 1000 ? Math.round(Number(context.queryInfo.duration) / 1000) : Number(context.queryInfo.duration) || 0;
        if (next.duration > 0 && next.duration !== currentDurationSec) {
            context.queryInfo.duration = next.duration * 1000;
            changes.push(`duration=${next.duration}s`);
        }
        context.metadataSource = next;
        context.queryVariants = buildQueryVariants(context.baseInfo, next);
        if (changes.length > 0) debugLog('Cubey metadata correction applied', changes.join(', '));
    }

    function buildRequestInfo(context) {
        return {
            uri: context.baseInfo.uri,
            title: context.queryInfo.title,
            artist: context.queryInfo.artist,
            album: context.queryInfo.album,
            duration: context.queryInfo.duration
        };
    }

    function getQueryCandidates(context) {
        return context.queryVariants?.length ? context.queryVariants : buildQueryVariants(context.baseInfo, context.metadataSource);
    }

    async function getSourceLyrics(context, sourceKey) {
        const slot = context.sourceMap[sourceKey];
        if (!slot) return null;
        if (slot.filled) {
            absorbSharedMetadata(context, slot.lyricSourceResult);
            return slot.lyricSourceResult ? deepCopy(slot.lyricSourceResult) : null;
        }
        const cached = readSourceCache(context, sourceKey);
        if (cached !== undefined) {
            slot.filled = true;
            slot.lyricSourceResult = cached;
            absorbSharedMetadata(context, cached);
            return cached ? deepCopy(cached) : null;
        }
        const filler = slot.filler;
        if (!context.inflightFillers.has(filler)) {
            context.inflightFillers.set(filler, Promise.resolve(filler(context)).catch(error => {
                debugLog('Source filler failed', sourceKey, error);
            }).finally(() => {
                context.inflightFillers.delete(filler);
            }));
        }
        await context.inflightFillers.get(filler);
        absorbSharedMetadata(context, context.sourceMap[sourceKey]?.lyricSourceResult);
        return context.sourceMap[sourceKey]?.lyricSourceResult ? deepCopy(context.sourceMap[sourceKey].lyricSourceResult) : null;
    }

    function extractCubeyTtmlText(rawValue) {
        if (typeof rawValue !== 'string') return '';
        const rawText = rawValue.trim();
        if (!rawText) return '';
        if (rawText.startsWith('<')) return rawText;
        try {
            const parsed = JSON.parse(rawText);
            if (typeof parsed?.ttml === 'string' && parsed.ttml.trim()) return parsed.ttml.trim();
        } catch {}
        return '';
    }

    async function fillFromCubey(context) {
        const payload = await fetchCubeyLyrics(buildRequestInfo(context));
        if (!payload || typeof payload !== 'object') {
            setSourceDiagnostic(context, SOURCE.MUSIXMATCH_RICHSYNC, { acquisitionState: RuntimeState.lastFailure?.reason || 'upstream_failed' });
            setSourceDiagnostic(context, SOURCE.MUSIXMATCH_SYNCED, { acquisitionState: RuntimeState.lastFailure?.reason || 'upstream_failed' });
            context.availableSources[SOURCE.MUSIXMATCH_RICHSYNC] = false;
            context.availableSources[SOURCE.MUSIXMATCH_SYNCED] = false;
            markSourcesFilledWithNull(context, [SOURCE.MUSIXMATCH_RICHSYNC, SOURCE.MUSIXMATCH_SYNCED]);
            return;
        }
        if (payload.instrumental === true) {
            const instrumental = buildInstrumentalResult(context.baseInfo);
            FETCHABLE_SOURCE_KEYS.forEach(sourceKey => {
                if (!context.sourceMap[sourceKey].filled) setSourceResult(context, sourceKey, instrumental);
            });
            return;
        }
        applyCubeyMetadataCorrection(context, payload);
        context.availableSources = {
            [SOURCE.MUSIXMATCH_RICHSYNC]: !!payload.musixmatchWordByWordLyrics,
            [SOURCE.MUSIXMATCH_SYNCED]: !!payload.musixmatchSyncedLyrics,
            [SOURCE.BLYRICS_RICHSYNCED]: !!payload.goLyricsApiTtml,
            [SOURCE.BLYRICS_SYNCED]: !!payload.goLyricsApiTtml,
            [SOURCE.LRCLIB_SYNCED]: !!payload.lrclibSyncedLyrics,
            [SOURCE.LRCLIB_PLAIN]: !!payload.lrclibPlainLyrics
        };
        const songDurationMs = Number(context.queryInfo.duration) || 0;
        const richParsed = parseLrc(payload.musixmatchWordByWordLyrics || '', songDurationMs);
        const syncedParsed = parseLrc(payload.musixmatchSyncedLyrics || '', songDurationMs);
        const ttmlParsed = parseTtml(extractCubeyTtmlText(payload.goLyricsApiTtml));
        const lrclibParsed = parseLrc(payload.lrclibSyncedLyrics || '', songDurationMs);

        // ── Sync Grafting: remap MXM richsync word timings onto a more
        //    accurate line-sync source (TTML > MXM synced > lrclib synced)
        if (richParsed?.karaoke?.length) {
            const anchorSynced = ttmlParsed?.synced || syncedParsed?.synced || lrclibParsed?.synced || null;
            if (anchorSynced?.length) {
                richParsed.karaoke = graftWordSyncOntoLineSync(richParsed.karaoke, anchorSynced);
                richParsed.synced = buildSyncedFromKaraoke(richParsed.karaoke);
                debugLog('Sync Grafting applied: MXM richsync words remapped onto', ttmlParsed?.synced ? 'TTML' : (syncedParsed?.synced ? 'MXM synced' : 'lrclib'), 'line timing');
            }
        }

        setSourceDiagnostic(context, SOURCE.MUSIXMATCH_RICHSYNC, { acquisitionState: richParsed ? 'selected' : 'upstream_failed' });
        setSourceDiagnostic(context, SOURCE.MUSIXMATCH_SYNCED, { acquisitionState: syncedParsed ? 'selected' : 'upstream_failed' });
        setSourceResult(context, SOURCE.MUSIXMATCH_RICHSYNC, richParsed ? buildResultFromMode(context.baseInfo, SOURCE.MUSIXMATCH_RICHSYNC, richParsed, 'richsynced') : null);
        setSourceResult(context, SOURCE.MUSIXMATCH_SYNCED, syncedParsed ? buildResultFromMode(context.baseInfo, SOURCE.MUSIXMATCH_SYNCED, syncedParsed, 'synced') : null);
        if (ttmlParsed) {
            setSourceDiagnostic(context, SOURCE.BLYRICS_RICHSYNCED, { acquisitionState: 'selected' });
            setSourceDiagnostic(context, SOURCE.BLYRICS_SYNCED, { acquisitionState: 'selected' });
            if (!context.sourceMap[SOURCE.BLYRICS_RICHSYNCED].filled) setSourceResult(context, SOURCE.BLYRICS_RICHSYNCED, buildResultFromMode(context.baseInfo, SOURCE.BLYRICS_RICHSYNCED, ttmlParsed, 'richsynced'));
            if (!context.sourceMap[SOURCE.BLYRICS_SYNCED].filled) setSourceResult(context, SOURCE.BLYRICS_SYNCED, buildResultFromMode(context.baseInfo, SOURCE.BLYRICS_SYNCED, ttmlParsed, 'synced'));
        }
        if (lrclibParsed && !context.sourceMap[SOURCE.LRCLIB_SYNCED].filled) {
            setSourceDiagnostic(context, SOURCE.LRCLIB_SYNCED, { acquisitionState: 'selected' });
            setSourceResult(context, SOURCE.LRCLIB_SYNCED, buildResultFromMode(context.baseInfo, SOURCE.LRCLIB_SYNCED, lrclibParsed, lrclibParsed.karaoke?.length ? 'richsynced' : 'synced'));
        }
        if (typeof payload.lrclibPlainLyrics === 'string' && payload.lrclibPlainLyrics.trim() && !context.sourceMap[SOURCE.LRCLIB_PLAIN].filled) {
            setSourceDiagnostic(context, SOURCE.LRCLIB_PLAIN, { acquisitionState: 'selected' });
            setSourceResult(context, SOURCE.LRCLIB_PLAIN, buildPlainResult(context.baseInfo, SOURCE.LRCLIB_PLAIN, payload.lrclibPlainLyrics));
        }
    }

    async function fetchSimpleSourceJson(sourceKey, context) {
        const settings = getRuntimeSettings();
        const helperMode = settings.transportMode === TRANSPORT.HELPER;
        const endpoint = sourceKey === SOURCE.LEGATO_SYNCED ? '/proxy/legato' : '/proxy/blyrics';
        const urlBase = sourceKey === SOURCE.LEGATO_SYNCED ? LEGATO_API_URL : BLYRICS_API_URL;

        if (isSourceCoolingDown(context, sourceKey)) {
            setSourceDiagnostic(context, sourceKey, { acquisitionState: 'cooldown_skipped' });
            return null;
        }

        for (const candidate of getQueryCandidates(context)) {
            if (!candidate.title || !candidate.artist) continue;
            const durationSeconds = Number(candidate.duration) > 1000 ? Math.round(Number(candidate.duration) / 1000) : Math.round(Number(candidate.duration) || 0);
            const query = {
                s: candidate.title,
                a: candidate.artist,
                al: candidate.album || '',
                d: durationSeconds > 0 ? String(durationSeconds) : '',
                videoId: context.trackId || ''
            };

            let response;
            if (helperMode) {
                if (!(await ensureHelperRunning(settings))) {
                    setSourceDiagnostic(context, sourceKey, { acquisitionState: 'helper_offline' });
                    return null;
                }
                response = await HelperTransport.fetchProxyJson(settings.helperUrl, endpoint, query, settings.requestTimeoutMs);
            } else {
                const url = new URL(urlBase);
                Object.entries(query).forEach(([key, value]) => {
                    if (value) url.searchParams.set(key, value);
                });
                const direct = await requestJson(url.toString(), { timeoutMs: settings.requestTimeoutMs });
                response = {
                    ok: !!(direct.ok && direct.data),
                    status: direct.status || 0,
                    error: direct.error?.message || null,
                    data: direct.data || null
                };
            }

            if (response.ok && response.data) {
                clearSourceCooldown(context, sourceKey);
                setSourceDiagnostic(context, sourceKey, { acquisitionState: 'selected', query });
                return response.data;
            }

            setSourceDiagnostic(context, sourceKey, {
                acquisitionState: response.notAvailable
                    ? 'proxy_unavailable'
                    : (response.notFound ? 'not_found' : (helperMode ? 'proxy_failed' : 'upstream_failed')),
                query,
                upstreamStatus: response.upstreamStatus || response.status || 0
            });
        }

        setSourceCooldown(context, sourceKey, context.sourceDiagnostics[sourceKey]?.acquisitionState === 'proxy_unavailable'
            ? SOURCE_UNAVAILABLE_COOLDOWN_MS
            : SOURCE_FAILURE_COOLDOWN_MS);
        return null;
    }

    async function fillFromBLyrics(context) {
        const settings = getRuntimeSettings();
        if (!settings.enableBLyricsDirect) {
            context.availableSources[SOURCE.BLYRICS_RICHSYNCED] = false;
            context.availableSources[SOURCE.BLYRICS_SYNCED] = false;
            markSourcesFilledWithNull(context, [SOURCE.BLYRICS_RICHSYNCED, SOURCE.BLYRICS_SYNCED]);
            return;
        }
        const payload = await fetchSimpleSourceJson(SOURCE.BLYRICS_RICHSYNCED, context);
        const parsed = payload?.ttml ? parseTtml(payload.ttml) : null;
        context.availableSources[SOURCE.BLYRICS_RICHSYNCED] = !!(parsed?.karaoke?.length || parsed?.synced?.length);
        context.availableSources[SOURCE.BLYRICS_SYNCED] = !!(parsed?.synced?.length || parsed?.karaoke?.length);
        setSourceResult(context, SOURCE.BLYRICS_RICHSYNCED, parsed ? buildResultFromMode(context.baseInfo, SOURCE.BLYRICS_RICHSYNCED, parsed, 'richsynced') : null);
        setSourceResult(context, SOURCE.BLYRICS_SYNCED, parsed ? buildResultFromMode(context.baseInfo, SOURCE.BLYRICS_SYNCED, parsed, 'synced') : null);
    }

    async function fillFromLegato(context) {
        const settings = getRuntimeSettings();
        if (!settings.enableLegatoDirect) {
            context.availableSources[SOURCE.LEGATO_SYNCED] = false;
            setSourceResult(context, SOURCE.LEGATO_SYNCED, null);
            return;
        }
        const payload = await fetchSimpleSourceJson(SOURCE.LEGATO_SYNCED, context);
        const parsed = payload?.lyrics ? parseLrc(payload.lyrics, Number(context.queryInfo.duration) || 0) : null;
        context.availableSources[SOURCE.LEGATO_SYNCED] = !!parsed?.synced?.length;
        setSourceResult(context, SOURCE.LEGATO_SYNCED, parsed ? buildResultFromMode(context.baseInfo, SOURCE.LEGATO_SYNCED, parsed, 'synced') : null);
    }

    function scoreLrclibCandidate(context, item) {
        const queryDurationSec = Number(context.queryInfo.duration) > 1000 ? Number(context.queryInfo.duration) / 1000 : Number(context.queryInfo.duration) || 0;
        const titleScore = similarity(context.queryInfo.title, item.trackName || '');
        const artistScore = similarity(context.queryInfo.artist, item.artistName || '');
        const durationDiff = queryDurationSec > 0 && Number.isFinite(item.duration) ? Math.abs(Number(item.duration) - queryDurationSec) : 999;
        const durationScore = durationDiff === 999 ? 0.3 : Math.max(0, 1 - (durationDiff / 45));
        return (titleScore * 0.45) + (artistScore * 0.35) + (durationScore * 0.20) + (item.syncedLyrics ? 0.1 : 0);
    }

    async function fetchLrclibCandidates(context) {
        const settings = getRuntimeSettings();
        if (!settings.enableLrclibDirect) return [];
        const headers = { 'x-user-agent': `spicetify v${Spicetify.Config?.version || 'unknown'}` };
        const helperMode = settings.transportMode === TRANSPORT.HELPER;

        if (isSourceCoolingDown(context, SOURCE.LRCLIB_SYNCED)) {
            setSourceDiagnostic(context, SOURCE.LRCLIB_SYNCED, { acquisitionState: 'cooldown_skipped' });
            return [];
        }

        for (const info of getQueryCandidates(context)) {
            const durationSeconds = Number(info.duration) > 1000 ? Math.round(Number(info.duration) / 1000) : Math.round(Number(info.duration) || 0);
            const attempts = [
                { mode: 'get', track_name: info.title, artist_name: info.artist, album_name: info.album || '', duration: durationSeconds > 0 ? String(durationSeconds) : '' },
                { mode: 'search', track_name: info.title, artist_name: info.artist, album_name: info.album || '', duration: durationSeconds > 0 ? String(durationSeconds) : '' },
                { mode: 'search', q: info.title },
                { mode: 'search', q: info.artist }
            ];

            for (const params of attempts) {
                let response;
                if (helperMode) {
                    if (!(await ensureHelperRunning(settings))) {
                        setSourceDiagnostic(context, SOURCE.LRCLIB_SYNCED, { acquisitionState: 'helper_offline' });
                        return [];
                    }
                    response = await HelperTransport.fetchProxyJson(settings.helperUrl, '/proxy/lrclib', params, settings.requestTimeoutMs);
                } else {
                    const mode = params.mode || 'search';
                    const query = new URLSearchParams(params);
                    const direct = await requestJson(`${LRCLIB_API_BASE}/${mode}?${query.toString()}`, { headers, timeoutMs: settings.requestTimeoutMs });
                    response = {
                        ok: !!(direct.ok && direct.data),
                        status: direct.status || 0,
                        data: direct.data || null
                    };
                }

                if (response.ok && response.data) {
                    clearSourceCooldown(context, SOURCE.LRCLIB_SYNCED);
                    setSourceDiagnostic(context, SOURCE.LRCLIB_SYNCED, { acquisitionState: 'selected', query: params });
                    if (Array.isArray(response.data)) {
                        if (response.data.length > 0) return response.data;
                    } else {
                        return [response.data];
                    }
                }

                if (response.ok && !response.data) {
                    setSourceDiagnostic(context, SOURCE.LRCLIB_SYNCED, {
                        acquisitionState: response.notAvailable ? 'proxy_unavailable' : (response.notFound ? 'not_found' : (helperMode ? 'proxy_failed' : 'upstream_failed')),
                        query: params,
                        upstreamStatus: response.upstreamStatus || response.status || 0
                    });
                }
            }
        }

        setSourceCooldown(
            context,
            SOURCE.LRCLIB_SYNCED,
            context.sourceDiagnostics[SOURCE.LRCLIB_SYNCED]?.acquisitionState === 'proxy_unavailable'
                ? SOURCE_UNAVAILABLE_COOLDOWN_MS
                : SOURCE_FAILURE_COOLDOWN_MS
        );
        if (!context.sourceDiagnostics[SOURCE.LRCLIB_SYNCED]) {
            setSourceDiagnostic(context, SOURCE.LRCLIB_SYNCED, { acquisitionState: helperMode ? 'proxy_failed' : 'upstream_failed' });
        }
        return [];
    }

    async function fillFromLrclib(context) {
        const candidates = await fetchLrclibCandidates(context);
        if (!Array.isArray(candidates) || candidates.length === 0) {
            context.availableSources[SOURCE.LRCLIB_SYNCED] = false;
            context.availableSources[SOURCE.LRCLIB_PLAIN] = false;
            markSourcesFilledWithNull(context, [SOURCE.LRCLIB_SYNCED, SOURCE.LRCLIB_PLAIN]);
            return;
        }
        const best = candidates.map(item => ({ item, score: scoreLrclibCandidate(context, item) })).sort((a, b) => b.score - a.score)[0];
        if (!best || best.score < 0.35) {
            context.availableSources[SOURCE.LRCLIB_SYNCED] = false;
            context.availableSources[SOURCE.LRCLIB_PLAIN] = false;
            markSourcesFilledWithNull(context, [SOURCE.LRCLIB_SYNCED, SOURCE.LRCLIB_PLAIN]);
            return;
        }
        const syncedParsed = best.item.syncedLyrics ? parseLrc(best.item.syncedLyrics, Number(context.queryInfo.duration) || 0) : null;
        context.availableSources[SOURCE.LRCLIB_SYNCED] = !!syncedParsed?.synced?.length;
        context.availableSources[SOURCE.LRCLIB_PLAIN] = !!best.item.plainLyrics;
        setSourceResult(context, SOURCE.LRCLIB_SYNCED, syncedParsed ? buildResultFromMode(context.baseInfo, SOURCE.LRCLIB_SYNCED, syncedParsed, syncedParsed.karaoke?.length ? 'richsynced' : 'synced') : null);
        setSourceResult(context, SOURCE.LRCLIB_PLAIN, best.item.plainLyrics ? buildPlainResult(context.baseInfo, SOURCE.LRCLIB_PLAIN, best.item.plainLyrics) : null);
    }

    function getTrackId(info) {
        return String(info?.uri || '').split(':')[2] || '';
    }

    function createFailureResult(info, error) {
        const result = createEmptyResult(info);
        result.error = error || 'No lyrics found';
        return result;
    }

    function buildAlignmentTokenStream(lines, preferTimedSegments) {
        const stream = [];
        (lines || []).forEach((line, lineIndex) => {
            if (isInstrumentalLine(line)) return;
            let segments = [];
            let useWholeSegmentTokens = false;
            if (preferTimedSegments) {
                const timedSegments = getLeadLineSyllables(line);
                if (timedSegments.length > 0) {
                    segments = timedSegments.map(segment => String(segment?.text || ''));
                    useWholeSegmentTokens = true;
                }
            }
            if (segments.length === 0) {
                segments = splitDisplaySegments(getLineBaseText(line) || normalizeText(line?.text || ''));
            }
            segments.forEach(segmentText => {
                tokenizeTextForAlignment(segmentText, useWholeSegmentTokens).forEach(token => {
                    stream.push({ token, lineIndex });
                });
            });
        });
        return stream;
    }

    function computeLcsMatches(leftTokens, rightTokens) {
        const leftLength = leftTokens.length;
        const rightLength = rightTokens.length;
        if (leftLength === 0 || rightLength === 0) return [];
        const table = Array.from({ length: leftLength + 1 }, () => new Uint32Array(rightLength + 1));
        for (let leftIndex = 1; leftIndex <= leftLength; leftIndex += 1) {
            for (let rightIndex = 1; rightIndex <= rightLength; rightIndex += 1) {
                table[leftIndex][rightIndex] = leftTokens[leftIndex - 1].token === rightTokens[rightIndex - 1].token
                    ? table[leftIndex - 1][rightIndex - 1] + 1
                    : Math.max(table[leftIndex - 1][rightIndex], table[leftIndex][rightIndex - 1]);
            }
        }
        const matches = [];
        let leftIndex = leftLength;
        let rightIndex = rightLength;
        while (leftIndex > 0 && rightIndex > 0) {
            if (leftTokens[leftIndex - 1].token === rightTokens[rightIndex - 1].token) {
                matches.push([leftIndex - 1, rightIndex - 1]);
                leftIndex -= 1;
                rightIndex -= 1;
            } else if (table[leftIndex - 1][rightIndex] >= table[leftIndex][rightIndex - 1]) {
                leftIndex -= 1;
            } else {
                rightIndex -= 1;
            }
        }
        return matches.reverse();
    }

    function getBestLineText(member, field, fallback = '') {
        if (!member || typeof member !== 'object') return normalizeText(fallback);
        if (field === 'translation') {
            return normalizeText(member?.text2 || member?.translation || member?.translationText || fallback || '');
        }
        return normalizeText(member?.[field] || fallback || '');
    }

    function getLineTimingWindow(line, fallbackStart, fallbackEnd) {
        const syllables = getAllLineSyllables(line);
        if (syllables.length > 0) {
            const first = syllables[0];
            const last = syllables[syllables.length - 1];
            return {
                start: Number.isFinite(first?.startTime) ? first.startTime : fallbackStart,
                end: Number.isFinite(last?.endTime) ? last.endTime : (Number.isFinite(line?.endTime) ? line.endTime : fallbackEnd)
            };
        }
        const start = Number.isFinite(line?.startTime) ? line.startTime : fallbackStart;
        const end = Number.isFinite(line?.endTime) ? line.endTime : fallbackEnd;
        return {
            start,
            end: Math.max(start + 1, end)
        };
    }

    function scaleTimeToWindow(timeValue, sourceStart, sourceEnd, targetStart, targetEnd, fallbackRatio = 0) {
        const safeTargetStart = Number.isFinite(targetStart) ? targetStart : 0;
        const safeTargetEnd = Number.isFinite(targetEnd) && targetEnd > safeTargetStart ? targetEnd : safeTargetStart + LINE_FALLBACK_DURATION_MS;
        const safeSourceStart = Number.isFinite(sourceStart) ? sourceStart : 0;
        const safeSourceEnd = Number.isFinite(sourceEnd) && sourceEnd > safeSourceStart ? sourceEnd : safeSourceStart + 1;
        const ratio = Number.isFinite(timeValue)
            ? (timeValue - safeSourceStart) / Math.max(1, safeSourceEnd - safeSourceStart)
            : fallbackRatio;
        return Math.max(safeTargetStart, Math.min(safeTargetEnd, safeTargetStart + Math.round((safeTargetEnd - safeTargetStart) * ratio)));
    }

    function scaleSyllableArrayToWindow(syllables, sourceStart, sourceEnd, targetStart, targetEnd) {
        const safeSyllables = Array.isArray(syllables) ? syllables.filter(Boolean) : [];
        if (safeSyllables.length === 0) return [];
        return finalizeSyllableGroup(
            safeSyllables.map((syllable, index) => {
                const fallbackStartRatio = index / safeSyllables.length;
                const fallbackEndRatio = (index + 1) / safeSyllables.length;
                const startTime = scaleTimeToWindow(syllable?.startTime, sourceStart, sourceEnd, targetStart, targetEnd, fallbackStartRatio);
                const endTime = scaleTimeToWindow(syllable?.endTime, sourceStart, sourceEnd, targetStart, targetEnd, fallbackEndRatio);
                return {
                    text: String(syllable?.text || ''),
                    startTime,
                    endTime: Math.max(startTime + 1, endTime)
                };
            }),
            targetStart,
            null,
            targetEnd
        );
    }

    function buildAlignedKaraokeLine(member, referenceLine, options = {}) {
        if (!member) return null;
        const memberOriginalText = getBestLineText(member, 'originalText');
        const memberDisplayText = getBestLineText(member, 'text', memberOriginalText || referenceLine?.text || '');
        const referenceDisplayText = getBestLineText(referenceLine, 'text', getLineBaseText(referenceLine) || memberDisplayText || '');
        const referenceOriginalText = getBestLineText(referenceLine, 'originalText');
        const useReferenceText = !!options.preferReferenceText && !!referenceDisplayText;
        const displayText = useReferenceText
            ? referenceDisplayText
            : (memberDisplayText || referenceDisplayText || referenceLine?.text || '');
        const originalText = useReferenceText
            ? (referenceOriginalText && referenceOriginalText !== displayText ? referenceOriginalText : '')
            : memberOriginalText;
        const translationText = useReferenceText
            ? getBestLineText(referenceLine, 'translation', getBestLineText(member, 'translation'))
            : getBestLineText(member, 'translation', getBestLineText(referenceLine, 'translation'));
        const baseLine = {
            startTime: referenceLine.startTime,
            endTime: referenceLine.endTime,
            text: displayText || referenceLine.text,
            isInstrumental: !!member?.isInstrumental,
            originalText: originalText || undefined,
            text2: translationText || undefined,
            translation: translationText || undefined,
            translationText: translationText || undefined
        };
        const window = getLineTimingWindow(member, referenceLine.startTime, referenceLine.endTime);
        const sourceStart = window.start;
        const sourceEnd = window.end;
        const leadSyllables = [];
        const backgroundGroups = [];
        const scaledLeadSyllables = [];

        if (member?.vocals?.lead?.syllables?.length) {
            scaledLeadSyllables.push(...scaleSyllableArrayToWindow(member.vocals.lead.syllables, sourceStart, sourceEnd, referenceLine.startTime, referenceLine.endTime));
        } else if (Array.isArray(member?.syllables) && member.syllables.length > 0) {
            scaledLeadSyllables.push(...scaleSyllableArrayToWindow(member.syllables, sourceStart, sourceEnd, referenceLine.startTime, referenceLine.endTime));
        }

        if (useReferenceText) {
            leadSyllables.push(...retextSyllablesFromReferenceText(
                displayText || referenceLine?.text || '',
                scaledLeadSyllables,
                referenceLine.startTime,
                referenceLine.endTime
            ));
        } else {
            leadSyllables.push(...scaledLeadSyllables);
        }

        if (Array.isArray(member?.vocals?.background)) {
            member.vocals.background.forEach((group, groupIndex) => {
                const scaled = scaleSyllableArrayToWindow(group?.syllables || [], sourceStart, sourceEnd, referenceLine.startTime, referenceLine.endTime);
                if (scaled.length === 0) return;
                backgroundGroups.push({
                    agent: group?.agent || `bg${groupIndex + 1}`,
                    text: normalizeText(group?.text || ''),
                    syllables: scaled
                });
            });
        }

        if (backgroundGroups.length > 0) {
            return {
                ...baseLine,
                vocals: {
                    lead: {
                        agent: member?.vocals?.lead?.agent || member?.agent,
                        syllables: leadSyllables.length > 0
                            ? finalizeSyllableGroup(leadSyllables, referenceLine.startTime, null, referenceLine.endTime)
                            : []
                    },
                    background: backgroundGroups.map(group => ({
                        ...group,
                        syllables: finalizeSyllableGroup(group.syllables, referenceLine.startTime, null, referenceLine.endTime)
                    }))
                }
            };
        }

        if (leadSyllables.length > 0) {
            return {
                ...baseLine,
                syllables: finalizeSyllableGroup(leadSyllables, referenceLine.startTime, null, referenceLine.endTime)
            };
        }

        return baseLine;
    }

    function buildAlignedSyncedLine(member, referenceLine) {
        if (!member) return null;
        const originalText = getBestLineText(member, 'originalText');
        const displayText = getBestLineText(member, 'text', originalText || referenceLine?.text || '');
        const translationText = getBestLineText(member, 'translation');
        return {
            startTime: referenceLine.startTime,
            endTime: referenceLine.endTime,
            text: displayText || referenceLine.text,
            isInstrumental: !!member?.isInstrumental,
            originalText: originalText || undefined,
            text2: translationText || undefined,
            translation: translationText || undefined,
            translationText: translationText || undefined
        };
    }

    function buildTimedReferenceFromLyricsResult(result, fallbackSourceId = null) {
        if (!result || typeof result !== 'object') return null;
        const lines = result?.karaoke?.length
            ? buildSyncedFromKaraoke(result.karaoke)
            : (Array.isArray(result?.synced) ? deepCopy(result.synced) : []);
        if (lines.length === 0) return null;
        return {
            lines,
            syncType: result?.karaoke?.length ? 'SYLLABLE_SYNCED' : 'LINE_SYNCED',
            nativeResult: result,
            sourceId: result?.sourceId || fallbackSourceId || null,
            provider: result?.provider || '',
            language: result?.language || ''
        };
    }

    function buildMonotonicLineMapping(candidateLines, referenceLines, matches, candidateTokens, referenceTokens) {
        const candidateCount = candidateLines.length;
        const referenceCount = referenceLines.length;
        const scores = Array.from({ length: candidateCount }, () => Array.from({ length: referenceCount }, () => 0));
        matches.forEach(([candidateTokenIndex, referenceTokenIndex]) => {
            const candidateLineIndex = candidateTokens[candidateTokenIndex].lineIndex;
            const referenceLineIndex = referenceTokens[referenceTokenIndex].lineIndex;
            if (candidateLineIndex < candidateCount && referenceLineIndex < referenceCount) {
                scores[candidateLineIndex][referenceLineIndex] += 1;
            }
        });

        const dp = Array.from({ length: candidateCount + 1 }, () => Array.from({ length: referenceCount + 1 }, () => 0));
        for (let i = 1; i <= candidateCount; i += 1) {
            for (let j = 1; j <= referenceCount; j += 1) {
                dp[i][j] = Math.max(
                    dp[i - 1][j],
                    dp[i][j - 1],
                    dp[i - 1][j - 1] + scores[i - 1][j - 1]
                );
            }
        }

        const mapping = new Map();
        let i = candidateCount;
        let j = referenceCount;
        while (i > 0 && j > 0) {
            if (dp[i][j] === dp[i - 1][j]) {
                i -= 1;
                continue;
            }
            if (dp[i][j] === dp[i][j - 1]) {
                j -= 1;
                continue;
            }
            if (scores[i - 1][j - 1] > 0) {
                mapping.set(i - 1, j - 1);
            }
            i -= 1;
            j -= 1;
        }
        return mapping;
    }

    function isContaminatedAlignedLine(alignedLine, referenceLine, previousReferenceLine, nextReferenceLine, previousAlignedLine) {
        const currentText = normalizeText(alignedLine?.originalText || alignedLine?.text || '');
        if (!currentText) return true;
        if (previousAlignedLine && currentText === normalizeText(previousAlignedLine?.originalText || previousAlignedLine?.text || '')) {
            return true;
        }
        const ownScore = similarity(currentText, referenceLine?.text || '');
        const prevScore = previousReferenceLine ? similarity(currentText, previousReferenceLine?.text || '') : 0;
        const nextScore = nextReferenceLine ? similarity(currentText, nextReferenceLine?.text || '') : 0;
        return ownScore + 0.05 < Math.max(prevScore, nextScore);
    }

    function alignCandidateWithSpotifyReference(candidate, reference, lineMapping, options = {}) {
        const candidateLines = candidate?.karaoke || candidate?.synced || [];
        if (!reference?.lines?.length || !candidateLines.length) return null;
        const mappedLines = new Map();
        lineMapping.forEach((referenceIndex, candidateIndex) => {
            if (!candidateLines[candidateIndex]) return;
            mappedLines.set(referenceIndex, candidateLines[candidateIndex]);
        });
        const alignedLines = [];
        for (let referenceIndex = 0; referenceIndex < reference.lines.length; referenceIndex += 1) {
            const referenceLine = reference.lines[referenceIndex];
            const mapped = mappedLines.get(referenceIndex);
            if (!mapped) continue;
            const next = candidate?.karaoke?.length
                ? buildAlignedKaraokeLine(mapped, referenceLine, options)
                : buildAlignedSyncedLine(mapped, referenceLine);
            if (!next || !normalizeText(next?.text || next?.originalText || '')) continue;
            const contaminated = isContaminatedAlignedLine(
                next,
                referenceLine,
                reference.lines[referenceIndex - 1] || null,
                reference.lines[referenceIndex + 1] || null,
                alignedLines[alignedLines.length - 1] || null
            );
            alignedLines.push(annotateLineMetadata(next, { contaminationSafe: !contaminated }));
        }
        if (alignedLines.length === 0 || alignedLines.some(line => line?.layout?.contaminationSafe === false)) return null;

        const result = createEmptyResult(candidate);
        result.sourceId = candidate?.sourceId || null;
        result.contributors = candidate?.contributors || null;
        result.copyright = candidate?.copyright || null;

        if (candidate?.karaoke?.length) {
            const karaoke = finalizeKaraokeLines(alignedLines);
            result.karaoke = karaoke;
            result.synced = buildSyncedFromKaraoke(karaoke);
            result.unsynced = buildUnsyncedFromTimedLines(result.synced);
        } else {
            const synced = alignedLines
                .map(line => ({
                    startTime: Math.max(0, Math.round(line.startTime || 0)),
                    endTime: Number.isFinite(line.endTime) ? Math.max(0, Math.round(line.endTime)) : undefined,
                    text: normalizeText(line.text || ''),
                    originalText: line.originalText || undefined,
                    text2: line.text2 || line.translation || line.translationText || undefined,
                    translation: line.translation || line.text2 || line.translationText || undefined,
                    translationText: line.translationText || line.text2 || line.translation || undefined
                }))
                .filter(line => line.text);
            result.synced = synced;
            result.unsynced = buildUnsyncedFromTimedLines(synced);
        }
        return hasLyricsPayload(result)
            ? annotateResultPayload(result, {
                selectedSource: candidate?.sourceId || null,
                spotifyAligned: true,
                alignmentMode: options.preferReferenceText
                    ? (options.referenceSourceId && !String(options.referenceSourceId).startsWith('spotify')
                        ? 'validated-line-word-graft'
                        : 'spotify-word-graft')
                    : 'spotify-monotonic',
                validationState: options.preferReferenceText ? 'retexted' : 'aligned',
                textAnchorSource: options.referenceSourceId || null
            })
            : null;
    }

    function validateAgainstSpotifyReference(candidate, spotifyReference, sourceId = null, options = {}) {
        if (isSpotifyValidationExemptSource(sourceId)) {
            return {
                accepted: true,
                matchAmount: null,
                coverage: null,
                alignedResult: null,
                alignmentMode: null,
                validationState: 'accepted',
                textAnchorSource: null
            };
        }

        if (!spotifyReference?.normalizedText) {
            return {
                accepted: true,
                matchAmount: null,
                coverage: null,
                alignedResult: null,
                alignmentMode: null,
                validationState: 'selected',
                textAnchorSource: null
            };
        }

        const candidateLines = candidate?.karaoke || candidate?.synced || candidate?.unsynced || [];
        const hasKaraokeCandidate = !!candidate?.karaoke?.length;
        const hasOnlyInstrumental = candidateLines.length > 0 && candidateLines.every(isInstrumentalLine);
        if (hasOnlyInstrumental) {
            return {
                accepted: true,
                matchAmount: null,
                coverage: null,
                alignedResult: null,
                alignmentMode: null,
                validationState: 'accepted',
                textAnchorSource: null
            };
        }

        const lyricText = collectCandidateText(candidate);
        if (!lyricText) {
            return {
                accepted: false,
                matchAmount: 0,
                coverage: 0,
                alignedResult: null,
                alignmentMode: null,
                validationState: 'validation_rejected',
                textAnchorSource: null
            };
        }

        const matchAmount = similarity(lyricText, spotifyReference.normalizedText);
        const referenceLines = spotifyReference.lines || [];
        const candidateTokens = buildAlignmentTokenStream(candidateLines, !!candidate?.karaoke?.length);
        const referenceTokens = buildAlignmentTokenStream(referenceLines, true);

        if (referenceTokens.length === 0 || candidateTokens.length === 0) {
            return {
                accepted: matchAmount >= SPOTIFY_ALIGN_ACCEPT_THRESHOLD,
                matchAmount,
                coverage: null,
                alignedResult: null,
                alignmentMode: 'unaligned',
                validationState: matchAmount >= SPOTIFY_ALIGN_ACCEPT_THRESHOLD ? 'accepted' : 'validation_rejected',
                textAnchorSource: null
            };
        }

        const matches = computeLcsMatches(candidateTokens, referenceTokens);
        const coverage = matches.length / Math.max(1, referenceTokens.length);
        if (coverage < SPOTIFY_ALIGN_ACCEPT_THRESHOLD) {
            const accepted = hasKaraokeCandidate && matchAmount >= SPOTIFY_ALIGN_ACCEPT_THRESHOLD;
            return {
                accepted,
                matchAmount,
                coverage,
                alignedResult: null,
                alignmentMode: 'unaligned',
                validationState: accepted ? 'accepted' : 'validation_rejected',
                textAnchorSource: null
            };
        }

        let alignmentReference = spotifyReference;
        let alignmentMatches = matches;
        let alignmentTokens = referenceTokens;
        let alignmentCoverage = coverage;

        if (hasKaraokeCandidate && options.karaokeTextAnchor?.lines?.length) {
            const anchorReferenceLines = options.karaokeTextAnchor.lines || [];
            const anchorTokens = buildAlignmentTokenStream(anchorReferenceLines, true);
            if (anchorTokens.length > 0) {
                const anchorMatches = computeLcsMatches(candidateTokens, anchorTokens);
                const anchorCoverage = anchorMatches.length / Math.max(1, anchorTokens.length);
                if (anchorCoverage >= SPOTIFY_ALIGN_ACCEPT_THRESHOLD) {
                    alignmentReference = options.karaokeTextAnchor;
                    alignmentMatches = anchorMatches;
                    alignmentTokens = anchorTokens;
                    alignmentCoverage = anchorCoverage;
                }
            }
        }

        const lineMapping = buildMonotonicLineMapping(
            candidateLines,
            alignmentReference.lines || referenceLines,
            alignmentMatches,
            candidateTokens,
            alignmentTokens
        );
        const shouldRetextKaraoke = hasKaraokeCandidate
            && !options.disableKaraokeTextGraft
            && alignmentCoverage >= SPOTIFY_ALIGN_REBUILD_THRESHOLD
            && (matchAmount < KARAOKE_TEXT_GRAFT_PRESERVE_THRESHOLD || coverage < KARAOKE_TEXT_GRAFT_PRESERVE_THRESHOLD);

        if (alignmentCoverage >= SPOTIFY_ALIGN_REBUILD_THRESHOLD && alignmentReference.syncType !== 'UNSYNCED' && candidate?.synced?.length) {
            const alignedResult = alignCandidateWithSpotifyReference(candidate, alignmentReference, lineMapping, {
                preferReferenceText: shouldRetextKaraoke,
                referenceSourceId: alignmentReference?.sourceId || null
            });
            const accepted = !!alignedResult || (!shouldRetextKaraoke && matchAmount >= SPOTIFY_ALIGN_ACCEPT_THRESHOLD);
            const alignmentMode = alignedResult
                ? (shouldRetextKaraoke
                    ? (alignmentReference?.sourceId && !String(alignmentReference.sourceId).startsWith('spotify')
                        ? 'validated-line-word-graft'
                        : 'spotify-word-graft')
                    : 'spotify-monotonic')
                : 'unaligned';
            return {
                accepted,
                matchAmount,
                coverage,
                alignedResult,
                alignmentMode,
                validationState: alignedResult
                    ? (shouldRetextKaraoke ? 'retexted' : 'aligned')
                    : (accepted ? 'accepted' : 'alignment_rejected'),
                textAnchorSource: shouldRetextKaraoke ? (alignmentReference?.sourceId || null) : null
            };
        }

        return {
            accepted: matchAmount >= SPOTIFY_ALIGN_ACCEPT_THRESHOLD,
            matchAmount,
            coverage,
            alignedResult: null,
            alignmentMode: 'unaligned',
            validationState: matchAmount >= SPOTIFY_ALIGN_ACCEPT_THRESHOLD ? 'accepted' : 'validation_rejected',
            textAnchorSource: null
        };
    }

    async function resolvePreferredKaraokeTextAnchor(context, settings, spotifyReference, excludeSourceId = null) {
        const anchorPlan = [
            { kind: 'source', sourceId: SOURCE.BLYRICS_SYNCED },
            { kind: 'source', sourceId: SOURCE.LRCLIB_SYNCED },
            { kind: 'source', sourceId: SOURCE.LEGATO_SYNCED },
            { kind: 'spotify' },
            { kind: 'source', sourceId: SOURCE.MUSIXMATCH_SYNCED }
        ];

        for (const anchor of anchorPlan) {
            if (anchor.kind === 'spotify') {
                if (!settings.enableSpotifyValidation || !spotifyReference?.nativeResult || !hasLyricsPayload(spotifyReference.nativeResult)) continue;
                const spotifyAnchor = buildTimedReferenceFromLyricsResult(
                    spotifyReference.nativeResult,
                    spotifyReference?.nativeResult?.sourceId || 'spotify-official-fallback'
                );
                if (spotifyAnchor) return spotifyAnchor;
                continue;
            }

            if (anchor.sourceId === excludeSourceId || !isSourceRuntimeEnabled(settings, anchor.sourceId)) continue;
            const anchorCandidate = await getSourceLyrics(context, anchor.sourceId);
            if (!anchorCandidate || !anchorCandidate?.synced?.length) continue;

            if (isSpotifyValidationExemptSource(anchor.sourceId)) {
                const trustedAnchor = buildTimedReferenceFromLyricsResult(anchorCandidate, anchor.sourceId);
                if (trustedAnchor) return trustedAnchor;
                continue;
            }

            const validation = validateAgainstSpotifyReference(anchorCandidate, spotifyReference, anchor.sourceId, {
                disableKaraokeTextGraft: true
            });
            if (!validation.accepted) continue;
            const validatedAnchor = buildTimedReferenceFromLyricsResult(validation.alignedResult || anchorCandidate, anchor.sourceId);
            if (validatedAnchor) return validatedAnchor;
        }

        return null;
    }

    async function primeCubeyContext(context) {
        const settings = getRuntimeSettings();
        if (!settings.enableCubey) return null;
        try {
            return await getSourceLyrics(context, SOURCE.MUSIXMATCH_RICHSYNC);
        } catch (error) {
            debugLog('Cubey priming failed', error);
            return null;
        }
    }

    function notify(message, isError = false) {
        const text = String(message || '').trim();
        if (!text) return;
        if (typeof Spicetify?.showNotification === 'function') {
            Spicetify.showNotification(text, isError);
            return;
        }
        console[isError ? 'error' : 'log'](`[BetterLyricsEngine] ${text}`);
    }

    function clearEngineStorage() {
        let cleared = 0;
        try {
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (!key) continue;
                if (key.startsWith(`${STORAGE_PREFIX}cubey-jwt:`)) {
                    keys.push(key);
                }
            }
            keys.forEach(key => {
                localStorage.removeItem(key);
                cleared += 1;
            });
        } catch {}
        RuntimeState.lastFailure = null;
        RuntimeState.helperSessionId = null;
        RuntimeState.helperSessionExp = 0;
        RuntimeState.helperConnected = null;
        RuntimeState.helperAuthPromise = null;
        RuntimeState.sourceCooldowns.clear();
        RuntimeState.debugLogCooldowns.clear();
        return cleared;
    }

    async function runHelperHealthProbe() {
        const settings = getRuntimeSettings();
        const healthy = await refreshHelperHealth(settings.helperUrl, true);
        if (!healthy) throw new Error(`Helper offline at ${settings.helperUrl}`);
        return `Helper healthy: ${settings.helperUrl}`;
    }

    async function runHelperLaunchProbe() {
        const settings = getRuntimeSettings();
        const launched = await ensureHelperRunning(settings, true);
        if (!launched) throw new Error('Helper launch failed');
        return 'Helper launched and responded';
    }

    function decodeJwtExpMs(token) {
        try {
            const parts = String(token || '').split('.');
            if (parts.length < 2) return 0;
            const payloadBase64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const padded = payloadBase64.padEnd(Math.ceil(payloadBase64.length / 4) * 4, '=');
            const payload = JSON.parse(atob(padded));
            return Number.isFinite(payload?.exp) ? Math.round(payload.exp * 1000) : 0;
        } catch {
            return 0;
        }
    }

    async function runCubeyAuthProbe() {
        const settings = getRuntimeSettings();
        if (settings.transportMode === TRANSPORT.HELPER) {
            if (!(await ensureHelperRunning(settings, true))) throw new Error('Helper offline');
            const session = await ensureHelperSession(settings);
            if (!session?.success) throw new Error(session?.error || 'Helper auth failed');
            RuntimeState.helperSessionId = session.sessionId;
            RuntimeState.helperSessionExp = Number(session.expiresAt) || 0;
            return 'Helper auth succeeded';
        }
        const token = await CubeyAuth.getToken({
            baseUrl: settings.cubeyBaseUrl,
            manualToken: settings.cubeyManualToken,
            autoAuth: settings.cubeyAutoAuth,
            forceNew: false,
            timeoutMs: settings.requestTimeoutMs
        });
        if (!token) throw new Error('JWT unavailable');
        const expMs = decodeJwtExpMs(token);
        if (expMs > 0) {
            const remainSec = Math.max(0, Math.round((expMs - Date.now()) / 1000));
            return `Cubey JWT ready (${remainSec}s remaining)`;
        }
        return 'Cubey JWT ready';
    }

    function getSettingsUI() {
        const React = Spicetify?.React;
        if (!React) return () => null;
        const e = React.createElement;
        return function BetterLyricsEngineSettings() {
            const [settingsState, setSettingsState] = React.useState(() => getRuntimeSettings());
            const [busyAction, setBusyAction] = React.useState('');

            const patchState = patch => setSettingsState(prev => ({ ...prev, ...patch }));
            const commit = (key, value, patch = null) => {
                setSetting(key, value);
                patchState(patch || { [key === 'transport_mode' ? 'transportMode' : key]: value });
                setSettingsState(getRuntimeSettings());
            };
            const commitRuntime = (key, mapKey, value) => {
                setSetting(key, value);
                patchState({ [mapKey]: value });
            };
            const commitNormalizedUrl = (key, mapKey, value) => {
                const normalized = normalizeBaseUrl(value);
                setSetting(key, normalized);
                patchState({ [mapKey]: normalized });
                setSettingsState(getRuntimeSettings());
            };
            const commitNumber = (key, mapKey, value, fallback) => {
                const normalized = clampNumber(value, fallback, 2000, 30000);
                setSetting(key, normalized);
                patchState({ [mapKey]: normalized });
                setSettingsState(getRuntimeSettings());
            };
            const commitSourcePreferenceList = nextList => {
                const normalized = normalizeSourcePreferenceList(nextList);
                setSetting('source_preference_list', normalized);
                patchState({ sourcePreferenceList: normalized });
                setSettingsState(getRuntimeSettings());
            };
            const runAction = async (label, action) => {
                setBusyAction(label);
                try {
                    const message = await action();
                    notify(message || `${label} completed`);
                    setSettingsState(getRuntimeSettings());
                } catch (error) {
                    notify(`${label}: ${error?.message || error}`, true);
                } finally {
                    setBusyAction('');
                }
            };

            const renderRow = (name, description, control) => e(
                'div',
                { className: 'setting-row' },
                e(
                    'div',
                    { className: 'setting-row-content' },
                    e(
                        'div',
                        { className: 'setting-row-left' },
                        e('div', { className: 'setting-name' }, name),
                        description ? e('div', { className: 'setting-description' }, description) : null
                    ),
                    e('div', { className: 'setting-row-right', style: { display: 'flex', alignItems: 'center', gap: '8px' } }, control)
                )
            );

            const renderToggle = (label, desc, checked, onChange) => renderRow(
                label,
                desc,
                e('input', { type: 'checkbox', checked, onChange })
            );

            const renderSourceList = () => {
                const sourceEntries = getSourcePreferenceEntries(settingsState.sourcePreferenceList);
                const moveSource = (sourceId, direction) => {
                    const entries = getSourcePreferenceEntries(settingsState.sourcePreferenceList);
                    const currentIndex = entries.findIndex(entry => entry.id === sourceId);
                    if (currentIndex < 0) return;
                    const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
                    if (nextIndex < 0 || nextIndex >= entries.length) return;
                    const nextEntries = entries.slice();
                    [nextEntries[currentIndex], nextEntries[nextIndex]] = [nextEntries[nextIndex], nextEntries[currentIndex]];
                    commitSourcePreferenceList(serializeSourcePreferenceEntries(nextEntries));
                };
                const toggleSource = (sourceId, enabled) => {
                    const nextEntries = getSourcePreferenceEntries(settingsState.sourcePreferenceList).map(entry => (
                        entry.id === sourceId ? { ...entry, enabled } : entry
                    ));
                    commitSourcePreferenceList(serializeSourcePreferenceEntries(nextEntries));
                };
                const renderBadge = syncType => e(
                    'span',
                    {
                        style: {
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '2px 8px',
                            borderRadius: '999px',
                            backgroundColor: 'rgba(255,255,255,0.08)',
                            color: 'var(--spice-subtext)',
                            fontSize: '10px',
                            fontWeight: '600',
                            letterSpacing: '0.03em',
                            textTransform: 'uppercase'
                        }
                    },
                    SOURCE_SYNC_LABEL[syncType] || syncType
                );

                return e(
                    'div',
                    {
                        style: {
                            margin: '10px 0 14px',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: '8px',
                            overflow: 'hidden',
                            backgroundColor: 'rgba(255,255,255,0.02)'
                        }
                    },
                    e(
                        'div',
                        {
                            style: {
                                padding: '12px 14px',
                                borderBottom: '1px solid rgba(255,255,255,0.08)',
                                backgroundColor: 'rgba(255,255,255,0.03)'
                            }
                        },
                        e('div', { className: 'setting-name' }, 'Source Priority'),
                        e('div', { className: 'setting-description' }, 'Toggle and reorder internal Better Lyrics Engine sources.')
                    ),
                    sourceEntries.map((entry, index) => {
                        const config = SOURCE_CONFIG[entry.id];
                        if (!config) return null;
                        const unavailableReason = getSourceRuntimeUnavailableReason(settingsState, entry.id);
                        const statusText = unavailableReason ? `Currently unavailable: ${unavailableReason}` : '';
                        return e(
                            'div',
                            {
                                key: entry.id,
                                style: {
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '12px',
                                    padding: '12px 14px',
                                    borderBottom: index === sourceEntries.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.06)',
                                    opacity: entry.enabled ? 1 : 0.72
                                }
                            },
                            e(
                                'div',
                                { style: { minWidth: 0, flex: '1 1 auto' } },
                                e(
                                    'div',
                                    { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' } },
                                    e('div', { className: 'setting-name' }, config.label),
                                    renderBadge(config.syncType)
                                ),
                                e('div', { className: 'setting-description' }, config.description),
                                statusText
                                    ? e('div', { style: { marginTop: '4px', fontSize: '11px', color: 'var(--spice-subtext)' } }, statusText)
                                    : null
                            ),
                            e(
                                'div',
                                { style: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 } },
                                e(
                                    'button',
                                    {
                                        className: 'btn',
                                        disabled: index === 0,
                                        onClick: () => moveSource(entry.id, 'up'),
                                        style: { minWidth: '32px', padding: '4px 8px' }
                                    },
                                    '↑'
                                ),
                                e(
                                    'button',
                                    {
                                        className: 'btn',
                                        disabled: index === sourceEntries.length - 1,
                                        onClick: () => moveSource(entry.id, 'down'),
                                        style: { minWidth: '32px', padding: '4px 8px' }
                                    },
                                    '↓'
                                ),
                                e('input', {
                                    type: 'checkbox',
                                    checked: entry.enabled,
                                    onChange: event => toggleSource(entry.id, !!event.target.checked)
                                })
                            )
                        );
                    })
                );
            };

            const renderInput = (label, desc, value, onChange, onCommit, extraProps = {}) => renderRow(
                label,
                desc,
                e('input', {
                    type: extraProps.type || 'text',
                    value,
                    onChange,
                    onBlur: onCommit,
                    onKeyDown: event => { if (event.key === 'Enter') onCommit(); },
                    style: {
                        width: extraProps.width || '260px',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        border: '1px solid rgba(255,255,255,0.12)',
                        backgroundColor: 'rgba(0,0,0,0.2)',
                        color: 'var(--spice-text)',
                        fontSize: '12px',
                        fontFamily: extraProps.monospace ? 'monospace' : 'inherit'
                    }
                })
            );

            return e(
                'div',
                { className: 'option-list-wrapper' },
                renderToggle(
                    'Enable Cubey',
                    'Cubey priming fills Musixmatch metadata and can also backfill TTML/LRCLIB slots.',
                    settingsState.enableCubey,
                    event => commit('enable_cubey', !!event.target.checked)
                ),
                renderToggle(
                    'Spotify Reference Layer',
                    'Use Spotify official lyrics as text anchor, timing anchor, and final fallback.',
                    settingsState.enableSpotifyValidation,
                    event => commit('enable_spotify_validation', !!event.target.checked)
                ),
                renderToggle(
                    'Direct bLyrics Fallback',
                    'Use boidu TTML when Cubey did not already fill the bLyrics slots.',
                    settingsState.enableBLyricsDirect,
                    event => commit('enable_blyrics_direct', !!event.target.checked)
                ),
                renderToggle(
                    'Direct Legato Fallback',
                    'Use Legato/Kugou LRC as a later synced fallback.',
                    settingsState.enableLegatoDirect,
                    event => commit('enable_legato_direct', !!event.target.checked)
                ),
                renderToggle(
                    'Direct LRCLIB Fallback',
                    'Use LRCLIB exact/search fallback for synced/plain lyrics.',
                    settingsState.enableLrclibDirect,
                    event => commit('enable_lrclib_direct', !!event.target.checked)
                ),
                renderSourceList(),
                renderToggle(
                    'Auto Launch Helper',
                    'Attempt ivlyrics-cubey-helper://launch when helper mode is selected and health checks fail.',
                    settingsState.helperAutoLaunch,
                    event => commit('helper_auto_launch', !!event.target.checked)
                ),
                renderToggle(
                    'Auto Cubey Auth',
                    'Acquire JWT with Turnstile automatically in direct/manual modes when possible.',
                    settingsState.cubeyAutoAuth,
                    event => commit('cubey_auto_auth', !!event.target.checked)
                ),
                renderToggle(
                    'Debug Logging',
                    'Print orchestration and failure details to the browser console.',
                    settingsState.debug,
                    event => commit('debug', !!event.target.checked)
                ),
                renderRow(
                    'Transport Mode',
                    'Choose helper proxy, direct browser fetch, or manual JWT mode for Cubey.',
                    e(
                        'select',
                        {
                            value: settingsState.transportMode,
                            onChange: event => commit('transport_mode', event.target.value, { transportMode: event.target.value }),
                            style: {
                                width: '180px',
                                padding: '6px 10px',
                                borderRadius: '6px',
                                border: '1px solid rgba(255,255,255,0.12)',
                                backgroundColor: 'rgba(0,0,0,0.2)',
                                color: 'var(--spice-text)'
                            }
                        },
                        e('option', { value: TRANSPORT.HELPER }, 'helper'),
                        e('option', { value: TRANSPORT.DIRECT }, 'direct'),
                        e('option', { value: TRANSPORT.MANUAL }, 'manual')
                    )
                ),
                renderInput(
                    'Cubey Base URL',
                    'Lyrics API origin used for Turnstile/auth/bootstrap requests.',
                    settingsState.cubeyBaseUrl,
                    event => patchState({ cubeyBaseUrl: event.target.value }),
                    () => commitNormalizedUrl('cubey_base_url', 'cubeyBaseUrl', settingsState.cubeyBaseUrl)
                ),
                renderInput(
                    'Helper URL',
                    'Local cubey-helper endpoint. Default is http://127.0.0.1:15124.',
                    settingsState.helperUrl,
                    event => patchState({ helperUrl: event.target.value }),
                    () => commitNormalizedUrl('helper_url', 'helperUrl', settingsState.helperUrl)
                ),
                renderInput(
                    'Manual JWT Token',
                    'Used only in manual mode or as a fallback override.',
                    settingsState.cubeyManualToken,
                    event => commitRuntime('cubey_manual_token', 'cubeyManualToken', event.target.value),
                    () => commit('cubey_manual_token', settingsState.cubeyManualToken),
                    { type: 'password', width: '320px', monospace: true }
                ),
                renderInput(
                    'Request Timeout',
                    'HTTP timeout in milliseconds for direct fallback providers.',
                    String(settingsState.requestTimeoutMs),
                    event => patchState({ requestTimeoutMs: event.target.value }),
                    () => commitNumber('request_timeout_ms', 'requestTimeoutMs', settingsState.requestTimeoutMs, DEFAULT_TIMEOUT_MS),
                    { type: 'number', width: '120px', monospace: true }
                ),
                renderRow(
                    'Maintenance',
                    'Health/auth probes and Cubey auth reset for the merged Better Lyrics engine.',
                    e(
                        React.Fragment,
                        null,
                        e(
                            'button',
                            {
                                className: 'btn',
                                disabled: !!busyAction,
                                onClick: () => runAction('Helper Health', runHelperHealthProbe)
                            },
                            busyAction === 'Helper Health' ? 'Checking...' : 'Check Helper'
                        ),
                        e(
                            'button',
                            {
                                className: 'btn',
                                disabled: !!busyAction,
                                onClick: () => runAction('Helper Launch', runHelperLaunchProbe)
                            },
                            busyAction === 'Helper Launch' ? 'Launching...' : 'Launch Helper'
                        ),
                        e(
                            'button',
                            {
                                className: 'btn',
                                disabled: !!busyAction,
                                onClick: () => runAction('Cubey Auth', runCubeyAuthProbe)
                            },
                            busyAction === 'Cubey Auth' ? 'Authorizing...' : 'Auth Probe'
                        ),
                        e(
                            'button',
                            {
                                className: 'btn',
                                disabled: !!busyAction,
                                onClick: () => {
                                    const cleared = clearEngineStorage();
                                    notify(`Cleared ${cleared} auth entries`);
                                    setSettingsState(getRuntimeSettings());
                                }
                            },
                            'Clear Auth'
                        )
                    )
                )
            );
        };
    }

    const BetterLyricsEngineAddon = {
        ...ADDON_INFO,

        async init() {
            debugLog(`Initialized v${ADDON_INFO.version}`);
        },

        getSettingsUI,

        async getLyrics(info) {
            try {
                const trackId = getTrackId(info);
                const settings = getRuntimeSettings();
                const context = createSourceContext(info, trackId);
                const spotifyReferencePromise = settings.enableSpotifyValidation && trackId
                    ? fetchSpotifyReference(trackId, info).catch(() => null)
                    : Promise.resolve(null);

                await primeCubeyContext(context);
                const spotifyReference = await spotifyReferencePromise;
                initializeSpotifySourceState(context, settings, spotifyReference);

                const finalizeSelection = (candidate, sourceId, validation = {}) => {
                    const selected = annotateResultPayload(attachSharedMetadata(candidate, context) || candidate, {
                        selectedSource: sourceId,
                        spotifyCoverage: validation.coverage ?? null,
                        spotifyAligned: !!validation.alignedResult,
                        alignmentMode: validation.alignmentMode || (validation.alignedResult ? 'spotify-monotonic' : null),
                        validationState: validation.validationState || 'selected',
                        acquisitionState: context.sourceDiagnostics[sourceId]?.acquisitionState || 'selected',
                        textAnchorSource: validation.textAnchorSource || null
                    });
                    selected.sourceId = sourceId;
                    selected.selectedSource = sourceId;
                    const selectedLines = selected.karaoke || selected.synced || selected.unsynced || [];
                    selected.hasNativePhonetic = selectedLines.some(lineHasNativePhonetic);
                    selected.hasBackgroundVocals = selectedLines.some(lineHasBackgroundVocals);
                    if (validation.matchAmount !== null && validation.matchAmount !== undefined) selected.spotifySimilarity = validation.matchAmount;
                    if (validation.coverage !== null && validation.coverage !== undefined) selected.spotifyCoverage = validation.coverage;
                    if (spotifyReference?.syncType) selected.spotifyReferenceSyncType = spotifyReference.syncType;
                    selected.error = null;
                    return selected;
                };

                const selectionOrder = buildSelectionSteps(settings);

                for (const step of selectionOrder) {
                    if (step.kind === 'spotify-syllable') {
                        if (spotifyReference?.syncType === 'SYLLABLE_SYNCED' && hasLyricsPayload(spotifyReference.nativeResult)) {
                            return finalizeSelection(spotifyReference.nativeResult, SOURCE.SPOTIFY_SYLLABLE, {
                                matchAmount: 1,
                                coverage: 1
                            });
                        }
                        continue;
                    }

                    if (step.kind === 'spotify-line') {
                        if (spotifyReference?.syncType === 'LINE_SYNCED' && hasLyricsPayload(spotifyReference.nativeResult)) {
                            return finalizeSelection(spotifyReference.nativeResult, SOURCE.SPOTIFY_LINE, {
                                matchAmount: 1,
                                coverage: 1
                            });
                        }
                        continue;
                    }

                    if (step.kind === 'spotify-fallback') {
                        if (spotifyReference?.nativeResult && hasLyricsPayload(spotifyReference.nativeResult)) {
                            return finalizeSelection(spotifyReference.nativeResult, 'spotify-official-fallback', {
                                matchAmount: 1,
                                coverage: 1
                            });
                        }
                        continue;
                    }

                    const candidate = await getSourceLyrics(context, step.sourceKey);
                    if (!candidate || !hasLyricsPayload(candidate)) continue;
                    let validation = settings.enableSpotifyValidation
                        ? validateAgainstSpotifyReference(candidate, spotifyReference, step.sourceKey)
                        : {
                            accepted: true,
                            matchAmount: null,
                            coverage: null,
                            alignedResult: null,
                            alignmentMode: null,
                            validationState: 'selected',
                            textAnchorSource: null
                        };

                    if (
                        settings.enableSpotifyValidation
                        && candidate?.karaoke?.length
                        && !isSpotifyValidationExemptSource(step.sourceKey)
                        && (validation.validationState === 'retexted' || validation.validationState === 'alignment_rejected')
                    ) {
                        const karaokeTextAnchor = await resolvePreferredKaraokeTextAnchor(context, settings, spotifyReference, step.sourceKey);
                        if (karaokeTextAnchor) {
                            validation = validateAgainstSpotifyReference(candidate, spotifyReference, step.sourceKey, { karaokeTextAnchor });
                        }
                    }

                    if (!validation.accepted) {
                        setSourceDiagnostic(context, step.sourceKey, { acquisitionState: 'validation_rejected' });
                        context.rejections.push({
                            sourceKey: step.sourceKey,
                            matchAmount: validation.matchAmount,
                            coverage: validation.coverage
                        });
                        debugLogOnce(
                            `rejected:${trackId}:${step.sourceKey}`,
                            'Spotify reference rejected source',
                            step.sourceKey,
                            validation.matchAmount,
                            validation.coverage
                        );
                        continue;
                    }

                    let selectedCandidate = validation.alignedResult || candidate;

                    // Spotify-anchored Sync Grafting: when MXM richsync is
                    // selected and Spotify line reference is available, remap
                    // word timings onto Spotify's more accurate line timing.
                    if (
                        selectedCandidate?.karaoke?.length
                        && step.sourceKey === SOURCE.MUSIXMATCH_RICHSYNC
                        && spotifyReference?.synced?.length
                    ) {
                        const grafted = graftWordSyncOntoLineSync(selectedCandidate.karaoke, spotifyReference.synced);
                        if (grafted) {
                            selectedCandidate = deepCopy(selectedCandidate);
                            selectedCandidate.karaoke = grafted;
                            selectedCandidate.synced = buildSyncedFromKaraoke(grafted);
                            debugLog('Spotify-anchored Sync Grafting applied to MXM richsync');
                        }
                    }

                    setSourceDiagnostic(context, step.sourceKey, {
                        acquisitionState: validation.alignedResult ? 'selected' : (validation.validationState === 'alignment_rejected' ? 'alignment_rejected' : 'selected')
                    });
                    const selected = finalizeSelection(selectedCandidate, step.sourceKey, validation);
                    if (hasLyricsPayload(selected)) return selected;
                }

                const message = context.rejections.length > 0 && spotifyReference?.normalizedText
                    ? 'Spotify reference rejected all external candidates'
                    : formatFailureMessage(RuntimeState.lastFailure) || 'No lyrics found';
                return createFailureResult(info, message);
            } catch (error) {
                rememberFailure('engine', { reason: 'exception', message: error?.message || String(error) });
                return createFailureResult(info, error?.message || 'Better Lyrics engine failed');
            }
        }
    };

    function registerAddon() {
        const manager = getManager();
        if (!manager) {
            setTimeout(registerAddon, WAIT_RETRY_MS);
            return;
        }
        if (typeof manager.unregister === 'function' && manager.getAddon?.(ADDON_INFO.id)) {
            manager.unregister(ADDON_INFO.id);
        }
        manager.register(BetterLyricsEngineAddon);
        debugLog('Module registered');
    }

    registerAddon();

})();
