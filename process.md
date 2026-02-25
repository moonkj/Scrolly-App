# AutoWebScroller – 개발 진행상황

## 현재 버전: v1.2 (배포 완료)

### 프로젝트 구조
- **확장 리소스**: `ios/SafariExtension/Resources/` ↔ `SafariExtensionApp/AutoWebScroller/AutoWebScroller Extension/Resources/` (동일)
- **배포 방식**: SafariExtensionApp Xcode 프로젝트 자동 서명 → `xcrun devicectl device install app`
- **테스트**: Jest 64개 전부 통과 (`npm test`)

---

## 구현 완료 기능

### 스크롤 엔진 (content.js)
- [x] `requestAnimationFrame` 기반 스크롤 루프
- [x] 델타타임 방식 (프레임레이트 무관하게 px/s 일정)
- [x] 2차 속도 커브: `speed² × 9` px/s (speed 1→9px/s, speed 10→900px/s)
- [x] 스크롤 대상 자동 감지 (viewport 중심에서 scrollable 요소 탐색)
- [x] 루프 모드 (끝→처음, 위→끝 자동 복귀)
- [x] 타이머 자동 정지 (0~60분, 5분 단위)
- [x] `will-change: scroll-position` 힌트로 렌더링 최적화

### 자동 일시정지
- [x] `touchstart` → 즉시 일시정지
- [x] `touchend` → 3초 후 재개
- [x] `wheel` 이벤트도 감지

### 제스처 단축키
- [x] 더블탭 → 스크롤 토글 (일시정지/재개)
- [x] 트리플탭 → 속도 2x로 초기화
- [x] 500ms 창 내 탭 카운트, `clearTimeout+setTimeout` 패턴으로 배타적 처리

### 콘텐츠 인식 속도 (content.js)
- [x] 광고 요소 감지 시 속도 3배 증가
- [x] 이미지 3개 이상 뷰포트 진입 시 속도 0.5배 감소
- [x] 해당 구간 벗어나면 원래 속도 복원
- [x] 60프레임마다 스로틀 처리 (성능 최적화)
- ⚠️ 팝업 UI 없음 (켜기/끄기 토글 미구현 — contentAware 기본값 false)

### 플로팅 위젯 (content.js)
- [x] `div#__aws_widget__` DOM 주입
- [x] 수직 미니 슬라이더 (1~20x)
- [x] 시작/정지 버튼 (색상으로 상태 구분)
- [x] 접기(–/+) 버튼
- [x] touch 드래그, viewport 경계 클램프
- [x] 위치 `localStorage(aws_widget_pos_<hostname>)` 저장/복원
- [x] SPA 네비게이션 후 자동 재주입 (120프레임마다 DOM 체크 + history 인터셉트)
- [x] 다크/라이트 모드 동적 테마 (`window.matchMedia`)

### 팝업 UI (popup.js / popup.html)
- [x] 시작/정지 버튼 + 상태 표시 도트 (애니메이션)
- [x] 속도 슬라이더 (1~20x)
- [x] 방향 세그먼트 버튼 (↓ 아래 / ↑ 위)
- [x] 루프 모드 토글
- [x] 자동 일시정지 토글
- [x] 타이머 슬라이더 (0~60분)
- [x] 제스처 단축키 토글
- [x] 플로팅 위젯 토글
- [x] 다크/라이트 모드 자동 전환 (`popup.css`)

### 다국어 (popup.js)
- [x] 한국어 (`ko`)
- [x] 영어 (`en`)
- [x] 일본어 (`ja`)
- [x] 중국어 (`zh`)
- [x] 프랑스어 (`fr`)
- [x] 힌디어 (`hi`)
- [x] 시스템 언어 자동 감지 (`navigator.language`)

### 설정 저장 (content.js)
- [x] `updateSettings` 수신 시 `localStorage(aws_settings)` 자동 저장
- [x] 페이지 로드 시 자동 불러오기
- ⚠️ 글로벌 키 사용 (사이트별 분리 없음, hostname 구분 미적용)

### 메시지 아키텍처
- [x] WebExtension API (`browser.*`) 사용
- [x] popup → content: `browser.tabs.sendMessage`
- [x] content → popup: `browser.runtime.sendMessage` → background 릴레이
- [x] background: `stateChanged` 메시지만 릴레이 (순수 중계, 무상태)

### SPA 대응
- [x] `history.pushState` / `replaceState` 인터셉트
- [x] `popstate` 이벤트 감지
- [x] 네비게이션 시 스크롤 중지 + 300ms 후 위젯 재주입

---

## 배포 방법

```bash
# Xcode에서 빌드 후 커맨드라인 설치
xcrun devicectl device install app \
  -d "835A5E84-05B4-520C-B52C-E69BBEE38FED" \
  "~/Library/Developer/Xcode/DerivedData/AutoWebScroller-***/Build/Products/Debug-iphoneos/AutoWebScroller.app"
```

---

## 테스트 현황

```bash
npm test  # 64개 전부 통과
```

| 파일 | 테스트 수 |
|------|----------|
| background.test.js | 5개 |
| popup.test.js | 약 30개 |
| content.test.js | 약 29개 |

---

## v1.3 후보 (미구현)

- [ ] 플로팅 위젯에 방향 전환 버튼 추가
- [ ] 스크롤 프리셋 (독서모드, 뉴스모드, 웹툰모드)
- [ ] 멀티탭 상태 동기화
