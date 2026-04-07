# AutoWebScroller – 버그 수정 기록

## 2026-04-07 (팀 에이전트 2라운드 — 1라운드 발견 적용 + 신규 버그 수정 + 종료 기능)

### 모드: 5인 팀 에이전트 — 1라운드 발견 + 사용자 보고 신규 버그 + 종료(Quit) 기능 통합 작업

### 1라운드 발견 사항 적용 (즉시 수정)

#### C1 + H3 통합 — `SETTINGS_KEYS` 단일 상수 도입
- 기존: 설정 키 배열이 4곳에 하드코딩
  - `popup.js:265` (`applyState`)
  - `popup.js:393` (`Object.assign` 프로토타입 오염 위험)
  - `content.js:85, 100` (`loadSiteSettings` 동기/비동기 분기)
  - `content.js:726` (`updateSettings` 핸들러)
- 수정:
  - `content.js`: 상단에 `const SETTINGS_KEYS = [...]` 단일 상수 정의 (storage 키 섹션 옆)
  - `popup.js`: 동일 상수를 popup에서도 정의 (single source of truth, 미러)
  - 4곳 모두 이 상수를 사용하도록 통합
  - `popup.js`의 init `Object.assign` → 화이트리스트 루프로 변경 (프로토타입 오염 차단)

#### H1 — scrollTarget 재감지 race condition 수정 (`content.js:doScroll`)
- 기존: 재감지 후 같은 프레임에서 `scrollBy()` 호출 → iOS Safari `scrollTop` 비동기 갱신 문제로 다음 프레임에서 이전 값 평가 가능
- 수정: 타겟 전환 시 같은 프레임의 `scrollBy` 스킵 + `lastRafTime/lastScrollPos/stuckFrames` 리셋 + 다음 RAF 등록 후 즉시 return

### 신규 버그 수정 (사용자 보고)

#### Bug N1 — "화면 끝에 가면 자동으로 프로그램이 재실행되는 현상"
- 디버거 분석:
  - `loop=false`일 때 끝에서 처음으로 가는 명시적 경로 없음
  - 가장 가능성 높은 원인: **무한 스크롤 사이트(트위터/레딧 등)에서 lazy-load로 새 콘텐츠가 추가되면 `scrollHeight`가 증가 → `scrollBy`가 다시 동작 → 사용자에게 "끝났는데 또 시작됨"으로 보임**
  - 부차 원인: `getScrollTarget`이 inner container를 잡았다가 끝에서 page-first 휴리스틱으로 documentElement로 전환되며 새 위치에서 스크롤 재개
- 수정: **Stuck 감지 로직 추가** (`content.js:doScroll`)
  - 매 프레임 `scrollBy` 호출 전 위치(`beforePos`)를 샘플
  - `loop=false` + 페이지가 실제로 스크롤 가능(`totalH > viewH + 10`)일 때만 작동
  - 위치가 `STUCK_FRAMES_THRESHOLD = 180` 프레임 (~3초) 동안 변하지 않으면 `stopScroll()` 자동 호출
  - jsdom/non-scrollable 페이지에서는 detection 자동 비활성화 (false positive 방지)
  - `startScroll`에서 `lastScrollPos = -1`, `stuckFrames = 0` 초기화

#### Bug N2 — "페이지 옮겨도 동일 현상"
- 디버거 분석:
  - `onNavigate` → `stopScroll`만 호출, 자동 재시작 경로 없음
  - 가설: bfcache 복원 시 `pageshow` 핸들러 부재로 이전 RAF/상태가 stale로 살아남을 가능성
- 수정: **`pageshow` 핸들러 추가** (`content.js`)
  - `e.persisted === true` (bfcache 복원) 시 명시적 `stopScroll` + stuck 상태 리셋
  - 일반 navigation에서는 no-op (성능 영향 없음)

### 신규 기능 — 종료(Quit) 기능

#### UX 설계 (UX Designer + Architect)
- **stop (현재 토글)**: 일시정지. 위젯 유지, 다시 시작 가능
- **quit (신규)**: 완전 종료. 위젯 사라짐, `showWidget=false` 영구 저장 → 페이지 이동/리로드 후에도 안 나타남
- **재사용**: popup의 시작 버튼 누르면 `startScroll()`이 자동으로 `showWidget=true` 복원 + 위젯 재생성

#### 구현 (`content.js`)
- `quitScroll()` 함수 신규 추가:
  - `stopScroll()` (이미 실행 중이면)
  - 위젯 DOM 제거 + JS 참조 정리
  - `settings.showWidget = false` + `autoSaveSettings()`
  - `notifyState()` (popup 동기화)
- `'quit'` 메시지 케이스 추가
- `startScroll()` 진입 시 `!settings.showWidget`이면 자동으로 `true` 복원 + `showWidget()` 호출

#### 구현 (`popup.js`, `popup.html`, `popup.css`)
- `popup.html`: `toggle-section`에 `<button id="quitBtn" class="quit-btn">✕</button>` 추가
- `popup.css`: `.quit-btn` 스타일 — 사각형 outlined 버튼, hover 시 `accent-stop` 컬러
- `popup.js`: `quitBtn` DOM ref + click 핸들러 → `send('quit')` + 로컬 UI 즉시 갱신
- `applyI18n`: `data-i18n-title` 속성 처리 추가 (title attribute 다국어 지원)

#### 다국어 (6개 언어 i18n)
| 언어 | quit_title |
|------|-----------|
| ko | 종료 |
| en | Quit |
| ja | 終了 |
| zh | 退出 |
| fr | Quitter |
| hi | समाप्त |

### 테스트 (8개 신규 추가, 125 → 133)

#### 신규 describe 블록
- `pageshow — bfcache restore safety` (2 tests)
  - `pageshow with persisted=true → forces stopScroll`
  - `pageshow with persisted=false → no-op`
- `quit feature` (3 tests)
  - `quit message → scroll stops + widget removed + showWidget=false saved`
  - `startScroll after quit → re-enables widget automatically`
  - `quit while scroll is stopped → still removes widget and saves`
- `stuck detection — auto-stop at end of page` (3 tests)
  - `does NOT stop on non-scrollable page (totalH ≤ viewH)`
  - `stops on scrollable page when stuck for ≥180 frames`
  - `does NOT stop when loop=true (loop overrides stuck detection)`

#### 결과
- **133/133 통과**
- 커버리지: content.js 94.12% / popup.js 92.5% / background.js 94.73% / 전체 93.62% line

### 과학적 토론 (Cross-Layer)

1. **stuck detection vs jsdom**: 첫 구현은 jsdom에서 false positive (scrollBy 후 scrollTop이 갱신 안 됨) → 4개 기존 테스트 깨짐. 해결: `totalH > viewH + 10` 게이트 추가 → 페이지가 실제 스크롤 가능할 때만 검사.
2. **Quit과 startScroll의 상호작용**: Quit 후 사용자가 다시 시작하려면 위젯도 같이 켜져야 자연스러움. → `startScroll`이 `showWidget` 자동 복원하도록 결정.
3. **Bug N1 가설 검증**: 코드만 보면 `loop=false`에서 끝에서 재실행되는 명시적 경로 없음. 그러나 사용자 인식이 분명하므로 stuck 감지로 방어. infinite-scroll 사이트에서 가장 효과적.

### Action Items 진행 상황 (1라운드 → 2라운드)

