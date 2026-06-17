# AutoWebScroller – 개발자 참고 문서

## 프로젝트 구조

```
AutoWebScroller/
├── SafariExtensionApp/AutoWebScroller/        ← 배포용 Xcode 프로젝트 (메인)
│   ├── AutoWebScroller Extension/Resources/   ← 확장 리소스 (ios/와 동일)
│   └── AutoWebScroller.xcodeproj
├── ios/SafariExtension/Resources/             ← 확장 리소스 소스
│   ├── manifest.json                          확장 매니페스트 (Manifest V2)
│   ├── popup.html / popup.css / popup.js      팝업 UI
│   ├── content.js                             스크롤 엔진 (웹페이지에 삽입)
│   └── background.js                          메시지 중계 레이어
├── tests/                                     Jest 테스트
└── XCODE_SETUP.md                             Xcode 통합 가이드
```

⚠️ **두 Resources 폴더는 항상 동일하게 유지해야 함**
코드 수정 후 반드시 동기화:
```bash
cp ios/SafariExtension/Resources/*.js \
   "SafariExtensionApp/AutoWebScroller/AutoWebScroller Extension/Resources/"
```

## 메시지 플로우 (WebExtension API)

```
popup.js
  → browser.tabs.sendMessage(tabId, { name, message })
    → content.js (browser.runtime.onMessage)

content.js
  → browser.runtime.sendMessage({ name: 'stateChanged', isScrolling, settings })
    → background.js (browser.runtime.onMessage)
      → browser.runtime.sendMessage(msg)  ← popup으로 릴레이
        → popup.js (browser.runtime.onMessage)
```

## 메시지 타입 전체 목록

| 메시지 | 방향 | 설명 |
|--------|------|------|
| `getState` | popup→content | 현재 상태 요청 |
| `toggle` | popup→content | 스크롤 시작/정지 토글 |
| `start` | popup→content | 강제 시작 |
| `stop` | popup→content | 강제 정지 |
| `quit` | popup→content | 스크롤 정지 + 위젯 DOM 제거 + `showWidget=false` 저장 |
| `updateSettings` | popup→content | 설정 객체 전달 + 자동 저장 |
| `showWidget` | popup→content | 플로팅 위젯 표시 |
| `hideWidget` | popup→content | 플로팅 위젯 숨김 |
| `stateChanged` | content→popup | 상태 변경 알림 |

## 스토리지

content.js 의 localStorage 는 **대상 페이지의 origin**에 저장된다.
`browser.storage.local` 은 **확장 전역**(cross-domain) 저장소로, 도메인 이동 후에도 유지된다.

| 키 | 저장소 | 내용 |
|----|--------|------|
| `aws_settings` | localStorage + extension | 전역 스크롤 설정 JSON (사이트 구분 없음) |
| `aws_widget_pos_<hostname>` | localStorage | 플로팅 위젯 위치 `{x, y}` (origin별) |
| `aws_widget_pos` | extension | 위젯 전역 위치 `{x, y}` (cross-domain 복원용) |
| `aws_widget_collapsed` | localStorage | 위젯 접힘 상태 `'1'|'0'` (origin별, cross-domain 미동기화) |
| `aws_series_intent` | extension | 정주행 재개 인텐트 `{ts}` (one-shot, 30초 TTL) |

설정은 `updateSettings` 수신 시 **자동 저장**, 페이지 로드 시 **자동 불러오기**.

## Safari Web Extension 주의사항

- **Manifest V2** 사용 (V3는 iOS Safari에서 지원 불완전)
- `background.js` 는 non-persistent (event page) – 상태 유지 불가, 순수 중계만
- `touchstart/touchend/touchmove` 모두 `passive: false` 등록
  - `onWidgetDragMove` 에서만 `preventDefault()` 호출 (드래그 중일 때만)
  - 버튼/input 제외한 위젯 영역에서 드래그 시작: `!e.target.closest('button, input')`
