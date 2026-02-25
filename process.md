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
