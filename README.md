# YEON Launcher v0.5.0

## 변경사항

- Windows 설치 방식을 NSIS 전용 `.exe` 설치 파일로 변경했습니다.
- MSI 빌드 산출물은 제거했습니다.
- 릴리스 실행 파일에서는 CMD 창이 뜨지 않도록 Windows GUI subsystem 설정을 추가했습니다.
- `.jar` 파일 드래그 앤 드롭 설치 기능을 제거했습니다.
- 모드는 Modrinth 공식 API 검색/설치 방식만 사용합니다.
- Microsoft OAuth 앱 등록 방식은 제거했습니다.
- 대신 `Minecraft 설치 확인` 버튼으로 공식 Minecraft Launcher 또는 `.minecraft` 폴더 존재 여부만 확인합니다.
- 인스턴스 실행 시 게임 경로를 해당 인스턴스 폴더로 직접 지정해 settings/options/mods가 같은 폴더에 적용되도록 수정했습니다.
- Minecraft 버전 빠른 선택 목록을 크게 늘렸습니다.

## 빌드 결과

GitHub Actions에서 성공하면 Artifact 이름은 다음과 같습니다.

`YEON-Launcher-Windows-v0.5.0-NSIS`

NSIS 설치 파일 위치:

`src-tauri/target/release/bundle/nsis/`

## 릴리스 만들기

1. 이 폴더의 파일을 GitHub 저장소 최상단에 업로드합니다.
2. `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`의 버전이 모두 `0.5.0`인지 확인합니다.
3. GitHub에서 태그 `v0.5.0`을 만듭니다.
4. 태그가 push되면 `.github/workflows/release-windows.yml`이 실행됩니다.
5. Release에 NSIS `.exe` 설치 파일이 첨부됩니다.
