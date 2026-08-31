# YEON Launcher v0.4.1

## v0.4.1 빌드 오류 수정

GitHub Actions 빌드에서 발생한 Rust 컴파일 오류를 수정한 버전입니다.

수정한 내용:

- `LaunchOptions.path`가 `String`이 아니라 `PathBuf`를 요구하므로 `root.clone()`으로 수정
- `minecraft-java-rs-core 0.4.1`의 `LaunchOptions`에 새로 필요한 필드 추가
  - `verify_concurrency`
  - `skip_bundle_check`
  - `force_ipv4`
  - `dns`
- 사용하지 않는 `Manager` import 제거
- `minecraft-java-rs-core`를 `=0.4.1`로 고정해서 다음 패치 버전에서 같은 구조 변경이 다시 생기지 않도록 처리

## 유지되는 기능

- 인스턴스가 없을 때 마크 스타일 고양이 얼굴 표시
- "새로운 인스턴스를 생성해 보세요" 안내
- Modrinth 공식 API 기반 모드 검색/설치
- 인스턴스별 mods 폴더에 모드 설치
- Play 시 해당 인스턴스 모드가 적용된 상태로 Minecraft 실행
- 로그인 설정 화면
- 오프라인 프로필 실행
- Microsoft 로그인 준비 UI

## 빌드

GitHub Actions에서:

```text
Actions → Build YEON Launcher Windows → Run workflow
```

Artifact 이름:

```text
YEON-Launcher-Windows-v0.4.1
```
