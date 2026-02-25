# AutoWebScroller – 버그 수정 기록

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
