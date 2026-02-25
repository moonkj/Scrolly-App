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
├── tests/                                     Jest 테스트 (64개)
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
| `updateSettings` | popup→content | 설정 객체 전달 + 자동 저장 |
| `showWidget` | popup→content | 플로팅 위젯 표시 |
| `hideWidget` | popup→content | 플로팅 위젯 숨김 |
| `stateChanged` | content→popup | 상태 변경 알림 |

## 스토리지

content.js 의 localStorage 는 **대상 페이지의 origin**에 저장된다.

| 키 | 내용 |
|----|------|
| `aws_settings` | 전역 스크롤 설정 JSON (사이트 구분 없음) |
| `aws_widget_pos_<hostname>` | 플로팅 위젯 위치 `{x, y}` JSON |

설정은 `updateSettings` 수신 시 **자동 저장**, 페이지 로드 시 **자동 불러오기**.

## Safari Web Extension 주의사항

- **Manifest V2** 사용 (V3는 iOS Safari에서 지원 불완전)
- `background.js` 는 non-persistent (event page) – 상태 유지 불가, 순수 중계만
- `touchstart/touchend/touchmove` 모두 `passive: false` 등록
  - `onWidgetDragMove` 에서만 `preventDefault()` 호출 (드래그 중일 때만)
  - 버튼/input 제외한 위젯 영역에서 드래그 시작: `!e.target.closest('button, input')`
- 제스처 콜백은 `setTimeout` 내에서 실행 → 이 시점의 `preventDefault` 는 무효
- 더블탭 줌: 현대 페이지는 viewport meta로 비활성화되어 있어 충돌 없음

## settings 객체 스키마

```js
{
  speed:            3,      // 1-20 (배속), 기본값 3
  direction:        'down', // 'down' | 'up'
  loop:             false,  // 끝에서 처음으로 복귀
  autoPause:        true,   // 터치 감지 시 일시정지 (3초 후 재개)
  timerMins:        0,      // 0=끔, 5~60분 (5분 단위)
  gestureShortcuts: true,   // 더블탭: 토글, 트리플탭: 속도 2x 초기화
  showWidget:       true    // 플로팅 위젯 표시
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
  DEVELOPMENT_TEAM=QN975MTM7H \
  build

# 3. 기기 설치
xcrun devicectl device install app \
  -d "<DEVICE_CoreDevice_UUID>" \
  "~/Library/Developer/Xcode/DerivedData/AutoWebScroller-***/Build/Products/Debug-iphoneos/AutoWebScroller.app"
```

| 기기 | UDID (xctrace) | CoreDevice UUID (devicectl) |
|------|----------------|------------------------------|
| Moon (iPhone Air) | `00008150-001128391EF0401C` | `835A5E84-05B4-520C-B52C-E69BBEE38FED` |

## 테스트

```bash
npm test   # Jest 64개 전부 통과
```

---

## 버전 히스토리

| 버전 | 주요 변경 |
|------|----------|
| 1.0.0 | 초기 릴리스: 속도/방향/루프/타이머/자동일시정지 |
| 1.1.0 | 제스처 단축키, 자동일시정지 강화, 콘텐츠인식속도, 플로팅위젯, 다크/라이트모드 |
| 1.2.0 | WebExtension API 전환, 다국어(6개), 위젯 드래그 개선, SafariExtensionApp 분리 |