| ID | 1라운드 | 2라운드 |
|----|---------|---------|
| C1 (Object.assign) | 발견 | ✅ 수정 |
| H1 (scrollTarget race) | 발견 | ✅ 수정 |
| H3 (설정 키 4중 중복) | 발견 | ✅ C1과 통합 수정 |
| H2 (loop 비활성 layout reads) | 발견 | ⏸ 다음 라운드 (코드 변경 영역과 충돌, 분리 작업 필요) |
| Bug N1 (끝에서 재실행) | 신규 | ✅ stuck 감지로 수정 |
| Bug N2 (페이지 이동 재실행) | 신규 | ✅ pageshow 핸들러로 수정 |
| 종료(Quit) 기능 | 신규 | ✅ 구현 완료 |
| C2 / M1~M6 / L1~L6 | 발견 | ⏸ 1.1.0 리팩터링 |

---

## 2026-04-07 (팀 에이전트 1라운드 — 전체 코드 리뷰)

### 모드: 5인 팀 에이전트 병렬 실행
- 리더 (Architect) — UX/UI + 통합 + 최종 판단
- Teammate 1 (Coder) — 일관성·컨벤션 검토
- Teammate 2 (Debugger) — 잠재 버그·race condition·iOS Safari quirks
- Teammate 3 (Tester+Reviewer) — 커버리지·최종 품질 리뷰
- Teammate 4 (Performance+Doc) — RAF/배터리·문서화

### 검토 범위
전체 코드베이스 — Safari Extension(ios/), Native App(SafariExtensionApp/), Tests, Config, GitHub Pages **한 줄도 빠짐없이**

### 실측 커버리지 (npm test -- --coverage)
| 파일 | Line | Branch | Func |
|------|------|--------|------|
| content.js | 94.27% | 74.88% | 89.18% |
| popup.js | 94.5% | 79.06% | 100% |
| background.js | 94.73% | 100% | 100% |
| **전체** | **94.35%** | **75.91%** | **90.9%** |

테스트 125개 모두 통과.

### 주요 발견 (요약)

#### Critical (즉시 수정 권장)
- **C1 — popup.js:393 Object.assign 프로토타입 오염 위험**
  - `Object.assign(settings, result[SETTINGS_KEY])` — content.js는 이미 화이트리스트 사용 중인데 popup.js만 누락
  - 발견자: Debugger + Reviewer 합의

#### High
- **H1 — content.js:201-219 scrollTarget 재감지 race condition**
  - 재감지 직후 같은 프레임에 `scrollBy()` → iOS Safari `scrollTop` 비동기 갱신 문제로 다음 프레임에서 이전 값 평가 가능
  - 발견자: Debugger
- **H2 — content.js:189-250 doScroll 매 프레임 불필요한 layout reads**
  - loop 비활성 시에도 매 프레임 `scrollTop / scrollHeight / clientHeight` 읽음 → battery 5~10% 영향 (이론치)
  - 발견자: Performance + Coder + Debugger
- **H3 — 설정 키 배열 4곳 중복** (popup.js:265, content.js:85/100/726)
  - C1과 통합 수정 가능 (단일 상수 도입)
  - 발견자: Coder + Reviewer

#### Medium (출시 후 리팩터링)
- M1 `loadSiteSettings()` 99줄 — 동기/비동기/위젯 생성 혼재
- M2 `updateSettings` 핸들러 너무 길고 책임 다수
- M3 `doScroll()` 책임 과다 (SPA 체크 + 타겟 재감지 + autoPause + delta + loop)
- M4 `darkModeListener`: 매번 새 `matchMedia` 객체 → removeEventListener 무효 가능성 (디버거 가설, 검증 필요)
- M5 `loadSiteSettings()` 비동기 콜백 vs 300ms 타이머 race
- M6 위젯 vertical/horizontal cssText 70% 중복 → CSS 클래스 분리 권장

#### Low
- IIFE 838줄 모듈화 / 변수 축약 / Magic numbers / popup.html `lang="ko"` 고정 / `getScrollTarget` while 깊이 제한 / visibilitychange 리스너 정리

### 과학적 토론 (Cross-Layer)

1. **C1 + H3 통합**: 같은 문제의 다른 측면. `SETTINGS_KEYS` 단일 상수 도입으로 4곳 중복 + Object.assign 동시 해결.
2. **H1 + H2 + M3 통합 수정**: doScroll에 대한 3가지 관점(정확성/성능/구조). 단기는 H1+H2만 적용, 중기에 M3 분할 리팩터링.
3. **darkModeListener 가설**: 디버거가 단독 발견. content.js:566-569의 `const mq = window.matchMedia(...)`가 매번 새 객체일 가능성 → 다음 라운드에서 캐싱 적용 검증.
4. **출시 차단**: 4명 모두 **출시 가능** 합의. C1만 빠른 수정 권장.

### 최종 판정: 🟢 출시 승인 (C1 수정 조건부)

### Action Items

#### 즉시 (출시 전)
- [ ] C1 + H3 통합: SETTINGS_KEYS 단일 상수 도입

#### 단기 (1.0.3 또는 패치)
- [ ] H1: scrollTarget 전환 프레임 scrollBy 스킵
- [ ] H2: doScroll loop 비활성 early return
- [ ] M4 가설 검증: darkModeListener mq 캐싱
- [ ] L5: getScrollTarget while 깊이 제한 50

#### 중기 (1.1.0)
- [ ] M1, M2, M3, M5, M6 리팩터링
- [ ] 누락 테스트 P0/P1 추가 (`_connectKeepalive`, popup storage 폴백, gesture inhibit 경계, sendMessage rejection)

#### 문서화 (P0)
- [ ] content.js 전역 변수 JSDoc (`spaCheckTimer`, `scrollTargetTimer`, `gestureInhibitUntil`)
- [ ] `doScroll()` JSDoc
- [ ] storage 키 3종 차이 주석
- [ ] CLAUDE.md에 speedMode / wake lock / autoPause RAF 멈춤 섹션 추가
- [ ] README.md 생성 (영어)

상세 내용: `Tasklist.md` 참조.

---

## 2026-02-25

### 버그 수정 (content.js)

#### 1. iOS Safari 루프 옵션 미작동 (iPad)
- **증상**: 루프 옵션을 켜도 끝에서 처음으로 돌아가지 않음
- **원인**: `document.documentElement.scrollTop`이 iOS Safari에서 `scrollBy()` 직후 즉시 업데이트되지 않아 루프 조건이 항상 false로 평가
- **수정**: 루프 조건에서 `window.scrollY` / `window.innerHeight` 사용, 위치 초기화 시 `window.scrollTo()` 사용

#### 2. 방향 변경 시 스크롤 멈춤 (iPhone)
- **증상**: 팝업에서 방향을 아래→위로 변경하면 스크롤이 멈춤
- **원인**: iOS에서 팝업 open/close 시 터치 이벤트가 content page로 전달 → `autoPause` 발동 (userScrolling=true → 3초 정지)
- **수정**: `updateSettings`에서 방향 변경 시 autoPause 즉시 초기화 (`userScrolling=false`, `clearTimeout`)

#### 3. 방향 변경 후 다운 방향처럼 보이는 문제
- **증상**: 위 방향으로 변경 후 루프 활성화 상태에서 페이지가 갑자기 아래로 튐
- **원인**: RAF 루프에서 방향='위' + scrollTop=0 조건 감지 → 즉시 최하단으로 점프, 사용자는 이를 방향이 다운으로 바뀐 것으로 인식
- **수정**: `updateSettings`에서 방향 변경 시 올바른 엣지로 즉시 pre-position (자연스러운 전환)

