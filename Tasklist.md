# Scrolly v1.0.2 — 팀 에이전트 전체 코드 리뷰 Tasklist

**시작일**: 2026-04-07
**모드**: 팀 에이전트 병렬 실행 (5인 협업)
**범위**: 전체 코드베이스 (한 줄도 빼지 않음)
**상태**: ✅ 1라운드 완료 → ✅ 2라운드 완료 (즉시 수정 + 신규 버그 + 종료 기능)

## 2라운드 진행 결과 (2026-04-07)

### 적용된 수정
- ✅ **C1 + H3 통합** — `SETTINGS_KEYS` 단일 상수, popup.js Object.assign → whitelist
- ✅ **H1** — scrollTarget 재감지 후 같은 프레임 scrollBy 스킵
- ✅ **Bug N1 (끝에서 재실행)** — stuck 감지 (180프레임/3초 위치 미변화 시 자동 정지)
- ✅ **Bug N2 (페이지 이동 재실행)** — pageshow bfcache 복원 시 강제 stopScroll
- ✅ **종료(Quit) 기능** — popup `✕` 버튼 + content `quitScroll()` + 6개 언어 i18n

### 테스트
- 125 → **133개** (8개 신규)
- 신규 describe: pageshow / quit / stuck detection
- 커버리지: content.js 94.12% / popup.js 92.5% / background.js 94.73%

### 보류 (다음 라운드)
- H2 (doScroll loop 비활성 early return) — 작업 영역 충돌로 분리
- M1~M6, L1~L6 (1라운드 발견) — 1.1.0 리팩터링

---


---

## 코드 범위 (검토 완료)

### Safari Extension (ios/SafariExtension/)
- [x] content.js (스크롤 엔진)
- [x] popup.js (확장 팝업 UI)
- [x] background.js (메시지 중계)
- [x] popup.html / popup.css
- [x] manifest.json
- [x] SafariWebExtensionHandler.swift

### Native App (SafariExtensionApp/AutoWebScroller/)
- [x] AppDelegate.swift
- [x] SceneDelegate.swift
- [x] ViewController.swift (WKWebView 호스트)
- [x] Resources/Base.lproj/Main.html
- [x] Resources/Style.css
- [x] AutoWebScroller Extension/SafariWebExtensionHandler.swift

### Tests
- [x] tests/content.test.js
- [x] tests/popup.test.js
- [x] tests/background.test.js
- [x] tests/setup.js

### Config / Pages
- [x] package.json / jest.config.js
- [x] github-pages/index.html, privacy-policy/index.html

---

## 팀원 진행 상황 — 모두 완료 ✅

| 팀원 | 역할 | 상태 | 주요 결론 |
|------|------|------|----------|
| 리더 (Architect) | UX/UI + 통합 + 최종 판단 | ✅ | 출시 가능, Critical 1건 즉시 수정 권장 |
| Teammate 1 (Coder) | 일관성·컨벤션 | ✅ | 70/100, 설정 키 4중 중복 등 |
| Teammate 2 (Debugger) | 잠재 버그 | ✅ | Critical 1건 (Object.assign), High 1건 (scrollTarget race) |
| Teammate 3 (Tester+Reviewer) | 커버리지·최종 리뷰 | ✅ | 커버리지 94.35%, 출시 승인 |
| Teammate 4 (Perf+Doc) | 성능·문서 | ✅ | doScroll 루프 비활성 시 최적화 가능 |

---

## 발견 사항 (Findings)

### ⚠️ Critical / High (즉시 또는 단기 수정 권장)

| ID | 파일:라인 | 발견자 | 문제 | 우선순위 |
|----|----------|--------|------|----------|
| C1 | popup.js:393 | Debugger + Reviewer | `Object.assign(settings, result[SETTINGS_KEY])` 프로토타입 오염 위험 — content.js는 화이트리스트 사용 중인데 popup.js만 누락 | **Critical** |
| C2 | content.js:702-786 (`updateSettings`) | Reviewer | message 객체 직접 사용 — 화이트리스트 검증 부재 (가능 영향 낮으나 일관성) | High |
| H1 | content.js:201-219 | Debugger | scrollTarget 재감지 후 같은 프레임에 `scrollBy()` → iOS Safari scrollTop 비동기 갱신 문제 | High |
| H2 | content.js:189-250 (doScroll) | Performance + Coder + Debugger | 매 프레임 불필요한 layout reads (특히 loop 비활성 시) → battery 영향 | High |
| H3 | popup.js / content.js (4곳) | Coder | 설정 키 배열 4곳 중복 (popup.js:265, content.js:85, 100, 726) | High |

### Medium

| ID | 파일:라인 | 발견자 | 문제 |
|----|----------|--------|------|
| M1 | content.js:79-117 | Coder | `loadSiteSettings()` 99줄 — 동기/비동기/위젯 생성 혼재 |
| M2 | content.js:702-786 | Coder | `updateSettings` 핸들러 너무 길고 책임 다수 |
| M3 | content.js:185-253 | Coder | `doScroll()` 책임 과다 (SPA 체크 + 타겟 재감지 + autoPause + delta + loop) |
| M4 | content.js:566-569 | Debugger (가설) | `darkModeListener`: 매번 새 `matchMedia` 객체 생성 → removeEventListener 무효 가능성 (검증 필요) |
| M5 | content.js:113 vs 836 | Debugger | `loadSiteSettings()` 비동기 콜백 vs 300ms 타이머 race condition |
| M6 | content.js:415-445 | Reviewer | 위젯 vertical/horizontal cssText 70% 중복 |

