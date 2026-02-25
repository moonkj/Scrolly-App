# AutoWebScroller – 개발자 참고 문서

## 프로젝트 구조

```
AutoWebScroller/
├── lib/main.dart                          Flutter 컨테이너 앱 (안내 화면)
├── ios/SafariExtension/Resources/
│   ├── manifest.json                      확장 매니페스트 (Manifest V2)
│   ├── popup.html / popup.css / popup.js  팝업 UI
│   ├── content.js                         스크롤 엔진 (웹페이지에 삽입)
│   └── background.js                      메시지 중계 레이어
└── XCODE_SETUP.md                         Xcode 통합 가이드
```

## 메시지 플로우

```
popup.js
  → safari.extension.dispatchMessage(name, data)
    → background.js  (safari.application.addEventListener)
      → tab.page.dispatchMessage(name, data)
        → content.js (safari.self.addEventListener)

content.js
  → safari.extension.dispatchMessage('stateChanged', data)
    → background.js
      → toolbarItem.popover.contentWindow.postMessage({type:'stateChanged',...})
        → popup.js (window.addEventListener('message'))
```

## 메시지 타입 전체 목록

| 메시지 | 방향 | 설명 |
|--------|------|------|
| `getState` | popup→content | 현재 상태 요청 |
| `toggle` | popup→content | 스크롤 시작/정지 토글 |
| `start` | popup→content | 강제 시작 |
| `stop` | popup→content | 강제 정지 |
| `updateSettings` | popup→content | 설정 객체 전달 |
| `saveSiteSettings` | popup→content | localStorage에 현재 설정 저장 |
| `loadSiteSettings` | popup→content | localStorage에서 설정 불러오기 |
| `showWidget` | popup→content | 플로팅 위젯 표시 |
| `hideWidget` | popup→content | 플로팅 위젯 숨김 |
| `stateChanged` | content→popup | 상태 변경 알림 |

## 스토리지

content.js 의 localStorage 는 **대상 페이지의 origin**에 저장된다.
즉 `example.com` 에서 설정하면 `example.com` 의 localStorage에 저장된다.
이것이 의도된 동작이다 – 사이트별 설정 저장 기능의 기반이다.

| 키 | 내용 |
|----|------|
| `aws_settings_<hostname>` | 사이트별 스크롤 설정 JSON |
| `aws_widget_pos_<hostname>` | 플로팅 위젯 위치 `{x, y}` JSON |

`safari.extension.settings.getItem()` 은 **사용 불가** – 레거시 App Extension API.
Safari Web Extension에서는 동작하지 않는다. localStorage 사용.

## Safari Web Extension 주의사항

- **Manifest V2** 사용 (V3는 iOS Safari에서 지원 불완전)
- `background.js` 는 non-persistent (event page) – 상태 유지 불가, 순수 중계만
- `touchstart` passive:false 는 드래그/제스처 핸들러에서만 사용
  - 광범위한 preventDefault 금지 → 페이지 스크롤 차단됨
- 제스처 콜백은 setTimeout 내에서 실행 → 이 시점에서의 preventDefault 는 무효
  (터치 이벤트가 이미 완료된 후이므로 네이티브 제스처에 영향 없음)
- 더블탭 줌: 현대 페이지는 viewport meta로 비활성화되어 있어 충돌 없음

## settings 객체 스키마

```js
{
  speed:            2,      // 1-20 (배속)
  direction:        'down', // 'down' | 'up'
  loop:             false,  // 끝에서 처음으로 복귀
  smooth:           true,   // CSS smooth 애니메이션
  autoPause:        true,   // 터치 감지 시 일시정지
  timerMins:        0,      // 0=끔, 5-60분
  gestureShortcuts: true,   // 더블/트리플탭 단축키
  contentAware:     false,  // 광고/이미지 인식 속도 조절
  showWidget:       false   // 플로팅 위젯 표시
}
```

## 빌드 방법

```bash
# Flutter iOS 빌드
flutter build ios --no-codesign

# Xcode로 열기
open ios/Runner.xcworkspace
```

Xcode Safari Extension 타겟 설정은 XCODE_SETUP.md 참고.

## TDD 접근법 (권장)

### RED → GREEN → REFACTOR 사이클

1. **RED**: 테스트 먼저 작성 → 실행 → 실패 확인 (iOS 시뮬레이터에서 실행)
   ```bash
   flutter test test/unit/bible_repository_test.dart
   ```

2. **GREEN**: 테스트를 통과하는 최소한의 코드 작성 (iOS에서 검증)

3. **REFACTOR**: 테스트를 유지하며 코드 품질 개선 (iOS에서 재검증)

### 커버리지 목표: 70%+
```bash
flutter test --coverage
genhtml coverage/lcov.info -o coverage/html
open coverage/html/index.html
```

---

## 버전 히스토리

| 버전 | 주요 변경 |
|------|----------|
| 1.0.0 | 초기 릴리스: 속도/방향/루프/타이머/자동일시정지 |
| 1.1.0 | 제스처 단축키, 강화된 자동일시정지, 콘텐츠인식속도, 플로팅위젯, 다크/라이트모드, localStorage 버그 수정 |