#### 4. 팝업 조작 후 제스처 단축키 오발동
- **증상**: 팝업에서 설정 변경 후 더블탭 제스처가 실수로 `toggleScroll()` 호출
- **원인**: iOS 팝업 close 시 touch 이벤트가 content page로 전달 → 제스처 카운터 증가 → 더블탭 인식
- **수정**: `updateSettings` 수신 후 800ms 동안 제스처 단축키 비활성화 (`gestureInhibitUntil`)

#### 5. 위젯/팝업 플레이 버튼 상태 불일치
- **증상**: 팝업은 재생 중으로 표시되는데 플로팅 위젯은 정지 상태로 표시
- **원인 A**: 위 4번 문제로 제스처 더블탭이 scroll을 멈추는데 팝업이 즉시 반영 안 됨
- **원인 B**: SPA 페이지 이동 시 위젯 DOM이 제거되어도 JS 참조(widget, widgetPlayBtn)가 stale 상태로 남아 상태 업데이트가 유령 DOM에 적용됨
- **수정**: SPA 감지(doScroll 내)에서 DOM 없을 시 widget/widgetPlayBtn 참조도 함께 초기화

### 코드 전체 버그 감사 후 추가 수정 (content.js, popup.js)

#### 6. 타이머 중복/누락 — timerMins 변경 시 기존 타이머 미정리
- **증상**: 스크롤 중 타이머를 5분→10분으로 변경해도 원래 타이머(5분)가 계속 작동 → 예상보다 일찍 스크롤 종료
- **원인**: `updateSettings` 핸들러에서 `timerMins` 변경 시 기존 `timerTimeout`을 clear하지 않음
- **수정**: `updateSettings`에서 `timerMins` 변경 감지 시 기존 타이머 해제 후 새 값으로 재시작

#### 7. matchMedia 다크모드 리스너 누적
- **증상**: SPA 페이지 이동이 반복될수록 `applyWidgetTheme`이 N번 중복 호출됨 (성능 저하)
- **원인**: `createWidget()` 호출 시마다 `matchMedia` change 리스너를 새로 추가, 이전 리스너 미제거
- **수정**: `darkModeListener` 변수에 리스너 참조 보존 → 재등록 전 `removeEventListener` 호출

#### 8. 위젯 위치 복구 시 NaN 방지
- **증상**: localStorage 값이 손상된 경우(`{x: null}` 등) 위젯이 잘못된 위치에 나타남
- **원인**: `savedPos.x/y` 유효성 검사 없이 CSS 직접 적용 → `Math.max(0, NaN)` = `NaN` → CSS 무효값
- **수정**: `isFinite()` 검증 추가 — x, y 모두 유한수일 때만 저장 위치 사용

#### 9. popup.js Promise 미처리
- **증상**: `sendMessage()` 실패 시 콘솔에 unhandled promise rejection 경고
- **원인**: `browser.tabs.sendMessage()` 반환 Promise에 `.catch()` 없음
- **수정**: `.catch(() => {})` 추가

## 2026-02-25 (추가)

### 테스트 커버리지 개선

#### 10. `isFinite(null)` 가드 오작동 (content.js)
- **증상**: localStorage에 `{ x: null, y: 100 }` 저장 시 위젯이 잘못된 위치에 나타남
- **원인**: `isFinite(null)` = `true` (null → 0으로 강제 변환됨) → savedPos 검증 실패
- **수정**: `Number.isFinite(null)` = `false` → `isFinite` → `Number.isFinite`로 변경

### 테스트 인프라 개선 (tests/)

- **eval → require 전환**: `eval(fs.readFileSync(...))` 방식에서 `jest.resetModules() + require()` 방식으로 변경 → Jest coverage 추적 가능
- **테스트 수**: 64개 → 92개 (28개 추가)
- **커버리지** (npm test -- --coverage):
  - content.js: Stmt 90.52% / Branch 79.31% / Func 84.37%
  - popup.js:   Stmt 96.52% / Branch 84.84% / Func 100%
  - background.js: 100%
- **추가된 describe 블록**: scroll timer, direction change, widget collapse/expand, widget speed slider, widget drag, widget position restore, gestureInhibitUntil 검증, autoPause=false

## 2026-02-25 (Wake Lock + Battery 최적화)

### 새 기능: Screen Wake Lock (content.js)
- **목적**: 스크롤 실행 중 화면 꺼짐 방지
- **구현**: `navigator.wakeLock.request('screen')` — Safari 16.4+/iOS 16.4+ 지원
- **startScroll()**: `acquireWakeLock()` 호출 추가
- **stopScroll()**: `releaseWakeLock()` 호출 추가, 관련 타이머(userScrollTimer) 정리 강화
- **visibilitychange**: 탭 전환 후 복귀 시 wake lock 재취득 (`document.addEventListener`)
- **폴백**: `'wakeLock' in navigator` 체크 → 지원 안 하는 환경에서 무시

### 배터리 최적화: autoPause 중 RAF 루프 자체 종료 (content.js)
- **이전**: autoPause 활성 시 `doScroll`이 계속 실행되며 매 프레임 `scrollBy(0, 0)` 호출 → 60fps 낭비
- **수정**: `userScrolling && settings.autoPause` 조건 시 `scrollInterval = null; lastRafTime = null; return` → RAF 루프 종료
- **재개**: `onTouchEnd` / `onUserWheel`의 3초 resume timer에서 `scrollInterval === null`이면 `requestAnimationFrame(doScroll)` 재등록
- **방향 변경**: `updateSettings`에서 방향 변경 시에도 `scrollInterval === null`이면 RAF 재시작

### 테스트 인프라 개선 (tests/content.test.js)
- **document 리스너 누적 문제 수정**: `document.addEventListener` spy 추가 → afterEach에서 visibilitychange 등 document 리스너 자동 정리
- **테스트 수**: 92개 → 101개 (9개 추가)
  - wake lock describe: 5개
  - battery autoPause RAF pause/resume describe: 4개

## 2026-02-25 (버그 수정 — 타이머 초기화)

### 버그 수정: 타이머 만료 후 timerMins 미초기화 (content.js)
- **증상**: 타이머가 만료되어 스크롤이 자동 종료되어도 팝업 타이머 슬라이더가 여전히 이전 값(예: 5분)으로 남아 있음
- **원인**: `setTimeout(stopScroll, ...)` 형태로 타이머 등록 → `stopScroll()`은 `settings.timerMins`를 변경하지 않음 → `notifyState()`가 이전 `timerMins` 값을 popup에 전달
- **수정**: `onTimerExpired()` 래퍼 함수 추가
  - `settings.timerMins = 0` 초기화
  - `autoSaveSettings()` 호출 (localStorage 즉시 반영)
  - `stopScroll()` 호출
- **영향 범위**: `startScroll()` 및 `updateSettings` 내 타이머 재시작 로직 두 곳 모두 수정
- **테스트**: 2개 추가 (stateChanged timerMins=0 검증, localStorage 저장 검증) → 103개 통과

## 2026-02-25 (출시 준비 — 법적 문서 + App Store 문서화)

### 신규 파일 작성

#### document.md — App Store 출시 전체 문서
- 앱 이름/부제목/홍보 문구 (한/영)
- 앱 설명 전문 (한/영)
- 키워드 (한/영, 각 100자 이내)
- 버전 업데이트 내역 v1.0 ~ v1.3 (한/영)
- 스크린샷 캡션 5장 (한/영)
- 앱 미리보기 영상 30초 스크립트
- 개인정보 처리 항목 (수집 없음 명시)
- 지원 URL / 마케팅 URL / 개인정보처리방침 URL 확정값 기재
- 심사 메모 (영문, 테스터 안내 포함)
- 앱 아이콘 규격 5종

