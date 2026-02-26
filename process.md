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
