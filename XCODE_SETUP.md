# Xcode Safari Web Extension 설정 가이드

## 전제조건
- Xcode 14+ 설치
- Apple Developer 계정 (App Store 배포 시 유료 계정 필요)
- Flutter SDK 설치

---

## Step 1 – Flutter iOS 빌드 준비

```bash
cd /Users/kjmoon/AutoWebScroller
flutter build ios --no-codesign
open ios/Runner.xcworkspace
```

---

## Step 2 – Safari Web Extension 타겟 추가

1. Xcode에서 **File → New → Target** 선택
2. `Safari Extension` 검색 후 선택
3. 아래 정보 입력:
   - **Product Name**: `AutoWebScrollerExtension`
   - **Bundle Identifier**: `com.kjmoon.AutoWebScroller.Extension`
   - **Language**: Swift
   - **Starting Point**: ✅ *비어있는 확장 (Empty Extension)*
4. **Finish** 클릭 → "Activate scheme?" → **Activate** 클릭

---

## Step 3 – 확장 파일 교체

새로 생성된 타겟의 기본 리소스를 프로젝트 폴더의 파일로 교체합니다.

1. Xcode 프로젝트 네비게이터에서 `AutoWebScrollerExtension` → `Resources` 폴더 선택
2. 기존 파일 전체 삭제
3. 아래 파일들을 드래그하여 추가 (Copy items if needed 체크):
   - `ios/SafariExtension/Resources/manifest.json`
   - `ios/SafariExtension/Resources/popup.html`
   - `ios/SafariExtension/Resources/popup.css`
   - `ios/SafariExtension/Resources/popup.js`
   - `ios/SafariExtension/Resources/content.js`
   - `ios/SafariExtension/Resources/background.js`

---

## Step 4 – 아이콘 추가

`ios/SafariExtension/Resources/images/` 폴더에 아이콘 파일 추가:
- `icon-16.png`  (16×16)
- `icon-32.png`  (32×32)
- `icon-48.png`  (48×48)
- `icon-128.png` (128×128)

> 아이콘이 없으면 임시로 시스템 기본 아이콘이 표시됩니다.
> [makeappicon.com](https://makeappicon.com) 등에서 생성 가능.

---

## Step 5 – Build Settings 확인

`AutoWebScrollerExtension` 타겟 선택 → **Build Settings**:

| 항목 | 값 |
|------|-----|
| iOS Deployment Target | 15.0 이상 |
| Bundle Identifier | com.kjmoon.AutoWebScroller.Extension |

**Signing & Capabilities** 탭:
- Team: Apple 개발자 계정 선택
- Automatically manage signing: ✅

---

## Step 6 – Runner 타겟에 Extension 추가

1. `Runner` 타겟 선택 → **Build Phases** 탭
2. `+` 클릭 → **New Copy Files Phase**
3. Destination: `Plugins`
4. `+` 클릭 → `AutoWebScrollerExtension.appex` 추가

---

## Step 7 – 시뮬레이터/기기 실행

```
Xcode 상단 스킴을 "Runner" 로 설정 후 ▶ 실행
```

iPhone/iPad에서:
1. **설정 → Safari → 확장 프로그램**
2. `AutoWebScroller` 토글 ON
3. 권한: "모든 웹사이트 허용"

---

## Step 8 – 사용 방법

1. Safari 실행
2. 원하는 웹사이트 이동
3. 주소 표시줄 왼쪽 **AA** 버튼 탭
4. `AutoWebScroller` 탭
5. 팝업에서 속도/방향/옵션 설정 후 **시작** 버튼

---

## 파일 구조

```
AutoWebScroller/
├── lib/
│   └── main.dart                    ← Flutter 컨테이너 앱
├── ios/
│   ├── Runner.xcworkspace
│   └── SafariExtension/
│       └── Resources/
│           ├── manifest.json        ← 확장 매니페스트
│           ├── popup.html           ← 팝업 UI
│           ├── popup.css            ← 팝업 스타일
│           ├── popup.js             ← 팝업 로직
│           ├── content.js           ← 스크롤 엔진 (웹페이지에 삽입)
│           └── background.js        ← 메시지 중계
└── XCODE_SETUP.md                   ← 이 파일
```

---

## 문제 해결

### "Extension not showing in Safari"
- 설정 앱에서 Extensions 권한 재확인
- 기기를 재시작

### "Popup appears blank"
- manifest.json의 `default_popup` 경로 확인
- Xcode Console에서 JS 에러 확인 (Safari 개발자 도구 연결)

### Safari 개발자 도구 연결 방법
1. Mac Safari → 개발 → [기기명] → AutoWebScroller
2. Console 탭에서 extension 로그 확인 가능