#### privacy-policy.md — 개인정보처리방침 (한/영)
- 수집 데이터 없음 명시
- 로컬 저장소만 사용 (기기 외부 전송 없음)
- 네트워크 통신 없음 (완전 오프라인)
- 제3자 서비스 없음
- 아동 보호, 방침 변경, 문의처 포함
- **App Store Connect 등록 URL**: `https://github.com/moonkj/Scrolly-App/blob/main/privacy-policy.md`

#### terms-of-service.md — 이용약관 (한/영)
- 라이선스, 사용자 책임, 지식재산권
- 보증 부인(AS IS), 책임 제한
- Apple과의 관계 (Apple은 당사자 아님 명시)
- 준거법: 대한민국 / 서울중앙지방법원

### 앱 UI 변경 — 법적 화면 인앱 표시 (Main.html, Style.css, ViewController.swift)

#### 변경 전
- 이용약관/개인정보처리방침 링크 클릭 → Safari 앱으로 GitHub 페이지 열기

#### 변경 후
- 앱 내부에서 인라인으로 표시 (오프라인 동작, Safari 이탈 없음)
- `#main-view` (메인 화면) ↔ `#legal-view` (법적 화면) 토글 방식
- 뒤로가기 버튼 `‹` 클릭 시 메인으로 복귀, `window.scrollTo(0, 0)` 처리
- iOS Settings 스타일 섹션 카드로 각 조항 표시

#### 주요 구현 내용
- `Main.html`: `id="main-view"` 추가, 버튼 onclick으로 변경, `#legal-view` 뷰 추가, LEGAL 콘텐츠 JS 객체 + `openPage()` / `closePage()` 함수 추가
- `Style.css`: `.legal-view`, `.legal-header`, `.legal-back-btn`, `.legal-page-title`, `.legal-body`, `.legal-section` 스타일 추가
- `ViewController.swift`: 외부 URL 처리용 `decidePolicyFor` 제거 (인앱 처리로 불필요)
- 언어별 대응: 한국어 → 한국어 내용, 그 외 → 영어 내용

### App Store Connect 입력값 확정
| 항목 | URL |
|------|-----|
| 지원 URL (필수) | `https://github.com/moonkj/Scrolly-App/issues` |
| 개인정보처리방침 URL (필수) | `https://github.com/moonkj/Scrolly-App/blob/main/privacy-policy.md` |
| 마케팅 URL (선택) | `https://github.com/moonkj/Scrolly-App` |

## 2026-02-25 (버그 수정 — 앱 화면 레이아웃 깨짐)

### 버그 수정: 첫 로드 시 화면 반토막 현상 (Main.html, Style.css)

#### 증상
- 앱 처음 실행 시 메인 화면이 절반 너비로 깨져 보임
- 이용약관/처리방침 들어갔다 나오면 정상으로 표시됨

#### 원인
- `<meta CSP>` 에서 `style-src`를 별도 지정하지 않아 `default-src 'self'`가 적용됨
- `'unsafe-inline'`이 없으므로 HTML 인라인 스타일(`style="display:none"`)이 CSP에 차단됨
- `#legal-view`의 `style="display:none"`이 무효화 → CSS 클래스 `display:flex`로 렌더링
- `body { display:flex }` (row 방향) 상태에서 `#main-view`와 `#legal-view` 나란히 배치 → 반토막
- JavaScript `element.style.display =` 는 CSSOM 직접 조작이라 CSP 영향 없음 → 들어갔다 나오면 정상

#### 수정 (Style.css, Main.html)
- `Style.css`: `.hidden { display: none !important; }` 클래스 추가
- `Main.html`: `style="display:none"` 제거 → `class="legal-view hidden"` 방식 변경
- `openPage()` / `closePage()`: `element.style.display` 대신 `classList.add/remove('hidden')` 사용

### 법적 문구 업데이트 (Main.html)
- 이용약관·처리방침 문의 항목: 개인 이메일 → **Apple App Store 개발자 연락처를 이용해주세요**
- 이용약관 준거법: 서울중앙지방법원 문구 제거 → **본 약관은 대한민국 법률에 따라 해석됩니다.**

## 2026-02-26 (코드 전체 버그 감사 — content.js)

### 버그 4개 수정

#### 1. resize 리스너 누적 (content.js)
- **증상**: SPA 이동이 반복될수록 `_clampWidgetToViewport`가 N번 중복 호출됨 (성능 저하, 위젯 위치 보정 이중 적용)
- **원인**: `createWidget()` 호출 시마다 `window.addEventListener('resize', ...)` 등록, 이전 리스너 미제거
- **수정**: `removeEventListener` 후 `addEventListener` (`darkModeListener` 패턴과 동일)

#### 2. 위젯 슬라이더 속도 변경이 localStorage에 저장 안 됨 (content.js)
- **증상**: 위젯 슬라이더로 속도를 바꾸면 페이지 새로고침 후 이전 값으로 초기화됨
- **원인**: `miniSlider` input 핸들러에서 `notifyState()`만 호출하고 `autoSaveSettings()` 누락
- **수정**: `autoSaveSettings()` 추가

#### 3. SPA 이동 후 widgetCollapsed 상태 불일치 (content.js)
- **증상**: 위젯 접힌 상태에서 SPA 이동 후 위젯 재생성 시, 접기 버튼 첫 클릭이 아무 동작을 안 하는 것처럼 보임
- **원인**: `widgetCollapsed` 모듈 변수가 이전 값(true) 유지 → 새로 만든 위젯(시각적으로 펼쳐짐)과 상태 불일치
- **수정**: `createWidget()` 진입 시 `widgetCollapsed = false` 초기화

#### 4. Wake Lock 중복 취득 시 이전 참조 누수 (content.js)
- **증상**: 빠른 재호출 시 이전 lock 객체를 덮어써 해제 불가 상태 발생
- **원인**: `acquireWakeLock()`에 이미 lock이 있을 때 재진입 방지 로직 없음
- **수정**: `if (wakeLock) return` 가드 추가
- **테스트**: release 이벤트 시뮬레이션 추가 (실제 브라우저 동작 반영)

### 테스트: 103개 전부 통과

## 2026-02-26 (설정 저장 버그 + 위젯 persistence 버그 수정)

### 버그 수정 1: 설정이 저장되지 않는 문제 (content.js, popup.js)

#### 증상
- 팝업에서 설정을 변경하고 체크버튼을 눌러도 다음에 열면 이전 설정으로 돌아옴
- 스크롤 재생 중일 때 특히 저장 안 되는 경향

#### 원인
- `localStorage`는 **도메인별 격리** → 사이트 이동 시 설정 초기화
- `pushSettings()` 내부 `browser.tabs.query()` 가 **비동기** → 팝업이 닫히기 전에 resolve가 안 되면 `sendMessage` 미실행 → content.js `autoSaveSettings()` 미호출 → 저장 안 됨

#### 수정
- **`browser.storage.local`** (확장 스코프, 도메인 무관) 추가 도입:
  - `content.js loadSiteSettings()`: localStorage 동기 로드 후, `browser.storage.local.get()` 비동기 오버라이드
  - `content.js autoSaveSettings()`: localStorage + `browser.storage.local.set()` 동시 저장
  - `popup.js pushSettings()`: `send()` 호출 + `browser.storage.local.set()` 즉시 저장
  - `popup.js init`: `browser.storage.local.get()` 으로 UI 선 렌더링 (getState 응답 전에도 설정값 표시)