- 제스처 콜백은 `setTimeout` 내에서 실행 → 이 시점의 `preventDefault` 는 무효
- 더블탭 줌: 현대 페이지는 viewport meta로 비활성화되어 있어 충돌 없음
- **bfcache**: `pagehide` 에서 RAF 취소 필수 (복원 시 이전 IIFE의 RAF 중복 실행 방지), `pageshow(persisted=true)` 시 스크롤 상태 + `seriesResumeIntent` 초기화
- **정주행 모드(seriesMode)**: 두 가지 이동 케이스 분리
  - SPA 이동(pushState/replaceState/popstate): `onNavigate()` 에서 `wasScrolling`/`seriesResumeIntent` 캡처 → 300ms 후 `startScroll()`. 연속 navigate는 `navigateTimer` 로 1개로 합침
  - 전체 페이지 이동: `pagehide` 에서 `aws_series_intent{ts}` 저장 → 새 페이지 `loadSiteSettings()` 가 읽어 자동 시작 (one-shot, 30초 TTL)
  - `seriesResumeIntent`: 페이지 끝 자동 정지 시에만 set. 타이머 만료/bfcache 복원에서는 명시적으로 clear

## settings 객체 스키마

```js
{
  speed:             3,          // 1-20 (배속), 기본값 3
  speedMode:         'curve',    // 'curve' (s²×9 px/s) | 'linear' (s×20 px/s)
  direction:         'down',     // 'down' | 'up'
  loop:              false,      // 끝에서 처음으로 복귀
  autoPause:         true,       // 터치 감지 시 일시정지 (3초 후 재개)
  timerMins:         0,          // 0=끔, 5~60분 (5분 단위)
  gestureShortcuts:  true,       // 더블탭: 토글, 트리플탭: 속도 2로 리셋
  showWidget:        true,       // 플로팅 위젯 표시
  widgetOrientation: 'vertical', // 'vertical' | 'horizontal'
  seriesMode:        false       // 정주행: 페이지 이동 시 스크롤 자동 재개
}
```

## 빌드 및 배포

```bash
# 1. 테스트
npm test

# 2. Xcode 빌드 (SafariExtensionApp)
xcodebuild \
  -project "SafariExtensionApp/AutoWebScroller/AutoWebScroller.xcodeproj" \
  -scheme "AutoWebScroller" \
  -configuration Debug \
  -destination "id=<DEVICE_UDID>" \
  -allowProvisioningUpdates \
  CODE_SIGN_STYLE=Automatic \
  DEVELOPMENT_TEAM=<YOUR_TEAM_ID> \
  build

# 3. 기기 설치
xcrun devicectl device install app \
  -d "<DEVICE_CoreDevice_UUID>" \
  "~/Library/Developer/Xcode/DerivedData/AutoWebScroller-***/Build/Products/Debug-iphoneos/AutoWebScroller.app"
```

| 기기 | UDID (xctrace) | CoreDevice UUID (devicectl) |
|------|----------------|------------------------------|
| Moon (iPhone Air) | `<YOUR_DEVICE_UDID>` | `<YOUR_COREDEVICE_UUID>` |

## 테스트

```bash
npm test   # 전체 테스트 통과
```

---

## AI 협업 워크플로우 (역할 분담)

요청을 받으면 아래 순서대로 역할을 순차적으로 수행한다.
**(7) 성능 최적화 담당**과 **(8) 문서화 담당**은 명시적으로 요청된 경우에만 수행한다.

### (1) UX 설계자 (UX Designer)
- 사용자 시나리오와 유저 플로우를 정의한다.
- 각 화면의 목표, 필요한 정보, 주요 액션을 와이어프레임 수준으로 설명한다.
- 빈 상태, 로딩, 에러 등 예외적인 UX 상태를 미리 정의한다.
- 사용자가 가장 쉽게 수행해야 할 핵심 행동의 우선순위를 정한다.
- UX 설계가 필요 없을 시 바로 설계자로 이동한다.

### (2) 설계자 (Architect)
- 사용자의 요청을 분석한다.
- 핵심 기능, 요구사항, 입·출력 정의, 기술 스택, 구현 단계를 계획한다.
- 구체적이고 실행 가능한 설계안을 목록 형태로 작성한다.
- 산출물: "설계 요약"

