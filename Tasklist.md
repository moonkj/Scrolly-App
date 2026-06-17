# Scrolly v1.0.6 — 팀 에이전트 전체 코드 리뷰 Tasklist

**시작일**: 2026-06-17
**모드**: 팀 에이전트 병렬 실행 (4 Teammate 동시)
**범위**: 전체 코드베이스 (content.js / popup.js / background.js / popup.html / tests)
**상태**: 🔄 진행 중

---

## 팀 구성 & 창 배치

| 창 | 역할 | 상태 |
|----|------|------|
| `Leader_Architect` (0) | 통합 + 최종 판단 + process.md + git | 🔄 |
| `TM1_Coder` (1) | 코드 일관성 · 컨벤션 · 중복 제거 | 🔄 |
| `TM2_Debugger` (2) | 잠재 버그 · 엣지 케이스 · 레이스 컨디션 | 🔄 |
| `TM3_Tester_Reviewer` (3) | 테스트 커버리지 · 최종 코드 리뷰 | 🔄 |
| `TM4_Perf_Doc` (4) | 성능 최적화 · 문서화 | 🔄 |

---

## 검토 대상 파일

- [ ] `ios/SafariExtension/Resources/content.js` — 스크롤 엔진 (메인)
- [ ] `ios/SafariExtension/Resources/popup.js` — 팝업 UI
- [ ] `ios/SafariExtension/Resources/background.js` — 메시지 중계
- [ ] `ios/SafariExtension/Resources/popup.html` / `popup.css`
- [ ] `tests/content.test.js` — Jest 테스트 (150개)
- [ ] `tests/popup.test.js`
- [ ] `tests/background.test.js`

---

## 발견 사항 (4팀원 종합)

### ✅ 즉시 수정 완료 (v1.0.6 코드 리뷰 라운드)

| ID | 발견자 | 문제 | 수정 |
|----|--------|------|------|
| D1 | TM2 | 타이머 만료로 멈춘 스크롤이 다음 페이지에서 부활 | `onTimerExpired`에 `seriesResumeIntent=false` |
| D2 | TM2 | 300ms 내 연속 navigate 시 setTimeout 누적 | `navigateTimer` clearTimeout + `pendingResume` 누적 |
| D3 | TM2 | bfcache 복원 시 stale intent 잔존 → 의도치 않은 재개 | `pageshow(persisted)`에 intent 클리어 |
| D5 | TM2 | `startScroll`이 stale autoPause 타이머 미정리 | `clearTimeout(userScrollTimer)` 추가 |
| C2 | TM1 | 매직넘버 `2` 하드코딩 (L910/912) | `SCROLL_LOOP_EDGE_TOLERANCE` 적용 |
| T5 | TM3 | popup.test fixture에 seriesToggle/quitBtn/speedMode 누락 → 커버리지 0 | fixture 보강 + 테스트 6개 추가 |
| Doc1~6 | TM4 | CLAUDE.md settings/메시지/storage/버전/bfcache 누락 | 전체 갱신 |

### 🔵 보류 (1.1.0 리팩터링 백로그)

| ID | 발견자 | 내용 |
|----|--------|------|
| C4 | TM1 | 위젯 해제 4중복 → `_destroyWidget()` 추출 |
| C8 | TM1 | `isRoot` 삼항 4회 반복 → `_getScrollMetrics()` 추출 |
| C5/C6 | TM1 | `doScroll()` / `createWidget()` 함수 분리 |
| R7/R8 | TM3 | 동일 — createWidget 190줄, doScroll 책임 5가지 |
| D4 | TM2 | loop + seriesMode 동시 활성 UX 명세화 |
| D6/D7 | TM2 | loadSiteSettings 비동기 + storage.remove 실패 시 intent 중복 (TTL 30s 내) |
| D8 | TM2 | SERIES_INTENT_TTL_MS 30s 적정성 (탭 복원 시 오발동) |
| D9 | TM2 | popup toggleBtn 낙관적 업데이트 UI 깜빡임 |
| P1~P3 | TM4 | Date.now→timestamp, loop layout read 중복, storage 이중쓰기 debounce |
| T1~T3 | TM3 | seriesMode × loop/timer/autoPause 조합 명세 테스트 |

---

## 과학적 토론

| 토론 # | 주제 | 가설 | 결론 |
|--------|------|------|------|
| 1 | seriesResumeIntent 생명주기 | TM2 D1(timer 만료 잔존) vs TM3 T2(timer+series 미검증) | **같은 문제의 양면** — intent를 "페이지 끝 자동정지"에만 한정, timer/bfcache 종료 경로에서 명시적 clear |
| 2 | 연속 navigate 안전성 | TM2 D2: 단순 clearTimeout이면 1차 resume 의도 손실 | `pendingResume` 누적 변수로 의도 보존하며 타이머만 합침 |
| 3 | 테스트 누수(D1 실패) | 전체 실행 시만 실패 — fake-timer RAF가 누수된 window.scrollY 읽음 | `createRafQueue`로 RAF 통제 + scrollY 명시 → 결정론적 |

---

## 교차 레이어 영향 추적

| 변경자 | 변경 내용 | 영향 팀원 | 해결 |
|--------|---------|----------|------|
| TM2(D2) | onNavigate에 `pendingResume`/`navigateTimer` 모듈변수 추가 | TM3 테스트 | D2 회귀 테스트로 "연속 navigate→1회 재개" 검증 |
| TM3(T5) | popup.test fixture 변경 | TM1 popup.html | fixture가 실제 html과 일치하도록 quitBtn/speedModeControl 추가 |

---

## 최종 결론 (리더 판정)

**🟢 v1.0.6 코드 리뷰 라운드 완료.** 4팀원이 독립적으로 발견한 즉시 수정 항목 7종을 모두 반영, 테스트 150→**159개 전부 통과**. 핵심 정주행 모드 버그(D1~D3)는 회귀 테스트로 고정. 대규모 함수 분리 리팩터링은 회귀 위험을 고려해 1.1.0으로 분리.