- **테스트 인프라**: `tests/setup.js`에 `browser.storage.local` 모크 추가

### 버그 수정 2: 확장 비활성화 후 플로팅 위젯 잔류 (content.js, background.js)

#### 증상
- Safari 확장프로그램 관리에서 확장을 껐는데도 플로팅 위젯이 화면에 남아 있음

#### 원인
- WebExtension 표준 동작: content script가 주입한 DOM은 확장 비활성화 후에도 페이지에 잔류
- JS 실행 컨텍스트가 살아있는 경우 `browser.*` API 호출은 실패하지만 DOM은 제거되지 않음

#### 수정 — keepalive port 방식
- **`content.js`**: 위젯 최초 생성 시 `browser.runtime.connect({ name: 'keepalive' })` 로 포트 연결
  - 포트가 끊기면(확장 비활성화 시) 1.5초 후 재연결 시도
  - 재연결 실패 시 위젯 DOM 제거
  - SPA 재생성 시 포트 중복 연결 방지 (`if (!_keepalivePort)` 가드)
- **`background.js`**: `browser.runtime.onConnect.addListener()` 추가 (연결 수락)
- **`tests/setup.js`**: `browser.runtime.connect` / `onConnect` 모크 추가

### 테스트: 103개 전부 통과 (경고 없음)

## 2026-02-26 (플로팅 위젯 상태 persistence 버그 3개 수정)

### 버그 수정 1: 축소 상태가 사이트 이동 후 초기화됨 (content.js)

#### 증상
- 플로팅 위젯을 축소(–) 상태로 만들고 다른 사이트로 이동하면 다시 확대 상태로 나타남

#### 원인
- `createWidget()`에서 항상 `widgetCollapsed = false`로 리셋
- SPA 이동 시 `onNavigate()` → `createWidget()` 재호출 → 축소 상태 손실
- 크로스-사이트 이동 시 content.js 재주입 → 변수 자체가 `false`로 초기화

#### 수정
- `WIDGET_COLLAPSED_KEY = 'aws_widget_collapsed'` 전역 스토리지 키 추가
- `toggleWidgetCollapse()`: localStorage + `browser.storage.local` 양쪽에 상태 저장
- `loadSiteSettings()`: localStorage(동기) + `browser.storage.local`(비동기)에서 collapsed 상태 복원
- `_applyWidgetCollapsedState()` 헬퍼 추가 — 비동기 콜백에서 DOM 반영
- `createWidget()`: `widgetCollapsed = false` 리셋 제거 → 현재 값으로 DOM 초기화

### 버그 수정 2: 사이트 이동 후 위젯 위치가 초기화됨 (content.js)

#### 증상
- 위젯을 드래그로 특정 위치에 고정해도 다른 사이트 이동 시 기본 위치(우하단)로 돌아옴

#### 원인
- `WIDGET_POS_KEY = aws_widget_pos_${hostname}` — 사이트별 격리 키 사용
- 다른 사이트에는 저장된 위치가 없으므로 기본 위치로 생성됨
- `browser.storage.local` 연동 없어 크로스-사이트 복원 불가

#### 수정
- `WIDGET_POS_GLOBAL_KEY = 'aws_widget_pos'` 전역 위치 키 추가
- `onWidgetDragEnd()`: localStorage(사이트별) + `browser.storage.local`(전역) 동시 저장
- `loadSiteSettings()` 비동기 콜백: 전역 위치 로드 → `cachedWidgetPos` 캐싱
- `createWidget()`: site-specific 위치 없으면 `cachedWidgetPos` 폴백 사용

### 버그 수정 3: 사이트 이동 시 위젯 위치 점프 현상 (content.js)

#### 증상
- 다른 사이트로 이동할 때 위젯이 잠깐 기본 위치에 나타났다가 저장된 위치로 이동 (점프)

#### 원인
- 위젯을 init 시 즉시 생성 → `browser.storage.local.get()`이 아직 비동기 대기 중
- `cachedWidgetPos`가 null인 상태로 `createWidget()` 실행 → 기본 위치로 생성
- 비동기 콜백 완료 후 위치 재적용 → 시각적 점프

#### 수정
- 위젯 생성을 `loadSiteSettings()` 비동기 콜백 내부로 이동 → `cachedWidgetPos` 준비 후 생성
- `setTimeout(300ms)` 폴백 — `browser.storage.local` 미응답 시 기본 위치로 생성
- `tests/setup.js`: `browser.storage.local.get` 모크를 동기 thenable로 변경 → 테스트에서 위젯이 즉시 생성되도록 보장

### 테스트: 103개 전부 통과

## 2026-02-26 (App Store 준비 — 번들 ID 변경 + Archive 빌드)

### 번들 ID 변경 (project.pbxproj)

#### 변경 내용
- 앱 이름(Scrolly)과 내부 번들 ID(AutoWebScroller) 불일치 해소
- App Store Connect 등록 전 마지막 변경 기회 (등록 후 영구 불변)

| 타겟 | 변경 전 | 변경 후 |
|------|---------|---------|
| 메인 앱 | `com.kjmoon.AutoWebScroller` | `com.kjmoon.Scrolly` |
| 확장 | `com.kjmoon.AutoWebScroller.Extension` | `com.kjmoon.Scrolly.Extension` |

#### 수정 파일
- `SafariExtensionApp/AutoWebScroller/AutoWebScroller.xcodeproj/project.pbxproj`: `PRODUCT_BUNDLE_IDENTIFIER` 4곳 변경

### Archive 빌드 완료
- `xcodebuild archive` — Release 구성, `~/Desktop/Scrolly.xcarchive` 생성 성공
- 버전: 1.3 (빌드 번호 3)
- Deployment Target: iOS 16.4

### App Store Connect 업로드 대기
- App Store Connect에 `com.kjmoon.Scrolly` 번들 ID로 앱 등록 후 `xcodebuild -exportArchive` 실행 예정

## 2026-02-26 (버그 수정 + UI 개선)

### 버그 수정: 플로팅 위젯 껐다 켜면 미표시 (content.js)

#### 증상
- 팝업에서 미니 컨트롤 표시 토글을 끈 후 다시 켜도 위젯이 나타나지 않음

#### 원인
- `popup.js`의 `send()` 함수는 `async` → `showWidget` 메시지 전송 전 팝업이 닫히면 컨텍스트 종료로 메시지 유실 가능
- `case 'showWidget'` 핸들러 진입 시점에 `settings.showWidget`이 아직 `false` → `showWidget()` 첫 줄 가드 `if (!settings.showWidget) return`에서 조기 종료
- `updateSettings` 메시지만 도달해도 widget 표시/숨김 처리 로직 없음

#### 수정 (content.js)
- `case 'showWidget'`: `settings.showWidget = true` 선행 후 `showWidget()` 호출
- `case 'hideWidget'`: `settings.showWidget = false` 선행 후 `hideWidget()` 호출
- `case 'updateSettings'`: `message.showWidget` 변경 감지 시 `showWidget()` / `hideWidget()` 직접 호출 (메시지 유실 폴백)

### UI 개선: 팝업 옵션 순서 변경 (popup.html)

#### 변경 전
속도 → 방향 → 옵션 → 타이머 → 제스처 → 플로팅 위젯

#### 변경 후
속도 → **플로팅 위젯** → 방향 → 옵션 → 타이머 → 제스처

