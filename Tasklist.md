# Scrolly — 팀 에이전트 Tasklist

**세션 시작**: 2026-05-27
**현재 버전**: v1.0.4 build 1 (App Store Connect 업로드 완료)
**Tmux 세션**: `scrolly_team` (6창 병렬)
**모드**: 팀 에이전트 병렬 실행 (리더 + 4 Teammate)

---

## 팀 구성 & 창 배치

| Tmux 창 | 역할 | 담당자 | 상태 |
|---------|------|--------|------|
| `Leader_Architect` (0) | UX/UI 설계 + 통합 + 최종 판단 + process.md + git | 리더 | ✅ 대기 중 |
| `TM1_Coder` (1) | 백엔드/프론트엔드 코드 작성 | Teammate 1 | ✅ 대기 중 |
| `TM2_Debugger` (2) | 전체 코드 버그 분석 + 수정 제안 | Teammate 2 | ✅ 대기 중 |
| `TM3_Tester_Reviewer` (3) | 앱 전체 테스트 + 최종 코드 리뷰 | Teammate 3 | ✅ 대기 중 |
| `TM4_Perf_Doc` (4) | 성능 최적화 + 앱 전체 문서화 | Teammate 4 | ✅ 대기 중 |
| `Shared_Log` (5) | 팀원 간 공유 로그 / 과학적 토론 기록 | 전체 | ✅ 대기 중 |

---

## 현재 작업 (Active Tasks)

> 작업이 배정되면 여기에 기록됩니다.

---

## 백로그 (이전 세션 잔여 — v1.0.4 이후)

### High (단기 수정 권장)
- [ ] **H2** — `doScroll` loop 비활성 시 early return (battery 5~10% 절감)
- [ ] **M4** — `darkModeListener` mq 객체 캐싱 전역 변수로 수정 (누수 방지)

### Medium (1.1.0 리팩터링)
- [ ] **M1** — `loadSiteSettings()` 99줄 분할 (동기/비동기/위젯 생성 분리)
- [ ] **M2** — `updateSettings` 핸들러 헬퍼 함수 추출
- [ ] **M3** — `doScroll()` 책임 분할 (SPA 체크 / 타겟 재감지 / loop 분리)
- [ ] **M5** — 비동기 콜백 vs 300ms 타이머 race condition 정리
- [ ] **M6** — 위젯 vertical/horizontal cssText → CSS 클래스

### 테스트 (누락 P0/P1)
- [ ] P0: `_connectKeepalive()` port disconnect 시 widget 제거
- [ ] P0: popup.js storage 실패 폴백
- [ ] P1: visibilitychange 후 wake lock 회복
- [ ] P1: scrollTargetTimer 300프레임 throttle 정확성
- [ ] P1: gesture inhibit 800ms 경계값
- [ ] P1: popup.js sendMessage rejection 처리

### 문서화 (P0)
- [ ] content.js 전역 변수 JSDoc (`spaCheckTimer`, `scrollTargetTimer`, `gestureInhibitUntil`)
- [ ] `doScroll()` 함수 JSDoc (RAF 책임 명시)
- [ ] storage 키 3종 차이 주석 (`SETTINGS_KEY`, `WIDGET_POS_KEY`, `WIDGET_POS_GLOBAL_KEY`)
- [ ] CLAUDE.md: speedMode / wake lock / autoPause RAF 멈춤 섹션 추가

---

## 완료된 항목 (v1.0.4 기준)

| ID | 내용 | 완료 시점 |
|----|------|----------|
| C1+H3 | SETTINGS_KEYS 단일 상수, popup.js Object.assign → whitelist | v1.0.3 build 1 |
| H1 | scrollTarget 재감지 후 같은 프레임 scrollBy 스킵 | v1.0.3 build 1 |
| N1 | 끝에서 자동 재실행 (stuck 감지 + explicit end check) | v1.0.3 build 2 |
| N2 | 페이지 이동 후 재실행 (pageshow bfcache 강제 stopScroll) | v1.0.3 build 2 |
| L5 | getScrollTarget while 깊이 제한 50 | v1.0.3 build 2 |
| Quit | Quit 기능 — popup ✕ 버튼 + quitScroll + 6개 언어 | v1.0.3 build 1 |
| Widget | 위젯 부활 근본 원인 — startScroll의 showWidget 강제 제거 | v1.0.3 build 8 |
| CSP | Main.html 화면 반토막 (style-src 'unsafe-inline') | v1.0.3 build 3 |

---

## 과학적 토론 기록

> 현재 세션에서 발생한 가설 대결 및 결론을 기록합니다.

| 토론 # | 주제 | 제안자 | 결론 | 상태 |
|--------|------|--------|------|------|
| — | — | — | — | — |

---

## 교차 레이어 영향 추적

> 한 팀원의 변경이 다른 팀원에게 미치는 영향을 실시간 기록합니다.

| 변경자 | 변경 내용 | 영향받는 팀원 | 영향 내용 | 해결 여부 |
|--------|---------|-------------|---------|----------|
| — | — | — | — | — |

---

## 커밋 이력 (현 세션)

> process.md 업데이트 및 GitHub 커밋 이력을 여기에 기록합니다.

| 시각 | 커밋 메시지 | 담당 |
|------|-----------|------|
| — | — | — |
