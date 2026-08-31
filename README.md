# YEON Launcher v0.4.2

## v0.4.2 빌드 오류 수정

이번 버전은 GitHub Actions 빌드에서 발생한 Rust 오류를 수정한 버전입니다.

수정 내용:

- `Launcher::new(options)`를 `let mut launcher = ...`로 변경
- `launcher.start(tx)`가 mutable borrow를 요구해서 생긴 `E0596` 오류 수정
- `LaunchEvent` match의 도달할 수 없는 `_ => {}` 패턴 제거
- 기존 v0.4.1 기능 유지

## 유지되는 기능

- 인스턴스가 없을 때 마크 스타일 고양이 얼굴 표시
- “새로운 인스턴스를 생성해 보세요” 안내
- Modrinth 공식 API 모드 검색/설치
- 모드가 적용된 인스턴스 실행
- 오프라인 로그인
- Microsoft 로그인 준비 UI
- 인스턴스 생성/수정
- 실행 중인 인스턴스와 코드 표시
- 업데이트 확인/업데이트 내용 보기

## 빌드

GitHub에 업로드한 뒤:

Actions → Build YEON Launcher Windows → Run workflow

성공하면 Artifact 이름은:

YEON-Launcher-Windows-v0.4.2
