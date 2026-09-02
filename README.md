# KMA Launcher v0.6.0

Minecraft 모드 인스턴스를 만들고, Modrinth 공식 API로 모드를 설치한 뒤 실행하는 Windows용 런처입니다.

## v0.6.0 변경사항

- 전체 UI를 더 깔끔한 배포용 화면으로 정리
- 첫 실행 안내 화면 추가
  - 1단계: 앱 아이콘과 `마인크래프트 런처 크마` 문구가 올라오는 화면
  - 2단계: 모드 버튼 → Sodium 설치 → 실행 흐름 안내 화면
  - `시작하기` 클릭 시 공식 Minecraft 웹 로그인 페이지 열림
- 설정 버튼 클릭 시 톱니바퀴 회전
- 설정 메뉴가 톱니바퀴 아래에 펼쳐짐
- 로그인 버튼 클릭 시 공식 Minecraft 로그인 페이지 열림
- `.jar` 끌어넣는 창 제거
- Modrinth 공식 API 설치 방식만 유지
- Modrinth 모드 설치 후 기존 모드 적용 영역에 바로 표시
- 모드 다운로드 임시 파일 확장자 버그 수정
- 손상된 모드 파일이 있으면 다시 다운로드하도록 수정
- NSIS 설치 파일 배포 유지
- Release 빌드에서 CMD 창 숨김 유지

## 빌드

```bash
npm install
npm run tauri:build
```

빌드 결과는 아래 폴더에 생성됩니다.

```text
src-tauri/target/release/bundle/nsis/
```

## GitHub Actions 빌드

```text
Actions → Build KMA Launcher Windows → Run workflow
```

Artifact 이름:

```text
KMA-Launcher-Windows-v0.6.0-NSIS
```

## GitHub Release 배포

```bash
git add .
git commit -m "Release v0.6.0"
git push origin main

git tag v0.6.0
git push origin v0.6.0
```

태그를 푸시하면 `Release KMA Launcher Windows`가 실행되고, GitHub Releases에 NSIS `.exe` 설치 파일이 올라갑니다.