- 자주 쓰는 위젯 토글을 속도 바로 아래로 이동

### 테스트: 103개 전부 통과

## 2026-02-27 (Wake Lock Race Condition 버그 수정 + v1.0.0 IPA 빌드)

### 버그 수정: Wake Lock async race condition (content.js)

#### 증상
- 스크롤 시작 직후 빠르게 정지 시 화면 꺼짐 방지가 해제되지 않고 남아있을 수 있음

#### 원인
- `acquireWakeLock()`은 `async` 함수 — `await navigator.wakeLock.request('screen')` 대기 중
- `stopScroll()` 호출 → `releaseWakeLock()` 실행 시점에 `wakeLock === null` → 아무것도 해제 안 함
- `request('screen')`이 나중에 resolve → `wakeLock` 세팅됨 → 스크롤 정지 상태인데 Wake Lock 보유

#### 수정 (content.js)
- `const lock = await navigator.wakeLock.request('screen')` — 임시 변수로 받음
- resolve 직후 `if (!isScrolling) { lock.release(); return; }` 재확인 가드 추가
- `isScrolling`이 false면 즉시 해제 후 `wakeLock` 변수에 저장하지 않음

### v1.0.0 (Build 1) IPA 빌드 — App Store 배포용

- **테스트**: 103개 전부 통과 확인 후 진행
- **아카이브**: `xcodebuild archive` → `~/Desktop/Scrolly.xcarchive`
- **IPA 내보내기**: `xcodebuild -exportArchive` (method: app-store) → `~/Desktop/Scrolly_IPA/Scrolly.ipa`
- **버전**: 1.0.0 / 빌드 번호 1
- **서명**: Apple Development (팀 QN975MTM7H), 자동 프로비저닝

## 2026-02-27 (IPA 파일명 Scrolly로 변경)

### PRODUCT_NAME 변경 (project.pbxproj)

#### 변경 내용
- IPA 파일명이 `AutoWebScroller.ipa`로 생성되던 문제 수정
- `PRODUCT_NAME = "$(TARGET_NAME)"` → 타겟 이름(AutoWebScroller)이 그대로 파일명에 반영되던 구조

| 타겟 | 변경 전 | 변경 후 |
|------|---------|---------|
| 메인 앱 PRODUCT_NAME | `$(TARGET_NAME)` → AutoWebScroller | `Scrolly` |
| 익스텐션 PRODUCT_NAME | `$(TARGET_NAME)` → AutoWebScroller Extension | `Scrolly Extension` |
| productName 필드 | AutoWebScroller / AutoWebScroller Extension | Scrolly / Scrolly Extension |

- 번들 ID(`com.kjmoon.Scrolly`), 타겟 이름, 소스 코드, 앱 기능에는 영향 없음
- 결과: `~/Desktop/Scrolly_IPA/Scrolly.ipa` (v1.0.0 Build 1)

## 2026-03-04 (플로팅 위젯 가로/세로 방향 전환 기능)

### 기능 추가 — widget orientation toggle (content.js)
- **배경**: 기존 플로팅 위젯은 세로(vertical) 레이아웃만 지원
- **수정**: orientBtn(↔/↕) 클릭으로 vertical ↔ horizontal 즉시 전환
  - **Vertical**: headerRow에 colBtn + orientBtn 나란히 배치, 세로 슬라이더(28×110, writing-mode:vertical-lr)
  - **Horizontal**: flex-row, 가로 슬라이더(110×28), width:auto
- **상태 저장**: `aws_widget_orientation` 키로 localStorage + browser.storage.local 양쪽 저장 (cross-site/새로고침 후 복원)
- **기타**: `_applyWidgetCollapsedState()` / `applyWidgetTheme()` orientation 인식 업데이트, 전환 시 드래그 위치 보존

### 테스트
- orientation toggle 테스트 11개 추가
- **115개 전부 통과**

### 배포
- 실기기(Moon iPhone Air) 빌드 + 설치 완료

## 2026-03-03 (content.js 버그·보안·성능 수정 4건)

### Fix 1 — Object.assign 화이트리스트 (content.js)
- **원인**: `Object.assign(settings, message)`로 외부 메시지를 그대로 병합 → `__proto__` 등 예상치 못한 키 오염 가능
- **수정**: 허용 키 배열(`SETTINGS_KEYS`) 루프로 교체, 알 수 없는 키 차단

### Fix 2 — contentAware dead code 전체 제거 (content.js)
- **원인**: `checkContentAware()` / `AD_SELECTORS` / `originalSpeed` / `contentAwareTimer` 선언은 있으나 함수가 어디서도 호출되지 않는 미완성 dead code
- **수정**: 관련 코드 전체 삭제 (121줄 감소), `stopScroll()` 내 `originalSpeed` 잔여 참조도 제거

### Fix 3 — scrollTarget 주기적 재탐지 (content.js)
- **원인**: `startScroll()` 시점에만 scroll container 캐싱 → 무한 스크롤 사이트에서 동적 변경 시 스크롤 중단
- **수정**: `scrollTargetTimer` 카운터 추가, 300프레임(≈5초)마다 `getScrollTarget()` 재호출, container 변경 시 `will-change` 이관

### Fix 4 — main.dart 문서 오류 수정
- **원인**: `main.dart` 자동 일시정지 설명에 "1.5초 후 자동 재개"라 기재 → 실제 content.js는 3초
- **수정**: "1.5초" → "3초"

### 테스트
- updateSettings 화이트리스트 테스트 1개 추가
- **104개 전부 통과**

## 2026-02-28 (앱 아이콘 수정)

### 아이콘 디자인 변경 (Icon-1024.png)

#### 변경 내용
- **"Scrolly" 텍스트 제거**: 아이콘 하단 텍스트 삭제
- **S 심볼 위치 조정**: 텍스트 제거로 생긴 여백을 보정하기 위해 60px 아래로 이동

#### 작업 방식
- Python + Pillow + NumPy 사용
- 2D 2차 다항식 피팅으로 흰색(S 심볼 + 텍스트) 영역의 그라디언트 배경 복원
- S 심볼 마스크 추출 (y < 820 기준) 후 60px 이동 합성
- 백업: `Icon-1024_backup.png`

#### 빌드 및 배포
- Release 빌드 → 실기기(iPhone Air) 설치 완료

### 앱 내부 UI 아이콘 교체 (Icon.png)

#### 문제
- `Main.html` 상단에 표시되는 아이콘(`Resources/Icon.png`)이 이전 디자인 그대로 유지됨
- 앱아이콘(`Icon-1024.png`)과 앱 실행 화면 아이콘이 불일치

#### 수정
- `Icon-1024.png`(새 아이콘)를 128×128px로 리사이즈 → `Resources/Icon.png` 교체
- 실기기 재설치 + App Store Connect 재업로드 완료

## 2026-02-28 (App Store 심사 거절 대응 + 빌드 2 업로드)

### App Store 심사 거절 사유 2건 수정

#### Guideline 5.2.5 — "Safari" 상표 위반
- **원인**: 앱 이름·부제목에 "Safari" 포함
- **수정**: README 제목 `Auto Scroller for Safari` → `Auto Web Scroller`
- **앱 이름 전 언어 통일** (`오토스크롤러` → `오토웹스크롤러` 기준):
  - Ko: Scrolly - 오토웹스크롤러
  - En: Scrolly - Auto Web Scroller
  - Ja: Scrolly - 自動Webスクローラー
  - Zh: Scrolly - 自动网页滚屏
  - Fr: Scrolly - Défilement Web Auto
  - Es: Scrolly - Scroll Web Auto
  - Hi: Scrolly - ऑटो वेब स्क्रॉलर

