# YEON Launcher v0.4.0

## v0.4.0 변경사항

- 인스턴스가 하나도 없을 때 마인크래프트 스타일 고양이 얼굴 표시
- 빈 화면 문구를 `새로운 인스턴스를 생성해 보세요`로 변경
- Modrinth 공식 API 기반 모드 검색 추가
- 선택한 인스턴스의 Minecraft 버전과 로더 조건으로 Modrinth 모드 검색
- Modrinth 모드 설치 시 해당 인스턴스의 `mods` 폴더에 자동 저장
- 필수 의존성(required dependency)도 가능한 범위에서 함께 설치
- Play를 누르면 설치된 모드 개수를 적용 상태로 표시한 뒤 Minecraft 실행
- 로그인 설정 화면 추가
- 오프라인 프로필 로그인 기능 추가
- Microsoft 로그인 연결 준비 영역 추가

## Modrinth API

사용 API:

- `GET https://api.modrinth.com/v2/search`
- `GET https://api.modrinth.com/v2/project/{id|slug}/version`
- `GET https://api.modrinth.com/v2/version/{id}`

런처는 `User-Agent: pullgena/yeon-launcher/0.4.0`을 사용합니다.

## Minecraft 실행과 모드 적용

각 인스턴스는 별도의 `mods` 폴더를 가집니다.
Modrinth나 드래그 앤 드롭으로 설치한 `.jar`는 해당 인스턴스의 `mods`에 저장됩니다.
`▶ 플레이`를 누르면 이 인스턴스 폴더 기준으로 Minecraft가 실행됩니다.

## 로그인

현재는 오프라인 프로필 로그인으로 개발/테스트 실행을 지원합니다.
Microsoft 정품 로그인은 OAuth 앱 등록값이 필요하므로 다음 단계에서 실제 토큰 흐름을 붙이면 됩니다.

## 실행

`START_YEON_DEV.bat`

## Windows 빌드

`BUILD_WINDOWS.bat`

또는 GitHub Actions → `Build YEON Launcher Windows`.
