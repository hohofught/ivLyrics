/**
 * LRCLIB Lyrics Provider Addon
 * LRCLIB 오픈소스 가사 데이터베이스에서 가사를 제공합니다.
 *
 * @addon-type lyrics
 * @id lrclib
 * @name LRCLIB
 * @version 1.0.0
 * @author ivLis STUDIO
 * @supports karaoke: false (커뮤니티 sync-data를 통해 지원 가능)
 * @supports synced: true
 * @supports unsynced: true
 */

(() => {
    'use strict';

    // ============================================
    // Addon Metadata
    // ============================================

    const ADDON_INFO = {
        id: 'lrclib',
        name: 'LRCLIB',
        author: 'ivLis STUDIO',
        version: '1.0.0',
        description: {
            en: 'Get lyrics from LRCLIB open-source lyrics database',
            ko: 'LRCLIB 오픈소스 가사 데이터베이스에서 가사를 가져옵니다'
        },
        // 지원하는 가사 유형
        supports: {
            karaoke: false,   // 기본적으로 노래방 가사 미지원 (sync-data로 확장 가능)
            synced: true,     // 싱크 가사 지원
            unsynced: true    // 일반 가사 지원
        },
        // ivLyrics Sync 데이터 자동 적용 여부
        useIvLyricsSync: true,
        // 아이콘 (SVG path) - LRC 파일 아이콘
        icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM8 12h8v2H8v-2zm0 4h8v2H8v-2zm0-8h3v2H8V8z'
    };

    // ============================================
    // API Endpoints
    // ============================================

    const LRCLIB_API_BASE = 'https://lrclib.net/api';

    // ============================================
    // Helper Functions
    // ============================================

    /**
     * 문자열 정규화 (NFKC + 소문자 + 특수문자 제거)
     * @param {string} s - 원본 문자열
     * @returns {string} 정규화된 문자열
     */
    function normalize(s) {
        if (!s) return '';
        return s.normalize('NFKC').toLowerCase().trim()
            .replace(/[\u2018\u2019]/g, "'")
            .replace(/[\u201c\u201d]/g, '"')
            .replace(/[()\[\]{}]/g, '') // 괄호 제거로 검색 정확도 향상
            .replace(/\s+/g, ' ');      // 중복 공백 제거
    }

    /**
     * Jaro-Winkler 유사도 계산 (Elite Engineering Standard)
     * @param {string} s1 
     * @param {string} s2 
     * @returns {number} 0.0 ~ 1.0 (유사도)
     */
    function jaroWinkler(s1, s2) {
        s1 = normalize(s1);
        s2 = normalize(s2);

        if (!s1 || !s2) return 0;
        if (s1 === s2) return 1;

        const l1 = s1.length;
        const l2 = s2.length;
        const matchWindow = Math.floor(Math.max(l1, l2) / 2) - 1;
        const s1Matches = new Array(l1).fill(false);
        const s2Matches = new Array(l2).fill(false);

        let matches = 0;
        for (let i = 0; i < l1; i++) {
            const start = Math.max(0, i - matchWindow);
            const end = Math.min(i + matchWindow + 1, l2);
            for (let j = start; j < end; j++) {
                if (s2Matches[j]) continue;
                if (s1[i] === s2[j]) {
                    s1Matches[i] = true;
                    s2Matches[j] = true;
                    matches++;
                    break;
                }
            }
        }

        if (matches === 0) return 0;

        let t = 0;
        let k = 0;
        for (let i = 0; i < l1; i++) {
            if (!s1Matches[i]) continue;
            while (!s2Matches[k]) k++;
            if (s1[i] !== s2[k]) t++;
            k++;
        }
        t /= 2;

        const dj = (matches / l1 + matches / l2 + (matches - t) / matches) / 3;
        let prefix = 0;
        for (let i = 0; i < Math.min(l1, l2, 4); i++) {
            if (s1[i] === s2[i]) prefix++;
            else break;
        }

        return dj + prefix * 0.1 * (1 - dj);
    }

    /**
     * 타임아웃 + 1회 재시도 지원 Fetch
     * 네트워크 오류 시 500ms 후 1회 재시도, 모든 실패 시 null 반환 (에러 메시지 노출 방지)
     */
    async function fetchWithTimeout(url, options = {}, timeoutMs = 35000) {
        for (let attempt = 0; attempt < 2; attempt++) {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(url, { ...options, signal: controller.signal });
                clearTimeout(id);
                return response;
            } catch (error) {
                clearTimeout(id);
                if (attempt === 0) {
                    // 1회 재시도 전 500ms 대기
                    await new Promise(r => setTimeout(r, 500));
                    console.log(`[LR-DEBUG] 네트워크 오류, 재시도 중...`);
                }
            }
        }
        // 모든 재시도 실패 → null 반환 (fetch failed 메시지 노출 X)
        console.log(`[LR-DEBUG] 네트워크 재시도 실패, 스킵`);
        return null;
    }

    /**
     * 가사 커버리지 계산 (짤린 가사 감지)
     */
    function getLyricCoverage(syncedLyrics, totalDurationMs) {
        if (!syncedLyrics || !totalDurationMs || totalDurationMs <= 0) return 0;
        const lines = typeof syncedLyrics === 'string' ? syncedLyrics.trim().split('\n') : [];
        for (let i = lines.length - 1; i >= 0; i--) {
            const match = lines[i].match(/\[(\d+):(\d+(\.\d+)?)\]/);
            if (match) {
                const lastTimeMs = (parseInt(match[1]) * 60 + parseFloat(match[2])) * 1000;
                return Math.min(lastTimeMs / totalDurationMs, 1.2);
            }
        }
        return 0;
    }

    /**
     * LRC 형식 파싱 (Ultra-Flexible)
     */
    function parseLRC(lrc) {
        if (!lrc || typeof lrc !== 'string') return { synced: null, unsynced: [] };
        const lines = lrc.split('\n');
        const synced = [];
        const unsynced = [];

        for (const line of lines) {
            const match = line.match(/\[(\d+):(\d+)(?:[.,](\d+))?\](.*)/);
            if (match) {
                const minutes = parseInt(match[1], 10);
                const seconds = parseInt(match[2], 10);
                const msPart = match[3] ? parseFloat('0.' + match[3]) : 0;
                const startTime = Math.floor((minutes * 60 + seconds + msPart) * 1000);
                const text = match[4].trim();
                synced.push({ startTime, text });
                unsynced.push({ text });
            } else if (line.trim() && !line.startsWith('[')) {
                unsynced.push({ text: line.trim() });
            }
        }

        return { synced: synced.length > 0 ? synced : null, unsynced };
    }

    // ============================================
    // Addon Implementation
    // ============================================

    const LrclibLyricsAddon = {
        ...ADDON_INFO,

        /**
         * 초기화
         */
        async init() {
            // Initialization silent
        },

        /**
         * 설정 UI
         */
        getSettingsUI() {
            const React = Spicetify.React;

            return function LrclibLyricsSettings() {
                return React.createElement('div', { className: 'lyrics-addon-settings lrclib-settings' });
            };
        },

        /**
         * 가사 가져오기
         * @param {Object} info - 트랙 정보 { uri, title, artist, album, duration }
         * @returns {Promise<LyricsResult>}
         */
        async getLyrics(info) {
            const startTotal = performance.now();
            let startServer = 0, endServer = 0, startLogic = 0, endLogic = 0;
            let bestScore = 0, bestSync = 0, bestTitle = 0, bestArtist = 0;

            const logDebug = (msg, error = null) => {
                const endTotal = performance.now();
                console.log(`[LR-DEBUG] ========================================`);
                console.log(`[LR-DEBUG] Track: ${info.title} - ${info.artist}`);
                if (msg) console.log(`[LR-DEBUG] Status: ${msg}`);
                if (error) console.log(`[LR-DEBUG] Error: ${error}`);
                if (bestScore > 0) {
                    console.log(`[LR-DEBUG] Match Score: ${bestScore.toFixed(2)} (Sync: ${bestSync.toFixed(2)}, Title: ${bestTitle.toFixed(2)}, Artist: ${bestArtist.toFixed(2)})`);
                }
                if (startServer > 0 && endServer > 0) console.log(`[LR-DEBUG] Time - Server: ${(endServer - startServer).toFixed(2)}ms`);
                if (startLogic > 0 && endLogic > 0) console.log(`[LR-DEBUG] Time - Logic: ${(endLogic - startLogic).toFixed(2)}ms`);
                console.log(`[LR-DEBUG] Time - Total: ${(endTotal - startTotal).toFixed(2)}ms`);
                console.log(`[LR-DEBUG] ========================================`);
            };

            const result = {
                uri: info.uri,
                provider: 'lrclib',
                karaoke: null,
                synced: null,
                unsynced: null,
                copyright: null,
                error: null
            };

            const trackId = info.uri.split(':')[2];

            // ============================================
            // 3-Tier 하이브리드 검색 (Elite Engineering)
            // ============================================
            // Tier 1: 구조화 검색 (track_name + artist_name) - 가장 정확, CJK 최적
            // Tier 2: 제목 기반 폴백 (q=title) - 번역 제목 대응
            // Tier 3: 아티스트 기반 폴백 (q=artist) - 최후의 수단
            try {
                let tier = 1;
                const headers = { 'x-user-agent': `spicetify v${Spicetify.Config?.version || 'unknown'}` };
                let data = [];

                startServer = performance.now();

                // ─────────────────────────────────────────────────────────────
                // Tier 1: 구조화 검색 (가장 정확, 일본어/CJK 최적)
                // ─────────────────────────────────────────────────────────────
                let searchUrl = `${LRCLIB_API_BASE}/search?track_name=${encodeURIComponent(info.title)}&artist_name=${encodeURIComponent(info.artist)}`;
                let response = await fetchWithTimeout(searchUrl, { headers }, 35000);

                // null 체크 (네트워크 재시도 실패 시)
                if (!response) {
                    data = [];
                } else if (!response.ok) {
                    if (response.status === 429) {
                        result.error = 'Rate limit exceeded (429)';
                        logDebug('Failed', result.error);
                        return result;
                    }
                    if (response.status === 404) {
                        // 404는 결과 없음으로 간주, Tier 2로 폴백
                        data = [];
                    } else {
                        throw new Error(`API error: ${response.status}`);
                    }
                } else {
                    data = await response.json();
                }

                console.log(`[LR-DEBUG] T${tier}: 구조화 검색 → ${Array.isArray(data) ? data.length : 0}개 결과`);

                // ─────────────────────────────────────────────────────────────
                // Tier 2: 제목 기반 폴백 (번역 제목, 로마자 표기 대응)
                // ─────────────────────────────────────────────────────────────
                if (!Array.isArray(data) || data.length === 0) {
                    tier = 2;
                    searchUrl = `${LRCLIB_API_BASE}/search?q=${encodeURIComponent(info.title)}`;
                    response = await fetchWithTimeout(searchUrl, { headers }, 35000);

                    if (response && response.ok) {
                        data = await response.json();
                    }
                    console.log(`[LR-DEBUG] T${tier}: 제목 검색 → ${Array.isArray(data) ? data.length : 0}개 결과`);
                }

                // ─────────────────────────────────────────────────────────────
                // Tier 3: 아티스트 기반 폴백 (최후의 수단)
                // ─────────────────────────────────────────────────────────────
                if (!Array.isArray(data) || data.length === 0) {
                    tier = 3;
                    searchUrl = `${LRCLIB_API_BASE}/search?q=${encodeURIComponent(info.artist)}`;
                    response = await fetchWithTimeout(searchUrl, { headers }, 35000);

                    if (response && response.ok) {
                        data = await response.json();
                    }
                    console.log(`[LR-DEBUG] T${tier}: 아티스트 검색 → ${Array.isArray(data) ? data.length : 0}개 결과`);
                }

                endServer = performance.now();

                if (!Array.isArray(data) || data.length === 0) {
                    result.error = 'No lyrics found';
                    logDebug('Failed', result.error);
                    return result;
                }

                // Jaro-Winkler 및 Duration 기반 필터링 (tier 변수 전달)
                // ============================================
                // Best-of-N 선택 로직
                // ============================================
                startLogic = performance.now();

                const songDurationMs = info.duration || 0;
                const songDurationSec = songDurationMs / 1000;

                // ─────────────────────────────────────────────────────────────
                // [1단계] 데이터 전처리 및 품질 지표 계산
                // ─────────────────────────────────────────────────────────────
                const processed = data.map(item => {
                    const durationDiff = Math.abs(item.duration - songDurationSec);
                    const syncCoverage = getLyricCoverage(item.syncedLyrics, songDurationMs);

                    // 가사 밀도 계산 (시간 대비 줄 수)
                    const actualLines = item.plainLyrics?.split('\n').filter(l => l.trim()).length || 0;
                    const expectedLines = (item.duration / 60) * 12; // 1분당 12줄 기준
                    const densityRatio = expectedLines > 0 ? actualLines / expectedLines : 0;

                    // 쓰레기 판별 (극단적인 경우만)
                    const isShortSynced = item.syncedLyrics && syncCoverage < 0.5;
                    const isDensityTrash = !item.syncedLyrics && (densityRatio < 0.1 || densityRatio > 5);
                    const isTrash = isShortSynced || isDensityTrash;

                    // Raw 유사도 점수
                    const rawTitleScore = jaroWinkler(info.title, item.trackName);
                    const rawArtistScore = jaroWinkler(info.artist, item.artistName);

                    return {
                        ...item,
                        durationDiff,
                        syncCoverage,
                        densityRatio,
                        rawTitleScore,
                        rawArtistScore,
                        isTrash
                    };
                });

                // ─────────────────────────────────────────────────────────────
                // [2단계] 쓰레기 제거 (극단적인 경우만)
                // ─────────────────────────────────────────────────────────────
                const qualityPassed = processed.filter(item => !item.isTrash);

                if (qualityPassed.length === 0) {
                    result.error = 'No quality lyrics found';
                    logDebug('Failed', result.error);
                    return result;
                }

                // ─────────────────────────────────────────────────────────────
                // [3단계] 관대한 점수 평가
                // ─────────────────────────────────────────────────────────────
                const scored = qualityPassed.map(item => {
                    // Duration 점수 (±45초 기준, 더 관대)
                    const durationScore = Math.max(0, 1 - (item.durationDiff / 45));

                    // Title 점수 (관대한 스케일링: 0.5 이상이면 최소 0.7 보장)
                    const titleScore = item.rawTitleScore >= 0.5
                        ? 0.7 + (item.rawTitleScore - 0.5) * 0.6
                        : item.rawTitleScore * 1.4;

                    // Artist 점수 (관대한 스케일링: 0.3 이상이면 최소 0.5 보장)
                    const artistScore = item.rawArtistScore >= 0.3
                        ? 0.5 + (item.rawArtistScore - 0.3) * 0.71
                        : item.rawArtistScore * 1.67;

                    // Density 점수
                    const densityScore = Math.min(item.densityRatio, 1);

                    // Sync 보너스
                    const syncBonus = item.syncedLyrics ? 15 : 0;

                    // 토큰 검증 (아티스트 표기 차이 구제 + 커버곡 차단)
                    const queryTokens = info.artist.split(/[,、&·/]/).map(s => s.trim().toLowerCase()).filter(t => t.length >= 2);
                    const resultArtist = item.artistName.toLowerCase();
                    const hasTokenMatch = queryTokens.some(t => resultArtist.includes(t));

                    const tokenBonus = hasTokenMatch ? 10 : 0;
                    const artistPenalty = (!hasTokenMatch && item.rawArtistScore < 0.3) ? -15 : 0;

                    // Tier-aware 최종 점수 합산
                    let totalScore;
                    if (tier >= 2) {
                        // Tier 2/3: 폴백 검색 → duration + artist 중시 (title 불안정)
                        const durationMatch = item.durationDiff <= 2;
                        totalScore = durationMatch
                            ? (durationScore * 50) + (artistScore * 20) + syncBonus + 20  // duration 신뢰 보너스
                            : (durationScore * 50) + (titleScore * 7) + (artistScore * 30) + syncBonus;
                    } else {
                        // Tier 1: 구조화 검색 → 기존 균형 로직
                        totalScore = (durationScore * 30) + (titleScore * 40) + (artistScore * 10) +
                            (densityScore * 10) + tokenBonus + artistPenalty + syncBonus;
                    }

                    return { ...item, durationScore, titleScore, artistScore, densityScore, sync: item.syncCoverage, totalScore, tier };
                });

                // ─────────────────────────────────────────────────────────────
                // [4단계] 최종 선택
                // ─────────────────────────────────────────────────────────────
                scored.sort((a, b) => b.totalScore - a.totalScore);
                const body = scored[0];

                // Tier-aware 임계값 검증
                if (tier === 1) {
                    // Tier 1: 기존 엄격한 임계값 (Duration 20% + Title 40%)
                    if (body.durationScore < 0.2 || body.titleScore < 0.4) {
                        result.error = 'No matching lyrics';
                        logDebug(`Failed (T${tier})`, result.error);
                        return result;
                    }
                } else {
                    // Tier 2/3: Duration 페널티 + totalScore 검증
                    // 15초 초과 시 대폭 감점 (다른 곡 오염 방지)
                    const durationPenalty = body.durationDiff > 15 ? 50 : 0;
                    const adjustedScore = body.totalScore - durationPenalty;

                    if (adjustedScore < 40) {
                        result.error = body.durationDiff > 15
                            ? `Duration mismatch (${Math.round(body.durationDiff)}s diff)`
                            : 'Low confidence match';
                        logDebug(`Failed (T${tier})`, result.error);
                        return result;
                    }
                }

                endLogic = performance.now();

                // 계측용 스코어 캡처
                bestScore = body.totalScore;
                bestSync = body.sync;
                bestTitle = body.titleScore;
                bestArtist = body.artistScore;


                // Quality notification removed for production PR


                // Instrumental 체크
                if (body.instrumental) {
                    result.synced = [{ startTime: 0, text: '♪ Instrumental ♪' }];
                    result.unsynced = [{ text: '♪ Instrumental ♪' }];
                    logDebug('Success (Instrumental)');
                    return result;
                }

                // 싱크 가사 파싱 (Sync가 있으면 사용)
                if (body.syncedLyrics && body.sync > 0) {
                    const parsed = parseLRC(body.syncedLyrics);
                    result.synced = parsed.synced;
                    if (!result.unsynced) {
                        result.unsynced = parsed.unsynced;
                    }
                }
                // Plain 가사로 폴백
                else if (body.plainLyrics) {
                    result.unsynced = body.plainLyrics.split('\n').map(line => ({ text: line.trim() })).filter(l => l.text);
                }

                // 싱크가 없지만 plain이 있는 경우
                if (!result.synced && body.plainLyrics && !result.unsynced) {
                    result.unsynced = body.plainLyrics.split('\n').map(line => ({ text: line.trim() })).filter(l => l.text);
                }

                if (!result.synced && !result.unsynced) {
                    result.error = 'No lyrics';
                }

                logDebug(result.error ? 'Failure' : `Success (T${tier})`);
                return result;
            } catch (e) {
                result.error = e.message;
                logDebug('Fatal Error', e.message);
                return result;
            }

        }
    };

    // ============================================
    // Registration
    // ============================================

    const registerAddon = () => {
        if (window.LyricsAddonManager) {
            window.LyricsAddonManager.register(LrclibLyricsAddon);
        } else {
            setTimeout(registerAddon, 100);
        }
    };

    registerAddon();
})();