#### Guideline 1.5 — 지원 URL 미흡
- **원인**: `/issues` 빈 페이지 → 지원 정보 없음으로 판단
- **수정**: GitHub Pages 활성화 → 지원 URL을 `https://moonkj.github.io/Scrolly-App/` 으로 변경
- **개인정보처리방침 URL**: `https://moonkj.github.io/Scrolly-App/privacy-policy` 로 변경

### v1.0.0 Build 2 — App Store Connect 업로드

- **변경 내용**: 앱 아이콘 업데이트 (텍스트 제거 + 심볼 이동)
- **빌드 번호**: 1 → 2 (`agvtool new-version -all 2`)
- **아카이브**: `xcodebuild archive` → `~/Desktop/Scrolly.xcarchive`
- **업로드**: `xcodebuild -exportArchive` (destination: upload) → App Store Connect 직접 업로드 완료

## 2026-03-04 (코드 리뷰 28개 항목 전체 적용 — v1.0.1)

### 버전 통일: 1.0.1 (manifest.json, main.dart, CLAUDE.md, Xcode project)

### 버그 수정

#### C-1 — content.js triple-tap 핸들러 미선언 변수 참조
- **원인**: `originalSpeed = null` — 선언되지 않은 변수에 암묵적 전역(strict mode 위반)
- **수정**: 해당 줄 삭제 (triple-tap 속도 2x 초기화 동작에 영향 없음)

#### I-5 / I-6 — Object.assign 프로토타입 오염 취약점
- **원인**: `Object.assign(settings, JSON.parse(localStorage))` / `Object.assign(settings, cfg)` — `__proto__` 등 임의 키 주입 가능
- **수정**: 허용 키 8개 배열 화이트리스트 루프로 교체 (content.js `loadSiteSettings` 2곳, popup.js `applyState` 1곳)

#### S-4 — widgetOrientation 유효성 검사 누락
- **원인**: `updateSettings` 메시지에서 임의 문자열이 widgetOrientation에 저장될 수 있음
- **수정**: `['vertical','horizontal'].includes()` 검증 추가, 기타 값은 'vertical'로 폴백

### 성능 개선

#### S-6 — doScroll dt 캡 50ms → 100ms
- **배경**: 탭 전환 복귀 시 최대 50ms(약 3프레임)만 보상 → 복귀 직후 스크롤 속도 튀는 현상
- **수정**: 100ms로 완화 (약 6프레임, 탭 전환 흡수 효과 증가)

#### I-8 — resize clamp `setTimeout` 래퍼 분리
- **원인**: `_clampWidgetToViewport`를 resize 이벤트에 직접 등록 → horizontal 모드(`width:auto`)에서 `offsetWidth`가 layout 전에 읽혀 잘못된 위치로 클램프
- **수정**: `_onResizeClamp()` 래퍼 함수 추가 — `setTimeout(_clampWidgetToViewport, 0)`으로 레이아웃 페인트 후 실행

### 코드 품질

#### I-7 — 위젯 슬라이더 touchstart 리스너 주석 추가
- `passive:true` + `stopPropagation` 조합의 의도(네이티브 스크롤 허용, 위젯 드래그 차단) 명시

#### S-7 — SPA onNavigate 방어적 주석 추가
- JS ref 동기 초기화가 300ms 딜레이 타이머보다 먼저 실행되는 이유 설명

### 프로젝트 구조 개선

#### S-1 — package.json `sync` 스크립트 추가
- `npm run sync` 한 명령으로 ios/ → SafariExtensionApp/ 동기화

#### S-2 — ViewController.swift 미사용 코드 제거
- `WKScriptMessageHandler` 프로토콜 + `add(self, name: "controller")` + `userContentController(_:didReceive:)` 제거
- 제거 이유: 앱 WKWebView는 Main.html 정적 파일만 표시 → 메시지 핸들러 불필요, retain cycle 위험

#### S-3 — .gitignore `*.xcuserstate` 추가 + 기존 파일 추적 해제
- `UserInterfaceState.xcuserstate` (11KB 바이너리)는 IDE 상태 파일 → 버전 관리 불필요
- `git rm --cached` 로 기존 추적 파일 제거

#### C-2 / I-9 — CLAUDE.md 민감 정보 마스킹
- 기기 UDID, CoreDevice UUID → `<YOUR_DEVICE_UDID>`, `<YOUR_COREDEVICE_UUID>` 플레이스홀더
- DEVELOPMENT_TEAM ID → `<YOUR_TEAM_ID>` 플레이스홀더

### UI / UX

#### I-1 — manifest.json 존재하지 않는 아이콘 참조 수정
- `icon-16.png`, `icon-48.png` → 없는 파일 참조 → 브라우저 경고
- 실제 존재 파일(32/64/128)만 사용하도록 수정

#### I-2 — main.dart '콘텐츠 인식 속도' 미구현 기능 항목 제거
- 앱 소개 화면에서 구현되지 않은 기능 나열 → App Store 심사 위험 + 사용자 혼란
- `_FeatureRow` 항목 제거

#### I-3 — main.dart '사이트별 설정 저장' 설명 수정
- 변경 전: "사이트마다 다른 속도/옵션 기억" (사이트별 격리 암시, 실제 구현과 불일치)
- 변경 후: "마지막 설정을 자동으로 기억" (실제 동작 반영)

#### S-9 — popup.css min-width 320px → 300px
- 소형 화면에서 팝업이 잘리는 문제 완화
- `.option-label span`에 `text-overflow: ellipsis` + `max-width: 180px` 추가

### Flutter 앱

#### S-10 — `withOpacity()` deprecated → `withValues(alpha:)`
- Flutter 3.27+ 에서 `Color.withOpacity()` 사용 중단 경고 해소

#### S-11 — ThemeMode.system 적용
- 기존: 항상 다크 테마 고정
- 수정: `themeMode: ThemeMode.system` + 라이트 테마(`#F2F2F7`) / 다크 테마(`#1C1C1E`) 분리

### 테스트
- popup.test.js: `POPUP_DOM`에 `widgetOrientControl` 추가 + 3개 테스트 신규
- **119개 전부 통과**

### 배포
- iPhone Air + iPad Pro 빌드 + 설치 완료
- GitHub push 완료

## 2026-03-16 (스크롤 속도 버그 3건 수정 + 속도 모드 기능 추가)

### 버그 수정 1: 페이지 중간에서 스크롤이 느려지는 문제 (content.js)

#### 증상
- 페이지 상단에서는 빠르다가 아래로 내려가면 느려짐

#### 원인
- `scrollTargetTimer` (300프레임마다 scroll target 재감지) 가 뷰포트 중앙의 요소 기준으로 감지
- 페이지를 내려가다 댓글/사이드바 등 내부 스크롤 컨테이너가 중앙에 들어오면 target 교체
- 이후 `scrollBy()`가 작은 inner div에 적용 → 페이지 전체 스크롤 멈춤

#### 수정 (content.js)
- 재감지 조건 강화: **현재 스크롤 방향의 끝(엣지)에 도달했을 때만** 교체 허용
  - `direction=down`: `scrollTop + clientHeight >= scrollHeight - 2` 일 때만 교체
  - `direction=up`: `scrollTop <= 2` 일 때만 교체

### 버그 수정 2: 다음 페이지 이동 후 속도 변화 (content.js)

