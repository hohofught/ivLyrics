/**
 * ================================================================================
 * LRCLIB Lyrics Provider Addon
 * ================================================================================
 * 
 * 이 파일은 LRCLIB(https://lrclib.net) 오픈소스 가사 데이터베이스에서 
 * 가사를 검색하고 가져오는 Spicetify 애드온입니다.
 * 
 * 【주요 기능】
 * - 3-Tier 하이브리드 검색 시스템 (구조화 → 제목 → 아티스트 순차 폴백)
 * - Jaro-Winkler 알고리즘 기반 문자열 유사도 매칭
 * - 재생 시간(Duration) 기반 정확도 검증
 * - 싱크 가사(LRC 형식) 및 일반 텍스트 가사 지원
 * - 네트워크 오류 시 자동 재시도 메커니즘
 * 
 * 【검색 전략】
 * - Tier 1: track_name + artist_name 파라미터 사용 (가장 정확, CJK 문자 최적화)
 * - Tier 2: q=title 파라미터 사용 (번역된 제목, 로마자 표기 대응)
 * - Tier 3: q=artist 파라미터 사용 (최후의 수단)
 *
 * @addon-type lyrics        - 가사 제공자 타입의 애드온
 * @id lrclib               - 고유 식별자
 * @name LRCLIB             - 표시 이름
 * @version 1.0.0           - 버전 정보
 * @author ivLis STUDIO     - 제작자
 * @supports karaoke: false - 노래방 모드 미지원 (커뮤니티 sync-data 확장으로 지원 가능)
 * @supports synced: true   - 시간 동기화된 가사 지원
 * @supports unsynced: true - 시간 동기화 없는 일반 가사 지원
 */