### (3) 코드 작성자 (Coder)
- 설계자의 계획에 따라 실제 코드를 작성한다.
- 코드는 완전하게 실행 가능한 형태로 제시하며, 필요 시 간단한 주석만 포함한다.
- 기존 컨벤션(AppColors, Riverpod 패턴 등) 준수.
- 산출물: 코드 블록 (Swift / Dart / JS 등)

### (4) 코드 디버거 (Debugger)
- 코드 작성자의 결과를 세밀히 점검한다.
- 논리 오류, 실행 오류, 예외 상황, 미처 처리되지 않은 조건 등을 분석한다.
- 문제점을 목록화하고, 수정이 필요한 부분을 제안한다. 수정 후 코드 작성자 단계로 복귀.
- 오류 없으면 이 단계 생략.
- 산출물: "버그 리포트 및 수정 제안"

### (5) 테스트 작성자 (Test Engineer, 선택)
- 버그 가능성이 높거나 중요한 로직을 테스트 대상으로 선정한다.
- 단위 테스트, 위젯 테스트, 통합 테스트 중 적합한 방식을 제안한다.
- 핵심 시나리오에 대한 테스트 코드 예시 또는 테스트 케이스(입력–기대 결과)를 작성한다.
- 향후 리팩터링 시 동작을 보장할 수 있는 안전망을 설계한다.
- 테스트 문제 시 다시 디버거로 이동한다.

### (6) 리뷰어 (Reviewer)
- 최종 코드를 품질 관점(가독성, 유지보수성, 확장성)에서 검토한다.
- "좋은 점"과 "개선할 부분"을 각각 항목별로 정리한다.
- **개선할 부분이 존재하면 즉시 설계자(2단계)로 복귀하여 개선 사이클을 다시 수행한다.**
  - 개선 사이클 재진입 시 출력 헤더에 `(개선 R2)`, `(개선 R3)` 등 라운드를 표기한다.
  - 개선할 부분이 없을 때만 최종 완료로 처리한다.
- 산출물: "코드 리뷰 결과"

### (7) 성능·최적화 담당 (Performance Engineer) — 요청 시에만
- 렌더링/리빌드 횟수, 비동기 처리, 캐싱 전략을 체크한다.
- Flutter: `ListView.builder`, `const` 위젯, 상태 범위 최소화 등.
- API: 디바운싱, pagination, lazy loading, 캐시.
- 리뷰어(6단계) 전에 수행한다.

### (8) 문서화 담당 (Doc Writer) — 요청 시에만
- 클래스/위젯 역할, 주요 의존성, 설정 방법, 주의사항을 짧게 정리한다.
- GitHub README나 Notion에 그대로 복붙 가능한 형태로 작성한다.
- 최종 정리 시에만 수행한다.

---

## 버전 히스토리

| 버전 | 주요 변경 |
|------|----------|
| 1.0.0 | 초기 릴리스: 속도/방향/루프/타이머/자동일시정지 |
| 1.0.1 | 위젯 가로/세로 방향 전환, 다국어(6개), 위젯 드래그 개선, SafariExtensionApp 분리 |
| 1.0.2 | 속도 곡선 모드(speedMode: curve/linear) 추가, 스크롤 속도 버그 수정 |
| 1.0.3 | 종료(Quit) 버튼, 명시적 end-of-page 체크, 위젯 부활 버그 수정 |
| 1.0.4 | v1.0.3 빌드 통합 안정 릴리스 |
| 1.0.5 | 정주행 모드(seriesMode) 추가 — 페이지 이동 시 스크롤 자동 재개 |
| 1.0.6 | 정주행 모드 버그 수정 (페이지 끝 도달 후 다음 페이지 자동 재개) + 코드 리뷰 라운드 (D1~D3, C2, 테스트 보강) |
| 1.0.7 | v1.0.6 코드 리뷰 수정(D1~D3) 반영 빌드 + App Store 설명 7개 언어 최신화 |