#### 증상
- SPA 페이지 이동 후 스크롤 재시작 시 속도가 다름 (느려짐)

#### 원인
- `getScrollTarget()` 초기 감지 시 뷰포트 중앙의 inner div를 target으로 잡음
- 버그 수정 1은 재감지만 막았고, **초기 감지**는 여전히 취약

#### 수정 (content.js) — `getScrollTarget()` page-first 휴리스틱
- `document.documentElement.scrollHeight > window.innerHeight + 1` 이면 항상 페이지 우선 사용
- 페이지가 스크롤 불가(SPA 고정 뷰포트)일 때만 inner container 감지 경로로 폴백
- 적용 범위: 일반 웹사이트(기사/블로그 등) → documentElement / SPA(Twitter·YouTube) → inner div 유지

### 버그 수정 3: 뒤로가기 후 속도 2배 + 정지 불가 (content.js)

#### 증상
- 다른 페이지 갔다가 이전 페이지로 돌아오면 스크롤 속도가 2배, 정지도 안 됨

#### 원인
- Safari **bfcache(Back/Forward Cache)**: 페이지를 캐시로 저장 시 JS 힙 상태 그대로 동결
- 복원 시 이전 IIFE의 RAF 루프가 살아있는 채로 부활
- content.js 재주입으로 새 IIFE의 RAF 루프까지 추가 → 두 루프 동시 실행 → 2배 속도

#### 수정 (content.js)
- `window.addEventListener('pagehide', stopScroll)` 추가
- 페이지가 bfcache로 들어가기 전 RAF 완전 취소 → 복원 시 이전 루프 없음

### 새 기능: 속도 모드 선택 (content.js, popup.html, popup.js)

#### 기능
- 팝업 속도 카드에 **곡선 / 선형** 토글 추가
  - **곡선**: 기존 s²×9 (낮은 단계 세밀, 높은 단계 급격히 빠름)
  - **선형**: s×20 (전 구간 균일하게 20px/s씩 증가)

#### 속도 비교

| 단계 | 곡선 (px/s) | 선형 (px/s) |
|------|------------|------------|
| 1 | 9 | 20 |
| 3 | 81 | 60 |
| 5 | 225 | 100 |
| 10 | 900 | 200 |
| 20 | 3600 | 400 |

#### 구현
- `settings.speedMode: 'curve' | 'linear'` 추가
- `speedToPps(s)`: `speedMode === 'linear' ? s * 20 : s * s * 9`
- 화이트리스트 4곳 모두 `speedMode` 추가 (loadSiteSettings 2곳, updateSettings 핸들러, popup.js applyState)
- 6개 언어 i18n 추가

### 프로젝트 구조 개선

#### npm run sync 수정 (package.json)
- 기존: `.js`만 복사
- 수정: `.js` + `.html` + `.css` 모두 복사
- 원인: popup.html 변경 시 Safari Extension Resources에 반영 안 되던 문제

#### CLAUDE.md — AI 협업 워크플로우 추가
- UX 설계자 → 설계자 → 코드 작성자 → 디버거 → 테스트 → 리뷰어 순서 정의
- 성능 최적화·문서화 담당은 요청 시에만 수행

### 테스트
- `getScrollTarget` page-first 테스트 2개 추가
- `scrollTarget` 재감지 hijack 방지 테스트 2개 추가
- `pagehide` bfcache 정리 테스트 2개 추가
- **125개 전부 통과**

---

## 2026-03-16 (v1.0.2 — 네이티브 앱 법적 페이지 수정 + GitHub Pages)

### 버그 수정 — 네이티브 앱 개인정보처리방침/이용약관 페이지 미작동

#### 증상
- 네이티브 앱(WKWebView) Main.html에서 개인정보처리방침 버튼을 탭해도 페이지가 열리지 않음

#### 원인
- `<div id="legal-view" class="hidden">` 의 표시/숨김 전환이 `.hidden { display:none }` CSS 클래스에 의존
- WKWebView가 `loadFileURL` + CSP(`default-src 'self'`)로 `file://` 페이지 로드 시, `../Style.css` (상위 디렉토리)가 동일 출처(same-origin)로 인식되지 않아 CSS 로드 차단
- `.hidden` 클래스에 정의된 스타일이 적용되지 않아 show/hide 전환이 동작하지 않음

#### 수정 (Main.html)
- `legalView` 초기 상태를 `class="hidden"` → `style="display:none"` 인라인 스타일로 변경
- `window.openPage()` / `window.closePage()` 에서 `classList.add/remove('hidden')` 대신 `style.display = 'none'/'flex'/''` 직접 조작으로 변경
- CSS 로드 여부와 무관하게 동작하도록 수정

### 기능 추가 — 지원 URL 버튼 + 외부 URL Safari 열기

#### 변경 내용 (Main.html + ViewController.swift)
- 개인정보처리방침 버튼: 인앱 뷰 → 외부 URL (`https://moonkj.github.io/Scrolly-App/privacy-policy`) Safari 오픈으로 변경
- 지원 버튼 신규 추가: `https://moonkj.github.io/Scrolly-App/` Safari 오픈
- `window.openExternalURL(url)` JS 함수 추가: `window.webkit.messageHandlers.openURL.postMessage(url)` 호출
- `ViewController.swift`: `WKScriptMessageHandler` 채택, `"openURL"` 메시지 수신 시 `UIApplication.shared.open(url)` 실행
- 6개 언어 모두 `support` i18n 키 추가

### GitHub Pages 생성 (moonkj/Scrolly-App)

- `index.html` — 지원 페이지 (`https://moonkj.github.io/Scrolly-App/`)
- `privacy-policy/index.html` — 개인정보처리방침 (`https://moonkj.github.io/Scrolly-App/privacy-policy`)
- GitHub Pages 활성화 (main 브랜치 루트 기준)
- App Store Connect 개인정보처리방침 URL: `https://moonkj.github.io/Scrolly-App/privacy-policy`
- App Store Connect 지원 URL: `https://moonkj.github.io/Scrolly-App/`

---

## 2026-02-26 (App Store Connect 현지화 문서 정비)

### document.md — 다국어 번역 추가

#### 섹션 3. 홍보 문구 (Promotional Text)
- 기존: 한국어(Ko) + 영어(En) 2개
- 추가: 일본어(Ja) / 중국어 간체(Zh) / 프랑스어(Fr) / 스페인어(Es) / 힌디어(Hi)

| 언어 | 홍보 문구 (요약) |
|------|----------------|
| Ja | 長い記事、レシピ、電子書籍 — 手を下ろして読みましょう。Scrolly が代わりにスクロールします。 |
| Zh | 长篇文章、食谱、电子书 — 放下双手，尽情阅读。Scrolly 替您滚动。 |
| Fr | Longs articles, recettes, e-books — posez vos mains. Scrolly défile pour vous. |
| Es | Artículos largos, recetas, e-books — baja las manos. Scrolly se desplaza por ti. |
| Hi | लंबे लेख, रेसिपी, ई-बुक — हाथ हटाइए और पढ़िए। Scrolly आपके लिए स्क्रॉल करता है। |

#### 섹션 4. 앱 설명 (Description)
- 기존: 한국어(Ko) + 영어(En) 2개
- 추가: 日本語 / 中文(简体) / Français / Español / हिन्दी (Hindi)
- 각 언어별 전체 설명 (기능 목록 + 사용방법 + 추천 대상) 번역 완성
- App Store Connect 각 언어 탭의 설명(Description) 필드에 바로 붙여넣기 가능한 형식