// ================================================================================
// IIFE (Immediately Invoked Function Expression) 패턴
// ================================================================================
// 전역 스코프 오염을 방지하고, 모든 변수와 함수를 캡슐화합니다.
// 애드온 로드 시 즉시 실행되어 LyricsAddonManager에 자신을 등록합니다.
(() => {
    'use strict';  // 엄격 모드 활성화: 잠재적 오류를 사전에 방지

    // ============================================
    // Addon Metadata (애드온 메타데이터)
    // ============================================
    // LyricsAddonManager가 이 애드온을 식별하고 관리하는 데 사용하는 정보입니다.
    // UI에 표시되는 이름, 설명, 아이콘 등이 포함됩니다.

    const ADDON_INFO = {
        id: 'lrclib',           // 【고유 ID】 다른 애드온과 구분하기 위한 식별자
        name: 'LRCLIB',         // 【표시 이름】 UI에 표시되는 애드온 이름
        author: 'ivLis STUDIO', // 【제작자】 애드온 개발자 정보
        version: '1.0.0',       // 【버전】 시맨틱 버저닝 (Major.Minor.Patch)

        // 【다국어 설명】 사용자 언어 설정에 따라 표시
        description: {
            en: 'Get lyrics from LRCLIB open-source lyrics database',
            ko: 'LRCLIB 오픈소스 가사 데이터베이스에서 가사를 가져옵니다'
        },

        // 【지원 가사 유형】 이 애드온이 제공할 수 있는 가사 형식
        supports: {
            karaoke: false,   // 노래방 모드 (단어별 하이라이트) - 현재 미지원
            synced: true,     // 싱크 가사 (타임스탬프 포함 LRC 형식) - 지원
            unsynced: true    // 일반 가사 (텍스트만) - 지원
        },

        // 【ivLyrics Sync 통합】 true면 커뮤니티 싱크 데이터 자동 적용
        useIvLyricsSync: true,

        // 【아이콘】 SVG path 데이터 - LRC 파일을 나타내는 문서 아이콘
        icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM8 12h8v2H8v-2zm0 4h8v2H8v-2zm0-8h3v2H8V8z'
    };

    // ============================================
    // API Endpoints (API 엔드포인트)
    // ============================================
    // LRCLIB 서버의 기본 API 주소입니다.
    // 모든 API 요청은 이 주소를 기반으로 구성됩니다.
    // 
    // 【사용 가능한 엔드포인트】
    // - GET /api/search?track_name=...&artist_name=... : 구조화된 검색
    // - GET /api/search?q=... : 자유 텍스트 검색
    // - GET /api/get?...      : 특정 가사 직접 조회

    const LRCLIB_API_BASE = 'https://lrclib.net/api';

    // ============================================
    // Helper Functions (헬퍼 함수)
    // ============================================
    // 가사 검색 및 매칭에 필요한 유틸리티 함수들입니다.
    // 문자열 정규화, 유사도 계산, 네트워크 요청, 가사 파싱 등을 담당합니다.

    /**
     * ────────────────────────────────────────────────────────────────────────────
     * 문자열 정규화 함수 (normalize)
     * ────────────────────────────────────────────────────────────────────────────
     * 
     * 【목적】
     * 서로 다른 형식의 문자열을 비교하기 위해 통일된 형태로 변환합니다.
     * 예: "Hello  World" vs "hello world" → 동일하게 처리
     * 
     * 【정규화 단계】
     * 1. NFKC 유니코드 정규화 - 호환 문자를 표준 형태로 통일
     *    예: ＡＢＣ(전각) → ABC(반각), ｶﾅ(반각) → カナ(전각)
     * 2. 소문자 변환 - 대소문자 구분 제거
     * 3. 양끝 공백 제거 (trim)
     * 4. 스마트 따옴표를 일반 따옴표로 변환
     *    예: '' "" → ' "
     * 5. 모든 종류의 괄호 제거 - 부가 정보(feat., remix 등) 무시
     * 6. 연속 공백을 단일 공백으로 치환
     * 
     * @param {string} s - 정규화할 원본 문자열
     * @returns {string} 정규화된 문자열 (비어있으면 빈 문자열 반환)
     */
    function normalize(s) {
        if (!s) return '';  // null/undefined 처리
        return s.normalize('NFKC')       // 유니코드 NFKC 정규화
            .toLowerCase()               // 소문자 변환
            .trim()                      // 앞뒤 공백 제거
            .replace(/[\u2018\u2019]/g, "'")   // ''(스마트 작은따옴표) → '
            .replace(/[\u201c\u201d]/g, '"')   // ""(스마트 큰따옴표) → "
            .replace(/[()[\]{}]/g, '')   // 모든 괄호류 제거: () [] {}
            .replace(/\s+/g, ' ');       // 연속 공백 → 단일 공백
    }

    /**
     * ────────────────────────────────────────────────────────────────────────────
     * Jaro-Winkler 유사도 계산 함수
     * ────────────────────────────────────────────────────────────────────────────
     * 
     * 【알고리즘 개요】
     * Jaro-Winkler는 두 문자열 간의 유사도를 0.0 ~ 1.0 사이 값으로 반환합니다.
     * 특히 짧은 문자열이나 오타 검출에 효과적이며, 제목/아티스트 매칭에 적합합니다.
     * 
     * 【계산 과정】
     * 1단계: Jaro 유사도 (dj) 계산
     *   - 일치 윈도우 = max(len1, len2) / 2 - 1
     *   - 윈도우 내에서 일치하는 문자 수 계산
     *   - 순서가 다른 일치(transposition) 계산
     *   - dj = (m/l1 + m/l2 + (m-t)/m) / 3
     * 
     * 2단계: Winkler 보정
     *   - 공통 접두사(최대 4자)에 가중치 부여
     *   - 최종 점수 = dj + prefix * 0.1 * (1 - dj)
     * 
     * 【예시】
     * - "MARTHA" vs "MARHTA" → 약 0.96 (철자 오류에도 높은 유사도)
     * - "DWAYNE" vs "DUANE" → 약 0.84
     * - "ABC" vs "XYZ" → 0.0 (완전 불일치)
     * 
     * @param {string} s1 - 비교할 첫 번째 문자열
     * @param {string} s2 - 비교할 두 번째 문자열
     * @returns {number} 유사도 점수 (0.0 = 완전 불일치, 1.0 = 완전 일치)
     */
    function jaroWinkler(s1, s2) {
        // 먼저 두 문자열을 정규화하여 공정한 비교 수행
        s1 = normalize(s1);
        s2 = normalize(s2);

        // Edge case 처리
        if (!s1 || !s2) return 0;  // 빈 문자열은 유사도 0
        if (s1 === s2) return 1;   // 완전 일치는 유사도 1

        const l1 = s1.length;  // 첫 번째 문자열 길이
        const l2 = s2.length;  // 두 번째 문자열 길이

        // 【일치 윈도우 계산】
        // 두 문자가 "일치"로 간주되려면 위치 차이가 윈도우 이내여야 함
        const matchWindow = Math.floor(Math.max(l1, l2) / 2) - 1;

        // 각 문자열에서 어떤 문자가 일치로 표시되었는지 추적
        const s1Matches = new Array(l1).fill(false);
        const s2Matches = new Array(l2).fill(false);

        // 【1단계: 일치하는 문자 찾기】
        let matches = 0;
        for (let i = 0; i < l1; i++) {
            // 현재 문자 s1[i]와 일치할 수 있는 s2의 범위 계산
            const start = Math.max(0, i - matchWindow);
            const end = Math.min(i + matchWindow + 1, l2);

            for (let j = start; j < end; j++) {
                if (s2Matches[j]) continue;  // 이미 매칭된 문자는 스킵
                if (s1[i] === s2[j]) {
                    s1Matches[i] = true;
                    s2Matches[j] = true;
                    matches++;
                    break;  // 이 문자에 대한 매칭 완료
                }
            }
        }

        // 일치하는 문자가 하나도 없으면 유사도 0
        if (matches === 0) return 0;

        // 【2단계: Transposition(순서 차이) 계산】
        // 일치한 문자들의 순서가 다른 경우를 계산
        let t = 0;  // transposition 카운트
        let k = 0;  // s2에서의 현재 위치
        for (let i = 0; i < l1; i++) {
            if (!s1Matches[i]) continue;  // 일치하지 않은 문자는 스킵
            while (!s2Matches[k]) k++;     // s2에서 다음 일치 문자 찾기
            if (s1[i] !== s2[k]) t++;       // 순서가 다르면 transposition
            k++;
        }
        t /= 2;  // transposition은 쌍으로 계산되므로 2로 나눔

        // 【3단계: Jaro 유사도 계산】
        // dj = (일치율_s1 + 일치율_s2 + 순서일치율) / 3
        const dj = (matches / l1 + matches / l2 + (matches - t) / matches) / 3;

        // 【4단계: Winkler 보정 - 공통 접두사 가중치】
        // 앞부분이 같으면 추가 점수 (최대 4자까지만 고려)
        let prefix = 0;
        for (let i = 0; i < Math.min(l1, l2, 4); i++) {
            if (s1[i] === s2[i]) prefix++;
            else break;  // 첫 불일치에서 중단
        }

        // 최종 Jaro-Winkler 점수 반환
        // 접두사가 같을수록 점수가 높아짐 (최대 0.1 * 4 = 0.4 보너스)
        return dj + prefix * 0.1 * (1 - dj);
    }

    /**
     * ────────────────────────────────────────────────────────────────────────────
     * 타임아웃 및 재시도 지원 Fetch 함수
     * ────────────────────────────────────────────────────────────────────────────
     * 
     * 【목적】
     * 네트워크 요청에 타임아웃을 적용하고, 실패 시 자동으로 1회 재시도합니다.
     * LRCLIB 서버의 간헐적 장애나 네트워크 불안정에 대응합니다.
     * 
     * 【동작 방식】
     * 1. AbortController를 사용하여 타임아웃 구현
     * 2. 첫 번째 시도 실패 시 500ms 대기 후 재시도
     * 3. 재시도도 실패하면 null 반환 (에러 throw 대신)
     * 
     * 【설계 결정】
     * - null 반환: UI에 에러 메시지를 노출하지 않기 위함
     * - 500ms 대기: 서버 부하 완화 및 네트워크 복구 시간 확보
     * - 35초 타임아웃: LRCLIB 서버 응답 시간을 고려한 값
     * 
     * @param {string} url - 요청할 URL
     * @param {Object} options - fetch 옵션 (headers 등)
     * @param {number} timeoutMs - 타임아웃 시간 (기본 35초)
     * @returns {Promise<Response|null>} Response 객체 또는 실패 시 null
     */
    async function fetchWithTimeout(url, options = {}, timeoutMs = 35000) {
        // 최대 2회 시도 (첫 시도 + 1회 재시도)
        for (let attempt = 0; attempt < 2; attempt++) {
            // AbortController: fetch 요청을 강제 중단할 수 있게 해주는 Web API
            const controller = new AbortController();

            // 타임아웃 설정: timeoutMs 후 요청 강제 중단
            const id = setTimeout(() => controller.abort(), timeoutMs);

            try {
                // fetch 요청 실행 (signal 연결로 abort 가능하게 함)
                const response = await fetch(url, { ...options, signal: controller.signal });
                clearTimeout(id);  // 성공 시 타임아웃 타이머 정리
                return response;   // 응답 반환 (성공)
            } catch (error) {
                clearTimeout(id);  // 실패 시에도 타이머 정리

                if (attempt === 0) {
                    // 첫 번째 시도 실패: 500ms 대기 후 재시도
                    await new Promise(r => setTimeout(r, 500));
                    window.__ivLyricsDebugLog?.(`[LR-DEBUG] 네트워크 오류, 재시도 중...`);
                }
                // attempt === 1이면 재시도도 실패 → 루프 종료
            }
        }

        // 모든 재시도 실패 → null 반환 (에러 메시지 노출 방지)
        window.__ivLyricsDebugLog?.(`[LR-DEBUG] 네트워크 재시도 실패, 스킵`);
        return null;
    }

    /**
     * ────────────────────────────────────────────────────────────────────────────
     * 가사 커버리지 계산 함수
     * ────────────────────────────────────────────────────────────────────────────
     * 
     * 【목적】
     * 싱크 가사가 곡의 얼마만큼을 커버하는지 계산합니다.
     * 이를 통해 "짤린 가사"나 "불완전한 가사"를 감지합니다.
     * 
     * 【계산 방법】
     * 1. 가사의 마지막 타임스탬프를 추출
     * 2. (마지막 타임스탬프 / 곡 전체 길이)로 커버리지 계산
     * 3. 결과는 0.0 ~ 1.2 범위로 클램핑
     * 
     * 【반환값 해석】
     * - 0.0: 타임스탬프 없음 또는 계산 불가
     * - 0.5: 곡의 절반만 커버 (불완전한 가사)
     * - 1.0: 곡 전체를 커버
     * - >1.0: 가사가 곡보다 길거나 메타데이터 오류
     * 
     * @param {string} syncedLyrics - LRC 형식의 싱크 가사 문자열
     * @param {number} totalDurationMs - 곡의 전체 길이 (밀리초)
     * @returns {number} 커버리지 비율 (0.0 ~ 1.2)
     */
    function getLyricCoverage(syncedLyrics, totalDurationMs) {
        // 유효성 검사: 가사나 길이 정보가 없으면 0 반환
        if (!syncedLyrics || !totalDurationMs || totalDurationMs <= 0) return 0;

        // 가사를 줄 단위로 분리
        const lines = typeof syncedLyrics === 'string' ? syncedLyrics.trim().split('\n') : [];

        // 뒤에서부터 탐색하여 마지막 타임스탬프 찾기 (효율성)
        for (let i = lines.length - 1; i >= 0; i--) {
            // LRC 타임스탬프 패턴: [MM:SS.xx] 또는 [MM:SS]
            const match = lines[i].match(/\[(\d+):(\d+(\.\d+)?)\]/);
            if (match) {
                // 마지막 타임스탬프를 밀리초로 변환
                const lastTimeMs = (parseInt(match[1]) * 60 + parseFloat(match[2])) * 1000;
                // 커버리지 계산 (1.2를 상한으로 클램핑)
                return Math.min(lastTimeMs / totalDurationMs, 1.2);
            }
        }
        return 0;  // 타임스탬프를 찾지 못함
    }

    /**
     * ────────────────────────────────────────────────────────────────────────────
     * LRC 형식 파싱 함수 (Ultra-Flexible)
     * ────────────────────────────────────────────────────────────────────────────
     * 
     * 【목적】
     * LRC(Lyrics) 형식의 문자열을 파싱하여 구조화된 가사 객체로 변환합니다.
     * 
     * 【LRC 형식 예시】
     * [00:12.34]첫 번째 가사
     * [00:15.67]두 번째 가사
     * [01:00,89]쉼표 구분자도 지원
     * 
     * 【지원하는 형식】
     * - [MM:SS.xx] 또는 [MM:SS,xx]: 밀리초 포함
     * - [MM:SS]: 밀리초 없는 형식
     * - 타임스탬프 없는 일반 텍스트도 unsynced에 포함
     * 
     * 【반환 객체 구조】
     * {
     *   synced: [{ startTime: 12340, text: "첫 번째 가사" }, ...] 또는 null,
     *   unsynced: [{ text: "첫 번째 가사" }, ...]
     * }
     * 
     * @param {string} lrc - LRC 형식의 가사 문자열
     * @returns {Object} { synced: Array|null, unsynced: Array }
     */
    function parseLRC(lrc) {
        // 입력 유효성 검사
        if (!lrc || typeof lrc !== 'string') return { synced: null, unsynced: [] };

        const lines = lrc.split('\n');  // 줄 단위로 분리
        const synced = [];    // 타임스탬프가 있는 가사
        const unsynced = [];  // 텍스트만 있는 가사

        for (const line of lines) {
            // LRC 타임스탬프 패턴 매칭
            // 그룹: [1]=분, [2]=초, [3]=밀리초(선택), [4]=가사 텍스트
            const match = line.match(/\[(\d+):(\d+)(?:[.,](\d+))?\](.*)/);

            if (match) {
                // 타임스탬프가 있는 경우
                const minutes = parseInt(match[1], 10);    // 분
                const seconds = parseInt(match[2], 10);    // 초
                const msPart = match[3] ? parseFloat('0.' + match[3]) : 0;  // 밀리초 부분

                // 시작 시간을 밀리초로 변환
                const startTime = Math.floor((minutes * 60 + seconds + msPart) * 1000);
                const text = match[4].trim();  // 가사 텍스트 (공백 제거)

                synced.push({ startTime, text });  // 싱크 가사에 추가
                unsynced.push({ text });           // 일반 가사에도 추가
            } else if (line.trim() && !line.startsWith('[')) {
                // 타임스탬프 없는 일반 텍스트 (메타데이터 태그 제외)
                unsynced.push({ text: line.trim() });
            }
        }

        // synced가 비어있으면 null로 반환
        return { synced: synced.length > 0 ? synced : null, unsynced };
    }

    // ============================================
    // Addon Implementation (애드온 구현부)
    // ============================================
    // LyricsAddonManager에 등록될 실제 애드온 객체입니다.
    // ADDON_INFO를 스프레드하여 메타데이터를 포함하고,
    // init(), getSettingsUI(), getLyrics() 메서드를 구현합니다.

    const LrclibLyricsAddon = {
        ...ADDON_INFO,  // 메타데이터 병합 (id, name, version 등)

        /**
         * 【초기화 메서드】
         * 애드온이 로드될 때 호출됩니다.
         * 현재는 특별한 초기화 작업이 없어 비어있습니다.
         * 필요시 캐시 초기화, 설정 로드 등을 추가할 수 있습니다.
         */
        async init() {
            // Initialization silent (초기화 시 로그 출력 안 함)
        },

        /**
         * 【설정 UI 메서드】
         * 사용자 설정 화면에 표시될 React 컴포넌트를 반환합니다.
         * 현재는 빈 컨테이너만 반환 (설정 항목 없음)
         * 
         * @returns {Function} React 함수형 컴포넌트
         */
        getSettingsUI() {
            const React = Spicetify.React;  // Spicetify 내장 React 사용

            // 빈 설정 컨테이너 반환
            return function LrclibLyricsSettings() {
                return React.createElement('div', { className: 'lyrics-addon-settings lrclib-settings' });
            };
        },

        /**
         * ────────────────────────────────────────────────────────────────────────────
         * 가사 가져오기 메서드 (getLyrics) - 핵심 메서드
         * ────────────────────────────────────────────────────────────────────────────
         * 
         * 【목적】
         * Spotify에서 재생 중인 트랙의 가사를 LRCLIB API에서 검색하여 반환합니다.
         * 
         * 【입력 파라미터】
         * @param {Object} info - 트랙 정보 객체
         *   - uri: Spotify URI (예: "spotify:track:abc123")
         *   - title: 곡 제목
         *   - artist: 아티스트 이름
         *   - album: 앨범 이름 (사용 안 함)
         *   - duration: 곡 길이 (밀리초)
         * 
         * 【반환값】
         * @returns {Promise<LyricsResult>} 가사 결과 객체
         *   - uri: 트랙 URI
         *   - provider: 'lrclib'
         *   - karaoke: 노래방 가사 (현재 null)
         *   - synced: 싱크 가사 배열 또는 null
         *   - unsynced: 일반 가사 배열 또는 null
         *   - copyright: 저작권 정보 (현재 null)
         *   - error: 에러 메시지 또는 null
         * 
         * 【검색 전략】
         * 3-Tier 하이브리드 검색 + Best-of-N 선택 알고리즘 적용
         */
        async getLyrics(info) {
            // ════════════════════════════════════════════════════════════════
            // 성능 측정용 변수 초기화
            // ════════════════════════════════════════════════════════════════
            const startTotal = performance.now();  // 전체 소요 시간 측정 시작
            let startServer = 0, endServer = 0;    // 서버 API 호출 시간
            let startLogic = 0, endLogic = 0;      // 매칭 로직 처리 시간
            let bestScore = 0, bestSync = 0, bestTitle = 0, bestArtist = 0;  // 최종 선택된 결과의 점수들

            /**
             * 【디버그 로깅 함수】
             * 검색 결과와 성능 지표를 콘솔에 출력합니다.
             * 개발 및 디버깅 시 유용한 정보를 제공합니다.
             * 
             * @param {string} msg - 상태 메시지 (Success, Failed 등)
             * @param {string|null} error - 에러 메시지 (있는 경우)
             */
            const logDebug = (msg, error = null) => {
                const endTotal = performance.now();
                window.__ivLyricsDebugLog?.(`[LR-DEBUG] ========================================`);
                window.__ivLyricsDebugLog?.(`[LR-DEBUG] Track: ${info.title} - ${info.artist}`);
                if (msg) window.__ivLyricsDebugLog?.(`[LR-DEBUG] Status: ${msg}`);
                if (error) window.__ivLyricsDebugLog?.(`[LR-DEBUG] Error: ${error}`);
                if (bestScore > 0) {
                    // 매칭 점수 상세 출력 (디버깅용)
                    window.__ivLyricsDebugLog?.(`[LR-DEBUG] Match Score: ${bestScore.toFixed(2)} (Sync: ${bestSync.toFixed(2)}, Title: ${bestTitle.toFixed(2)}, Artist: ${bestArtist.toFixed(2)})`);
                }
                // 성능 지표 출력
                if (startServer > 0 && endServer > 0) window.__ivLyricsDebugLog?.(`[LR-DEBUG] Time - Server: ${(endServer - startServer).toFixed(2)}ms`);
                if (startLogic > 0 && endLogic > 0) window.__ivLyricsDebugLog?.(`[LR-DEBUG] Time - Logic: ${(endLogic - startLogic).toFixed(2)}ms`);
                window.__ivLyricsDebugLog?.(`[LR-DEBUG] Time - Total: ${(endTotal - startTotal).toFixed(2)}ms`);
                window.__ivLyricsDebugLog?.(`[LR-DEBUG] ========================================`);
            };

            // ════════════════════════════════════════════════════════════════
            // 결과 객체 초기화
            // ════════════════════════════════════════════════════════════════
            // 모든 필드를 null로 초기화하고, 성공/실패에 따라 채워나감
            const result = {
                uri: info.uri,         // 요청한 트랙의 Spotify URI
                provider: 'lrclib',    // 가사 제공자 식별자
                karaoke: null,         // 노래방 가사 (단어별 하이라이트) - 미지원
                synced: null,          // 싱크 가사 배열 [{startTime, text}, ...]
                unsynced: null,        // 일반 가사 배열 [{text}, ...]
                copyright: null,       // 저작권 정보 - LRCLIB은 제공 안 함
                error: null            // 에러 발생 시 메시지
            };

            // 트랙 ID 추출 (현재는 사용하지 않지만 향후 캐싱 등에 활용 가능)
            const trackId = info.uri.split(':')[2];

            // ════════════════════════════════════════════════════════════════
            // 3-Tier 하이브리드 검색 (Elite Engineering)
            // ════════════════════════════════════════════════════════════════
            // 【검색 전략 개요】
            // LRCLIB API의 특성과 다양한 메타데이터 표기 방식에 대응하기 위해
            // 3단계 폴백 검색 전략을 사용합니다.
            //
            // Tier 1: 구조화 검색 (track_name + artist_name)
            //   - 가장 정확한 검색 방식
            //   - 일본어/한국어/중국어(CJK) 문자에 최적화
            //   - API가 제목과 아티스트를 별도 필드로 인식
            //
            // Tier 2: 제목 기반 폴백 (q=title)
            //   - Tier 1 실패 시 사용
            //   - 번역된 제목이나 로마자 표기(romaji) 대응
            //   - Spotify 제목이 LRCLIB과 다른 형식일 때 유용
            //
            // Tier 3: 아티스트 기반 폴백 (q=artist)
            //   - 최후의 수단
            //   - 아티스트 전체 곡 목록에서 Duration 매칭으로 찾기
            // ════════════════════════════════════════════════════════════════
            try {
                let tier = 1;  // 현재 검색 Tier (1, 2, 3)

                // API 요청 헤더: Spicetify 버전 정보 포함 (서버 분석용)
                const headers = { 'x-user-agent': `spicetify v${Spicetify.Config?.version || 'unknown'}` };
                let data = [];  // API 응답 데이터 (검색 결과 배열)

                startServer = performance.now();  // 서버 응답 시간 측정 시작

                // ─────────────────────────────────────────────────────────────
                // 【Tier 1】 구조화 검색 (가장 정확, 일본어/CJK 최적)
                // ─────────────────────────────────────────────────────────────
                // track_name과 artist_name을 별도 파라미터로 전달
                // 서버가 각 필드를 개별적으로 매칭하여 정확도가 높음
                let searchUrl = `${LRCLIB_API_BASE}/search?track_name=${encodeURIComponent(info.title)}&artist_name=${encodeURIComponent(info.artist)}`;
                let response = await fetchWithTimeout(searchUrl, { headers }, 35000);

                // 네트워크 재시도 실패 시 (fetchWithTimeout이 null 반환)
                if (!response) {
                    data = [];  // 빈 결과로 다음 Tier 진행
                } else if (!response.ok) {
                    // HTTP 에러 코드 처리
                    if (response.status === 429) {
                        // Rate Limit: 너무 많은 요청 → 즉시 반환
                        result.error = 'Rate limit exceeded (429)';
                        logDebug('Failed', result.error);
                        return result;
                    }
                    if (response.status === 404) {
                        // 404는 "결과 없음"으로 간주 → Tier 2로 폴백
                        data = [];
                    } else {
                        // 기타 서버 에러 → 예외 발생
                        throw new Error(`API error: ${response.status}`);
                    }
                } else {
                    // 성공: JSON 파싱
                    data = await response.json();
                }

                window.__ivLyricsDebugLog?.(`[LR-DEBUG] T${tier}: 구조화 검색 → ${Array.isArray(data) ? data.length : 0}개 결과`);

                // ─────────────────────────────────────────────────────────────
                // 【Tier 2】 제목 기반 폴백 (번역 제목, 로마자 표기 대응)
                // ─────────────────────────────────────────────────────────────
                // Tier 1에서 결과가 없으면 제목만으로 검색
                // 예: Spotify "花に亡霊" → LRCLIB "Hana ni Bourei"
                if (!Array.isArray(data) || data.length === 0) {
                    tier = 2;
                    searchUrl = `${LRCLIB_API_BASE}/search?q=${encodeURIComponent(info.title)}`;
                    response = await fetchWithTimeout(searchUrl, { headers }, 35000);

                    if (response && response.ok) {
                        data = await response.json();
                    }
                    window.__ivLyricsDebugLog?.(`[LR-DEBUG] T${tier}: 제목 검색 → ${Array.isArray(data) ? data.length : 0}개 결과`);
                }

                // ─────────────────────────────────────────────────────────────
                // 【Tier 3】 아티스트 기반 폴백 (최후의 수단)
                // ─────────────────────────────────────────────────────────────
                // T3 검색 + 토큰 필터 공통 함수 (T2 필터 후 폴백에서도 재사용)
                // q=artist 검색 후 결과의 artistName에 입력 토큰이 포함된 항목만 유지
                const searchT3WithTokenFilter = async (label) => {
                    const url = `${LRCLIB_API_BASE}/search?q=${encodeURIComponent(info.artist)}`;
                    const res = await fetchWithTimeout(url, { headers }, 35000);
                    let results = [];
                    if (res && res.ok) results = await res.json();
                    window.__ivLyricsDebugLog?.(`[LR-DEBUG] ${label}: 아티스트 검색 → ${Array.isArray(results) ? results.length : 0}개 결과`);

                    if (Array.isArray(results) && results.length > 0) {
                        const tokens = info.artist.split(/[,、&·/\s]+/).map(s => s.trim().toLowerCase()).filter(t => t.length >= 2);
                        const before = results.length;
                        results = results.filter(item => {
                            const ra = (item.artistName || '').toLowerCase();
                            return tokens.some(t => ra.includes(t));
                        });
                        if (results.length !== before) {
                            window.__ivLyricsDebugLog?.(`[LR-DEBUG] ${label}: 토큰 필터 → ${before}개 → ${results.length}개 (토큰: ${tokens.join(', ')})`);
                        }
                    }
                    return Array.isArray(results) ? results : [];
                };

                if (!Array.isArray(data) || data.length === 0) {
                    tier = 3;
                    data = await searchT3WithTokenFilter('T3');
                }

                // ─────────────────────────────────────────────────────────────
                // 【T2 스크립트 인식 아티스트 필터】 (pear-desktop 참고)
                // ─────────────────────────────────────────────────────────────
                // T2는 q=제목으로 검색하므로 동명곡이 다른 아티스트와 함께 반환됨
                // 해결: 아티스트를 분리 후 파트별로 스크립트 체크 + JW 비교
                //   - 같은 스크립트 파트 → JW > 0.85 필요
                //   - 이종 스크립트 파트 → 비교 불가 (무시)
                //   - 같은 스크립트 파트가 없으면 → 필터 스킵 (CJK↔라틴 보호)
                if (tier === 2 && Array.isArray(data) && data.length > 1) {
                    const hasNonLatin = (str) => /[^\u0000-\u024F\u1E00-\u1EFF\u2000-\u206F\u0300-\u036F]/.test(str);
                    const normFeat = (s) => s.replace(/\s+feat(?:uring)?\.?\s+|\s+ft\.?\s+/gi, ',');
                    // 악센트 제거: é→e, ñ→n, ö→o 등 (NFD 분해 후 결합 문자 제거)
                    const stripAccent = (s) => s.normalize('NFD').replace(/[\u0300-\u036F]/g, '');

                    const inputArtists = normFeat(info.artist).split(/[,&、·/]+/g).map(s => s.trim().toLowerCase()).filter(s => s);
                    const beforeCount = data.length;

                    data = data.filter(item => {
                        const resultArtist = (item.artistName || '');
                        const resultArtists = normFeat(resultArtist).split(/[,&、·/]+/g).map(s => s.trim().toLowerCase()).filter(s => s);

                        // 파트별 스크립트 인식 JW 비교
                        let hasSameScriptPair = false;
                        let anySameScriptMatch = false;

                        for (const a of inputArtists) {
                            for (const b of resultArtists) {
                                if (hasNonLatin(a) === hasNonLatin(b)) {
                                    // 같은 스크립트 → JW 비교 (악센트 정규화 적용)
                                    hasSameScriptPair = true;
                                    if (jaroWinkler(stripAccent(a), stripAccent(b)) > 0.85) {
                                        anySameScriptMatch = true;
                                    }
                                }
                                // 이종 스크립트 → 비교 불가, 무시
                            }
                        }

                        // 같은 스크립트 파트가 하나도 없으면 → 비교 불가 → 통과 (CJK↔라틴 보호)
                        // 같은 스크립트 파트가 있으면 → 하나라도 JW > 0.85 필요
                        return !hasSameScriptPair || anySameScriptMatch;
                    });

                    if (data.length !== beforeCount) {
                        window.__ivLyricsDebugLog?.(`[LR-DEBUG] T2: 아티스트 필터 적용 → ${beforeCount}개 → ${data.length}개`);
                    }

                    // 【T2 필터 후 T3 폴백】
                    // T2 필터가 모든 결과를 제거한 경우 T3로 재시도
                    if (data.length === 0) {
                        window.__ivLyricsDebugLog?.(`[LR-DEBUG] T2: 필터 후 결과 없음 → T3 폴백 시도`);
                        tier = 3;
                        data = await searchT3WithTokenFilter('T3(폴백)');
                    }
                }


                // 【TODO: instrumental 트랙 명시적 처리】
                // 현재는 instrumental 곡이 syncedLyrics/plainLyrics = null이므로
                // 자연스럽게 "No lyrics found"로 처리됨.
                // 만약 향후 instrumental인데 가짜 가사가 등록된 케이스가 빈번해지면:
                //   - pear-desktop 참고: item.instrumental === true → null 반환
                //   - 주의: LRCLIB의 instrumental 플래그가 항상 정확하지는 않음
                //   - 현재 densityRatio 필터가 스팸 가사를 어느 정도 잡아줌

                endServer = performance.now();  // 서버 응답 시간 측정 종료

                // 모든 Tier에서 결과 없음 → 가사 없음으로 처리
                if (!Array.isArray(data) || data.length === 0) {
                    result.error = 'No lyrics found';
                    logDebug('Failed', result.error);
                    return result;
                }

                // ════════════════════════════════════════════════════════════════
                // Best-of-N 선택 로직 (매칭 알고리즘)
                // ════════════════════════════════════════════════════════════════
                // API에서 여러 결과가 반환되면, 가장 적합한 가사를 선택해야 합니다.
                // 다음 기준으로 각 결과에 점수를 부여하고 최고점을 선택합니다:
                // - Duration 일치도 (곡 길이)
                // - Title 유사도 (Jaro-Winkler)
                // - Artist 유사도 (Jaro-Winkler)
                // - 가사 밀도 (시간당 줄 수)
                // - Sync 가사 여부 (보너스)
                // ════════════════════════════════════════════════════════════════
                startLogic = performance.now();  // 매칭 로직 시간 측정 시작

                const songDurationMs = info.duration || 0;       // 곡 길이 (밀리초)
                const songDurationSec = songDurationMs / 1000;   // 곡 길이 (초) - API 응답과 비교용

                // ─────────────────────────────────────────────────────────────
                // 【1단계】 데이터 전처리 및 품질 지표 계산
                // ─────────────────────────────────────────────────────────────
                // 각 검색 결과에 대해 품질 지표를 계산하여 확장된 객체 생성
                // 이 단계에서 "점수를 매기기 위한 기초 데이터"를 준비함
                const processed = data.map(item => {
                    // 【Duration 차이】 요청 곡 길이와 결과 곡 길이의 차이 (초)
                    // 절댓값으로 계산하여 길고 짧음 모두 동일하게 처리
                    const durationDiff = Math.abs(item.duration - songDurationSec);

                    // 【Sync 커버리지】 싱크 가사가 곡의 몇 %를 커버하는지
                    // 0.0 = 커버 안 함, 1.0 = 100% 커버
                    const syncCoverage = getLyricCoverage(item.syncedLyrics, songDurationMs);

                    // 【가사 밀도】 시간 대비 줄 수로 가사 완성도 추정
                    // 일반적인 가사는 1분당 약 10~15줄 정도
                    const actualLines = item.plainLyrics?.split('\n').filter(l => l.trim()).length || 0;
                    const expectedLines = (item.duration / 60) * 12; // 1분당 12줄 기준
                    const densityRatio = expectedLines > 0 ? actualLines / expectedLines : 0;

                    // 【쓰레기 판별】 명백히 불량한 가사 식별
                    // 1. 싱크 가사인데 커버리지가 50% 미만 → 짤린 가사
                    const isShortSynced = item.syncedLyrics && syncCoverage < 0.5;
                    // 2. 일반 가사인데 밀도가 극단적 (0.1 미만 또는 5 초과)
                    //    - 너무 적음: 가사 일부만 있음
                    //    - 너무 많음: 스팸이나 메타데이터 오염
                    const isDensityTrash = !item.syncedLyrics && (densityRatio < 0.1 || densityRatio > 5);
                    const isTrash = isShortSynced || isDensityTrash;

                    // 【문자열 유사도】 Jaro-Winkler로 제목/아티스트 비교
                    // 아직 스케일링 전의 "원시 점수" (0.0 ~ 1.0)
                    const rawTitleScore = jaroWinkler(info.title, item.trackName);
                    const rawArtistScore = jaroWinkler(info.artist, item.artistName);

                    // 원본 데이터에 계산된 지표를 추가하여 반환
                    return {
                        ...item,          // 원본 API 응답 데이터 유지
                        durationDiff,     // Duration 차이 (초)
                        syncCoverage,     // Sync 커버리지 (0.0~1.2)
                        densityRatio,     // 밀도 비율
                        rawTitleScore,    // 제목 유사도 (원시)
                        rawArtistScore,   // 아티스트 유사도 (원시)
                        isTrash           // 쓰레기 여부
                    };
                });

                // ─────────────────────────────────────────────────────────────
                // 【2단계】 쓰레기 제거 (극단적인 경우만 필터링)
                // ─────────────────────────────────────────────────────────────
                // isTrash가 true인 항목은 점수 평가 대상에서 제외
                // 이는 명백히 불량한 가사만 제거하므로 과도한 필터링 방지
                const qualityPassed = processed.filter(item => !item.isTrash);

                // 모든 결과가 쓰레기로 판정되면 실패 처리
                if (qualityPassed.length === 0) {
                    result.error = 'No quality lyrics found';
                    logDebug('Failed', result.error);
                    return result;
                }

                // ─────────────────────────────────────────────────────────────
                // 【3단계】 관대한 점수 평가 (Scoring)
                // ─────────────────────────────────────────────────────────────
                // 각 품질 지표를 스케일링하고 가중치를 적용하여 총점 계산
                // Tier에 따라 다른 가중치 전략 적용 (Tier-aware scoring)
                const scored = qualityPassed.map(item => {
                    // 【Duration 점수】 ±45초 기준으로 선형 감소
                    // 0초 차이 = 1.0점, 45초 차이 = 0.0점
                    // 관대한 기준으로 약간의 길이 차이 허용
                    const durationScore = Math.max(0, 1 - (item.durationDiff / 45));

                    // 【Title 점수】 관대한 스케일링 적용
                    // - 0.5 이상: 최소 0.7점 보장 (낮은 유사도도 구제)
                    // - 0.5 미만: 1.4배 스케일업 (완전 불일치가 아니면 기회 부여)
                    // 이유: 번역/로마자 표기로 인해 낮은 원시 점수가 나올 수 있음
                    const titleScore = item.rawTitleScore >= 0.5
                        ? 0.7 + (item.rawTitleScore - 0.5) * 0.6   // 0.5→0.7, 1.0→1.0
                        : item.rawTitleScore * 1.4;                // 0.3→0.42, 0.0→0.0

                    // 【Artist 점수】 더 관대한 스케일링 적용
                    // - 0.3 이상: 최소 0.5점 보장
                    // - 0.3 미만: 1.67배 스케일업
                    // 이유: 아티스트 표기가 매우 다양함 (feat., & 등)
                    const artistScore = item.rawArtistScore >= 0.3
                        ? 0.5 + (item.rawArtistScore - 0.3) * 0.71  // 0.3→0.5, 1.0→1.0
                        : item.rawArtistScore * 1.67;              // 0.0→0.0, 0.3→0.5

                    // 【Density 점수】 가사 밀도 (최대 1.0)
                    // 밀도가 너무 높은 경우도 1.0으로 캡핑
                    const densityScore = Math.min(item.densityRatio, 1);

                    // 【Sync 보너스】 싱크 가사가 있으면 15점 추가
                    // 사용자 경험상 싱크 가사가 더 가치 있음
                    const syncBonus = item.syncedLyrics ? 15 : 0;

                    // 【토큰 검증】 아티스트 이름의 부분 일치 확인
                    // "Artist A & Artist B" 같은 복합 아티스트 대응
                    // 구분자: 쉼표(,), 일본어 쉼표(、), &, 중점(·), 슬래시(/)
                    const queryTokens = info.artist.split(/[,、&·/]/).map(s => s.trim().toLowerCase()).filter(t => t.length >= 2);
                    const resultArtist = item.artistName.toLowerCase();
                    // 아티스트 이름 토큰 중 하나라도 결과에 포함되면 매치
                    const hasTokenMatch = queryTokens.some(t => resultArtist.includes(t));

                    // 토큰 매치 보너스/페널티
                    const tokenBonus = hasTokenMatch ? 10 : 0;       // 토큰 매치 시 +10
                    // 토큰 매치 없고 유사도도 낮으면 -15 (커버곡/잘못된 결과 차단)
                    const artistPenalty = (!hasTokenMatch && item.rawArtistScore < 0.3) ? -15 : 0;

                    // 【Tier-aware 최종 점수 합산】
                    // Tier에 따라 가중치를 다르게 적용
                    let totalScore;
                    if (tier >= 2) {
                        // ═══════════════════════════════════════════════════════
                        // Tier 2/3: 폴백 검색 → Duration + Artist 중시
                        // ═══════════════════════════════════════════════════════
                        // 이유: 제목 검색(Tier 2)이나 아티스트 검색(Tier 3)은
                        // Title 유사도가 불안정하므로 Duration을 더 신뢰
                        const durationMatch = item.durationDiff <= 2;  // 2초 이내면 거의 확실
                        totalScore = durationMatch
                            // Duration 정확 매치: 높은 신뢰도 보너스 (+20)
                            ? (durationScore * 50) + (artistScore * 20) + syncBonus + 20
                            // Duration 불일치: Title도 약간 고려하되 비중 낮음
                            : (durationScore * 50) + (titleScore * 7) + (artistScore * 30) + syncBonus;
                    } else {
                        // ═══════════════════════════════════════════════════════
                        // Tier 1: 구조화 검색 → 균형 잡힌 로직
                        // ═══════════════════════════════════════════════════════
                        // 가중치: Duration 30 + Title 40 + Artist 10 + Density 10 + 보너스
                        // Title에 가장 높은 가중치 (제목이 가장 중요한 매칭 기준)
                        totalScore = (durationScore * 30) + (titleScore * 40) + (artistScore * 10) +
                            (densityScore * 10) + tokenBonus + artistPenalty + syncBonus;
                    }

                    // 계산된 점수들과 함께 반환
                    return { ...item, durationScore, titleScore, artistScore, densityScore, sync: item.syncCoverage, totalScore, tier };
                });

                // ─────────────────────────────────────────────────────────────
                // 【4단계】 최종 선택 및 임계값 검증
                // ─────────────────────────────────────────────────────────────
                // 총점 기준 내림차순 정렬 후 최고점 선택
                scored.sort((a, b) => b.totalScore - a.totalScore);
                const body = scored[0];  // 최고 점수 후보

                // 【Tier-aware 임계값 검증】
                // 너무 낮은 점수의 결과는 잘못된 매칭일 가능성이 높으므로 거부
                if (tier === 1) {
                    // Tier 1: 엄격한 임계값 적용
                    // Duration 20% 이상 + Title 40% 이상이어야 통과
                    if (body.durationScore < 0.2 || body.titleScore < 0.4) {
                        result.error = 'No matching lyrics';
                        logDebug(`Failed (T${tier})`, result.error);
                        return result;
                    }
                } else {
                    // Tier 2/3: Duration 기반 페널티 + 총점 검증
                    // 15초 이상 차이나면 다른 곡일 가능성 높음 → 50점 감점
                    const durationPenalty = body.durationDiff > 15 ? 50 : 0;
                    const adjustedScore = body.totalScore - durationPenalty;

                    // 조정된 점수가 40점 미만이면 거부
                    if (adjustedScore < 40) {
                        result.error = body.durationDiff > 15
                            ? `Duration mismatch (${Math.round(body.durationDiff)}s diff)`  // Duration 차이 명시
                            : 'Low confidence match';  // 전반적으로 낮은 신뢰도
                        logDebug(`Failed (T${tier})`, result.error);
                        return result;
                    }
                }

                endLogic = performance.now();  // 매칭 로직 시간 측정 종료

                // ════════════════════════════════════════════════════════════════
                // 결과 처리 및 반환
                // ════════════════════════════════════════════════════════════════

                // 【디버깅용 점수 캡처】
                // logDebug 함수에서 출력하기 위해 최종 선택된 결과의 점수 저장
                bestScore = body.totalScore;      // 총점
                bestSync = body.sync;             // Sync 커버리지
                bestTitle = body.titleScore;      // Title 점수
                bestArtist = body.artistScore;    // Artist 점수


                // (프로덕션에서는 품질 알림 비활성화)
                // Quality notification removed for production PR


                // ─────────────────────────────────────────────────────────────
                // 【Instrumental 체크】
                // ─────────────────────────────────────────────────────────────
                // LRCLIB API가 instrumental=true로 표시한 경우
                // 가사 없는 연주곡임을 표시
                if (body.instrumental) {
                    result.synced = [{ startTime: 0, text: '♪ Instrumental ♪' }];
                    result.unsynced = [{ text: '♪ Instrumental ♪' }];
                    logDebug('Success (Instrumental)');
                    return result;
                }

                // ─────────────────────────────────────────────────────────────
                // 【가사 파싱 및 결과 설정】
                // ─────────────────────────────────────────────────────────────

                // 싱크 가사 파싱 (Sync가 있고 커버리지가 0 초과인 경우)
                if (body.syncedLyrics && body.sync > 0) {
                    const parsed = parseLRC(body.syncedLyrics);
                    result.synced = parsed.synced;       // 싱크 가사 배열
                    if (!result.unsynced) {
                        result.unsynced = parsed.unsynced;  // 일반 가사도 함께 설정
                    }
                }
                // 싱크 가사 없으면 Plain 가사로 폴백
                else if (body.plainLyrics) {
                    // 줄 단위로 분리하여 객체 배열로 변환
                    // 빈 줄은 필터링
                    result.unsynced = body.plainLyrics.split('\n').map(line => ({ text: line.trim() })).filter(l => l.text);
                }

                // 추가 안전장치: 싱크가 없지만 plain이 있는 경우
                if (!result.synced && body.plainLyrics && !result.unsynced) {
                    result.unsynced = body.plainLyrics.split('\n').map(line => ({ text: line.trim() })).filter(l => l.text);
                }

                // 최종 검증: 아무 가사도 없으면 에러 설정
                if (!result.synced && !result.unsynced) {
                    result.error = 'No lyrics';
                }

                // 디버그 로그 출력 후 결과 반환
                logDebug(result.error ? 'Failure' : `Success (T${tier})`);
                return result;

            } catch (e) {
                // ═══════════════════════════════════════════════════════════
                // 예외 처리: 예상치 못한 에러 발생 시
                // ═══════════════════════════════════════════════════════════
                result.error = e.message;
                logDebug('Fatal Error', e.message);
                return result;
            }

        }
    };

    // ============================================
    // Registration (애드온 등록)
    // ============================================
    // LyricsAddonManager에 이 애드온을 등록합니다.
    // Spicetify 로딩 순서에 따라 Manager가 아직 준비되지 않았을 수 있으므로
    // 준비될 때까지 100ms 간격으로 재시도합니다.

    /**
     * 【애드온 등록 함수】
     * window.LyricsAddonManager가 존재하면 애드온을 등록하고,
     * 없으면 100ms 후에 다시 시도합니다 (Polling 패턴).
     */
    const registerAddon = () => {
        if (window.LyricsAddonManager) {
            // Manager 준비됨 → 애드온 등록
            window.LyricsAddonManager.register(LrclibLyricsAddon);
        } else {
            // Manager 미준비 → 100ms 후 재시도
            setTimeout(registerAddon, 100);
        }
    };

    // IIFE 실행 시 즉시 등록 시도 시작
    registerAddon();
})();