### Low (Nice-to-have)

| ID | 파일:라인 | 발견자 | 문제 |
|----|----------|--------|------|
| L1 | content.js (전역) | Coder | IIFE 838줄 — 모듈화 가능 |
| L2 | content.js | Coder | 변수 축약 (`st`, `pps`, `lb`, `sl`) |
| L3 | content.js | Coder | Magic numbers (100, 60, 20, 300, 120, 800) |
| L4 | popup.html | Coder | `lang="ko"` 고정, JS에서 동적 갱신 부재 |
| L5 | content.js:154-174 (`getScrollTarget`) | Reviewer | 깊이 제한 없는 while → 극단적 DOM 깊이에서 위험 |
| L6 | content.js:311-313 | Debugger (가설) | visibilitychange 리스너 정리 부재 (실제 영향 낮음) |

---

## 테스트 / 커버리지

### 실측 (Tester 보고)
| 파일 | Line | Branch | Func |
|------|------|--------|------|
| content.js | 94.27% | 74.88% | 89.18% |
| popup.js | 94.5% | 79.06% | 100% |
| background.js | 94.73% | 100% | 100% |
| **전체** | **94.35%** | **75.91%** | **90.9%** |

**총 125개 테스트 통과**

### 누락 권장 시나리오 (P0/P1)
- P0: `_connectKeepalive()` port disconnect 시 widget 제거
- P0: popup.js storage 실패 폴백
- P1: visibilitychange 후 wake lock 회복
- P1: scrollTargetTimer 300프레임 throttle 정확성
- P1: gesture inhibit 800ms 경계값
- P1: popup.js sendMessage rejection 처리

---

## 과학적 토론 (Cross-Layer)

### 토론 1: popup.js Object.assign — Critical 합의
- **Debugger**: 프로토타입 오염 위험 (Critical/Medium)
- **Reviewer**: 화이트리스트 누락 (Critical)
- **Coder**: 설정 키 배열 중복 문제와 같은 뿌리 (High)
- **결론**: 같은 문제의 다른 측면. 즉시 수정. **C1 + H3 통합 수정** — `SETTINGS_KEYS` 상수 1개 정의 후 4곳 모두 사용

### 토론 2: doScroll RAF 효율 — 정확성 + 성능 동시 수정
- **Debugger**: scrollTarget 재감지 직후 즉시 scrollBy → iOS Safari quirk으로 이전 값 사용
- **Performance**: 매 프레임 layout reads 누적 → battery 5~10% 영향
- **Coder**: 함수 책임 과다
- **결론**: 같은 함수에 대한 3가지 관점. 단순 분할로는 부족. **H1 + H2 + M3 통합 리팩터링** 필요. 단기로는 H1 (return) + H2 (loop early-exit)만 적용

### 토론 3: darkModeListener — 가설 검증 필요
- **Debugger 가설**: `window.matchMedia()`가 매번 새 객체 반환 → removeEventListener가 이전 객체에 적용되어 무효
- **다른 팀원**: 언급 없음 (process.md에 fix 기록)
- **검증**: 현재 코드(content.js:566-569)는 `const mq = window.matchMedia(...)` 매번 새로 생성 → 가설이 맞으면 누수 지속
- **결론**: **검증 필요 — 다음 라운드에서 mq 캐싱 적용**

### 토론 4: 출시 차단 여부
- 4명 모두 **출시 가능** 합의
- 단, **C1 (Object.assign)** 는 빠른 수정이 가능하므로 출시 전 처리 권장

---

## 최종 결론 / Action Items

### 🟢 출시 판정: **승인** (단 C1 권장 수정 후)

### 즉시 수정 (출시 전, 30분 이내)
- [ ] **C1 + H3 통합**: `SETTINGS_KEYS` 단일 상수 도입, popup.js Object.assign → whitelist 루프

### 단기 수정 (1.0.3 또는 패치)
- [ ] **H1**: `doScroll` scrollTarget 전환 프레임에서 scrollBy 스킵 (return + RAF 재등록)
- [ ] **H2**: `doScroll` loop 비활성 시 early return (battery 5~10%)
- [ ] **M4 검증**: darkModeListener `mq` 객체 캐싱 (전역 변수)
- [ ] **L5**: `getScrollTarget` while 깊이 제한 50

### 중기 (1.1.0)
- [ ] M1: `loadSiteSettings()` 분할
- [ ] M2: `updateSettings` 핸들러 헬퍼 함수 추출
- [ ] M3: `doScroll()` 책임 분할 (SPA 체크/타겟 재감지/loop 분리)
- [ ] M5: 비동기 콜백 vs 300ms 타이머 race 정리
- [ ] M6: 위젯 cssText → CSS 클래스
- [ ] 누락 테스트 P0/P1 추가

### 문서화 (P0)
- [ ] content.js 전역 변수 JSDoc (`spaCheckTimer`, `scrollTargetTimer`, `gestureInhibitUntil`)
- [ ] `doScroll()` 함수 JSDoc (RAF 책임 명시)
- [ ] storage 키 3종 차이 주석 (`SETTINGS_KEY`, `WIDGET_POS_KEY`, `WIDGET_POS_GLOBAL_KEY`)
- [ ] CLAUDE.md: speedMode / wake lock / autoPause RAF 멈춤 섹션 추가

### 문서화 (P1/P2)
- [ ] 주요 함수 JSDoc (`getScrollTarget`, `speedToPps`, `handleGestureTap`)
- [ ] README.md 생성 (영어, 리포 최상위)
- [ ] tests/README.md
