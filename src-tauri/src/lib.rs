use minecraft_java_rs_core::{
    launcher::{
        events::LaunchEvent,
        options::{JavaOptions, LaunchOptions, LoaderConfig, MemoryConfig, ScreenConfig},
        Launcher,
    },
    models::{loader::LoaderType, minecraft::Authenticator},
    utils::auth::offline_uuid,
};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Seek},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Emitter;
use tokio::sync::mpsc;
use uuid::Uuid;
use zip::ZipArchive;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct InstanceMeta {
    id: String,
    name: String,
    minecraft_version: String,
    loader: String,
    loader_build: String,
    max_memory: String,
    created_at: u64,
    last_played_at: Option<u64>,
    installed: bool,
}

#[derive(Debug, Serialize)]
struct InstanceInfo {
    id: String,
    name: String,
    minecraft_version: String,
    loader: String,
    loader_build: String,
    max_memory: String,
    created_at: u64,
    last_played_at: Option<u64>,
    installed: bool,
    mod_count: usize,
    path: String,
}

#[derive(Debug, Serialize)]
struct ModInfo {
    filename: String,
    path: String,
    size: u64,
    sha256: String,
    loader: Option<String>,
    name: Option<String>,
    version: Option<String>,
    mod_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct ImportResult {
    status: String,
    mod_info: ModInfo,
}

#[derive(Debug, Serialize)]
struct LaunchResult {
    pid: Option<u32>,
    instance_id: String,
}

#[derive(Debug, Clone, Serialize)]
struct LauncherEventPayload {
    instance_id: String,
    stage: String,
    message: String,
}

#[derive(Debug, Deserialize)]
struct ModrinthSearchResponse {
    hits: Vec<ModrinthSearchHitRaw>,
}

#[derive(Debug, Deserialize)]
struct ModrinthSearchHitRaw {
    project_id: String,
    slug: String,
    title: String,
    description: String,
    author: String,
    icon_url: Option<String>,
    downloads: u64,
    follows: u64,
    versions: Vec<String>,
}

#[derive(Debug, Serialize)]
struct ModrinthSearchHit {
    project_id: String,
    slug: String,
    title: String,
    description: String,
    author: String,
    icon_url: Option<String>,
    downloads: u64,
    follows: u64,
    versions: Vec<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct ModrinthVersion {
    id: String,
    project_id: String,
    name: String,
    version_number: String,
    files: Vec<ModrinthFile>,
    dependencies: Vec<ModrinthDependency>,
}

#[derive(Debug, Deserialize, Clone)]
struct ModrinthFile {
    url: String,
    filename: String,
    primary: bool,
}

#[derive(Debug, Deserialize, Clone)]
struct ModrinthDependency {
    project_id: Option<String>,
    version_id: Option<String>,
    dependency_type: String,
}

#[derive(Debug, Serialize)]
struct ModrinthInstallResult {
    project_title: String,
    version_name: String,
    installed_files: Vec<String>,
    skipped_files: Vec<String>,
    dependency_files: Vec<String>,
}

#[derive(Debug, Default)]
struct ModrinthInstallAccumulator {
    installed_files: Vec<String>,
    skipped_files: Vec<String>,
    dependency_files: Vec<String>,
    visited_projects: Vec<String>,
    visited_versions: Vec<String>,
}


fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn root_dir() -> Result<PathBuf, String> {
    let base = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .ok_or_else(|| "앱 데이터 폴더를 찾을 수 없습니다.".to_string())?;

    Ok(base.join("YEON Launcher").join("minecraft"))
}

fn instances_dir() -> Result<PathBuf, String> {
    Ok(root_dir()?.join("instances"))
}

fn valid_instance_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 80
        && id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
}

fn instance_dir(instance_id: &str) -> Result<PathBuf, String> {
    if !valid_instance_id(instance_id) {
        return Err("잘못된 인스턴스 ID입니다.".to_string());
    }
    Ok(instances_dir()?.join(instance_id))
}

fn metadata_path(instance_id: &str) -> Result<PathBuf, String> {
    Ok(instance_dir(instance_id)?.join("yeon-instance.json"))
}

fn load_meta(instance_id: &str) -> Result<InstanceMeta, String> {
    let path = metadata_path(instance_id)?;
    let text = fs::read_to_string(&path)
        .map_err(|e| format!("인스턴스 정보를 읽을 수 없습니다: {e}"))?;
    serde_json::from_str(&text)
        .map_err(|e| format!("인스턴스 정보가 손상되었습니다: {e}"))
}

fn save_meta(meta: &InstanceMeta) -> Result<(), String> {
    let path = metadata_path(&meta.id)?;
    let text = serde_json::to_string_pretty(meta)
        .map_err(|e| format!("인스턴스 정보를 저장할 수 없습니다: {e}"))?;
    fs::write(path, text).map_err(|e| format!("인스턴스 정보 저장 실패: {e}"))
}

fn mods_dir(instance_id: &str) -> Result<PathBuf, String> {
    Ok(instance_dir(instance_id)?.join("mods"))
}

fn count_mods(instance_id: &str) -> usize {
    let dir = match mods_dir(instance_id) {
        Ok(dir) => dir,
        Err(_) => return 0,
    };

    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return 0,
    };

    entries
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .path()
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("jar"))
                .unwrap_or(false)
        })
        .count()
}

fn meta_to_info(meta: InstanceMeta) -> Result<InstanceInfo, String> {
    let path = instance_dir(&meta.id)?;
    Ok(InstanceInfo {
        mod_count: count_mods(&meta.id),
        path: path.to_string_lossy().into_owned(),
        id: meta.id,
        name: meta.name,
        minecraft_version: meta.minecraft_version,
        loader: meta.loader,
        loader_build: meta.loader_build,
        max_memory: meta.max_memory,
        created_at: meta.created_at,
        last_played_at: meta.last_played_at,
        installed: meta.installed,
    })
}

fn file_sha256(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| format!("파일을 열 수 없습니다: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("파일 해시 계산 실패: {e}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn read_zip_text<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    name: &str,
) -> Option<String> {
    let mut entry = archive.by_name(name).ok()?;
    let mut text = String::new();
    entry.read_to_string(&mut text).ok()?;
    Some(text)
}

fn inspect_fabric<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
) -> Option<(String, Option<String>, Option<String>, Option<String>)> {
    let text = read_zip_text(archive, "fabric.mod.json")?;
    let json: JsonValue = serde_json::from_str(&text).ok()?;

    Some((
        "fabric".to_string(),
        json.get("name").and_then(|v| v.as_str()).map(str::to_string),
        json.get("version").and_then(|v| v.as_str()).map(str::to_string),
        json.get("id").and_then(|v| v.as_str()).map(str::to_string),
    ))
}

fn inspect_quilt<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
) -> Option<(String, Option<String>, Option<String>, Option<String>)> {
    let text = read_zip_text(archive, "quilt.mod.json")?;
    let json: JsonValue = serde_json::from_str(&text).ok()?;
    let loader = json.get("quilt_loader")?;

    Some((
        "quilt".to_string(),
        loader
            .get("metadata")
            .and_then(|v| v.get("name"))
            .and_then(|v| v.as_str())
            .map(str::to_string),
        loader.get("version").and_then(|v| v.as_str()).map(str::to_string),
        loader.get("id").and_then(|v| v.as_str()).map(str::to_string),
    ))
}

fn inspect_toml_mod<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    entry_name: &str,
    loader_name: &str,
) -> Option<(String, Option<String>, Option<String>, Option<String>)> {
    let text = read_zip_text(archive, entry_name)?;
    let value: toml::Value = toml::from_str(&text).ok()?;
    let first_mod = value.get("mods")?.as_array()?.first()?.as_table()?;

    let name = first_mod
        .get("displayName")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let version = first_mod
        .get("version")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let mod_id = first_mod
        .get("modId")
        .and_then(|v| v.as_str())
        .map(str::to_string);

    Some((loader_name.to_string(), name, version, mod_id))
}

fn inspect_mod(path: &Path) -> Result<ModInfo, String> {
    if path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("jar"))
        != Some(true)
    {
        return Err(".jar 파일만 모드로 가져올 수 있습니다.".to_string());
    }

    let metadata = fs::metadata(path)
        .map_err(|e| format!("파일 정보를 읽을 수 없습니다: {e}"))?;
    if !metadata.is_file() {
        return Err("선택한 항목이 파일이 아닙니다.".to_string());
    }

    let hash = file_sha256(path)?;
    let file = File::open(path).map_err(|e| format!("JAR 파일을 열 수 없습니다: {e}"))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|_| "정상적인 JAR/ZIP 파일이 아닙니다.".to_string())?;

    let detected = inspect_fabric(&mut archive)
        .or_else(|| inspect_quilt(&mut archive))
        .or_else(|| inspect_toml_mod(&mut archive, "META-INF/neoforge.mods.toml", "neoforge"))
        .or_else(|| inspect_toml_mod(&mut archive, "META-INF/mods.toml", "forge"));

    let (loader, name, version, mod_id) = match detected {
        Some((loader, name, version, mod_id)) => (Some(loader), name, version, mod_id),
        None => (None, None, None, None),
    };

    Ok(ModInfo {
        filename: path
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("unknown.jar")
            .to_string(),
        path: path.to_string_lossy().into_owned(),
        size: metadata.len(),
        sha256: hash,
        loader,
        name,
        version,
        mod_id,
    })
}

fn loader_matches(instance_loader: &str, mod_loader: &str) -> bool {
    instance_loader.eq_ignore_ascii_case(mod_loader)
}


fn modrinth_user_agent() -> &'static str {
    "pullgena/yeon-launcher/0.4.0"
}

fn modrinth_loader_category(loader: &str) -> Result<&'static str, String> {
    match loader.to_lowercase().as_str() {
        "fabric" => Ok("fabric"),
        "forge" => Ok("forge"),
        "neoforge" => Ok("neoforge"),
        "quilt" => Ok("quilt"),
        _ => Err("Vanilla 인스턴스는 Modrinth 모드를 설치할 수 없습니다.".to_string()),
    }
}

fn safe_filename(name: &str) -> Result<(), String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") || name.trim().is_empty() {
        return Err("안전하지 않은 Modrinth 파일 이름입니다.".to_string());
    }
    Ok(())
}

fn choose_primary_file(version: &ModrinthVersion) -> Result<ModrinthFile, String> {
    version
        .files
        .iter()
        .find(|file| file.primary)
        .or_else(|| version.files.first())
        .cloned()
        .ok_or_else(|| "이 Modrinth 버전에 다운로드 가능한 파일이 없습니다.".to_string())
}

async fn modrinth_get_versions(
    client: &reqwest::Client,
    project_id: &str,
    loader: &str,
    game_version: &str,
) -> Result<Vec<ModrinthVersion>, String> {
    let loaders = serde_json::to_string(&vec![loader]).map_err(|e| e.to_string())?;
    let game_versions = serde_json::to_string(&vec![game_version]).map_err(|e| e.to_string())?;

    let url = format!("https://api.modrinth.com/v2/project/{project_id}/version");
    let response = client
        .get(url)
        .query(&[
            ("loaders", loaders.as_str()),
            ("game_versions", game_versions.as_str()),
            ("include_changelog", "false"),
        ])
        .send()
        .await
        .map_err(|e| format!("Modrinth 버전 목록 요청 실패: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Modrinth 버전 목록 오류: {}", response.status()));
    }

    response
        .json::<Vec<ModrinthVersion>>()
        .await
        .map_err(|e| format!("Modrinth 버전 목록 해석 실패: {e}"))
}

async fn modrinth_get_version(
    client: &reqwest::Client,
    version_id: &str,
) -> Result<ModrinthVersion, String> {
    let url = format!("https://api.modrinth.com/v2/version/{version_id}");
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Modrinth 버전 요청 실패: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Modrinth 버전 오류: {}", response.status()));
    }

    response
        .json::<ModrinthVersion>()
        .await
        .map_err(|e| format!("Modrinth 버전 해석 실패: {e}"))
}

async fn download_modrinth_file(
    client: &reqwest::Client,
    instance_id: &str,
    file: &ModrinthFile,
    acc: &mut ModrinthInstallAccumulator,
    is_dependency: bool,
) -> Result<(), String> {
    safe_filename(&file.filename)?;

    let target_dir = mods_dir(instance_id)?;
    fs::create_dir_all(&target_dir).map_err(|e| format!("mods 폴더 생성 실패: {e}"))?;
    let target = target_dir.join(&file.filename);

    if target.exists() {
        acc.skipped_files.push(file.filename.clone());
        if is_dependency {
            acc.dependency_files.push(file.filename.clone());
        }
        return Ok(());
    }

    let bytes = client
        .get(&file.url)
        .send()
        .await
        .map_err(|e| format!("Modrinth 파일 다운로드 실패: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("Modrinth 파일 읽기 실패: {e}"))?;

    fs::write(&target, &bytes).map_err(|e| format!("Modrinth 파일 저장 실패: {e}"))?;
    acc.installed_files.push(file.filename.clone());
    if is_dependency {
        acc.dependency_files.push(file.filename.clone());
    }

    Ok(())
}

async fn install_modrinth_version_recursive(
    client: &reqwest::Client,
    instance_id: &str,
    version: ModrinthVersion,
    acc: &mut ModrinthInstallAccumulator,
    depth: usize,
    is_dependency: bool,
) -> Result<(), String> {
    if depth > 8 {
        return Err("Modrinth 의존성 단계가 너무 깊습니다.".to_string());
    }

    if acc.visited_versions.iter().any(|value| value == &version.id) {
        return Ok(());
    }
    acc.visited_versions.push(version.id.clone());

    for dep in version.dependencies.iter() {
        if dep.dependency_type != "required" {
            continue;
        }

        if let Some(version_id) = dep.version_id.as_deref() {
            let dep_version = modrinth_get_version(client, version_id).await?;
            Box::pin(install_modrinth_version_recursive(
                client,
                instance_id,
                dep_version,
                acc,
                depth + 1,
                true,
            ))
            .await?;
        } else if let Some(project_id) = dep.project_id.as_deref() {
            Box::pin(install_modrinth_project_recursive(
                client,
                instance_id,
                project_id,
                acc,
                depth + 1,
                true,
            ))
            .await?;
        }
    }

    let file = choose_primary_file(&version)?;
    download_modrinth_file(client, instance_id, &file, acc, is_dependency).await
}

async fn install_modrinth_project_recursive(
    client: &reqwest::Client,
    instance_id: &str,
    project_id: &str,
    acc: &mut ModrinthInstallAccumulator,
    depth: usize,
    is_dependency: bool,
) -> Result<ModrinthVersion, String> {
    if depth > 8 {
        return Err("Modrinth 의존성 단계가 너무 깊습니다.".to_string());
    }
    if acc.visited_projects.iter().any(|value| value == project_id) {
        let meta = load_meta(instance_id)?;
        let loader = modrinth_loader_category(&meta.loader)?;
        let versions = modrinth_get_versions(client, project_id, loader, &meta.minecraft_version).await?;
        return versions.into_iter().next().ok_or_else(|| "호환 버전을 찾지 못했습니다.".to_string());
    }

    acc.visited_projects.push(project_id.to_string());

    let meta = load_meta(instance_id)?;
    let loader = modrinth_loader_category(&meta.loader)?;
    let versions = modrinth_get_versions(client, project_id, loader, &meta.minecraft_version).await?;
    let version = versions.into_iter().next().ok_or_else(|| {
        format!(
            "{} / {} 조건에 맞는 Modrinth 버전을 찾지 못했습니다.",
            meta.minecraft_version,
            meta.loader.to_uppercase()
        )
    })?;

    install_modrinth_version_recursive(
        client,
        instance_id,
        version.clone(),
        acc,
        depth,
        is_dependency,
    )
    .await?;

    Ok(version)
}

#[tauri::command]
fn list_instances() -> Result<Vec<InstanceInfo>, String> {
    let dir = instances_dir()?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("인스턴스 폴더를 만들 수 없습니다: {e}"))?;

    let mut result = Vec::new();

    for entry in fs::read_dir(&dir)
        .map_err(|e| format!("인스턴스 폴더를 읽을 수 없습니다: {e}"))?
    {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };

        if !entry.path().is_dir() {
            continue;
        }

        let meta_path = entry.path().join("yeon-instance.json");
        if !meta_path.exists() {
            continue;
        }

        let text = match fs::read_to_string(meta_path) {
            Ok(text) => text,
            Err(_) => continue,
        };

        let meta: InstanceMeta = match serde_json::from_str(&text) {
            Ok(meta) => meta,
            Err(_) => continue,
        };

        if let Ok(info) = meta_to_info(meta) {
            result.push(info);
        }
    }

    result.sort_by(|a, b| {
        b.last_played_at
            .unwrap_or(b.created_at)
            .cmp(&a.last_played_at.unwrap_or(a.created_at))
    });

    Ok(result)
}

#[tauri::command]
fn create_instance(
    name: String,
    minecraft_version: String,
    loader: String,
    loader_build: String,
    max_memory: String,
) -> Result<InstanceInfo, String> {
    let clean_name = name.trim();
    let clean_version = minecraft_version.trim();
    let clean_loader = loader.trim().to_lowercase();

    if clean_name.is_empty() {
        return Err("인스턴스 이름이 비어 있습니다.".to_string());
    }
    if clean_version.is_empty() {
        return Err("Minecraft 버전을 입력해 주세요.".to_string());
    }
    if !matches!(
        clean_loader.as_str(),
        "vanilla" | "fabric" | "forge" | "neoforge" | "quilt"
    ) {
        return Err("지원하지 않는 모드 로더입니다.".to_string());
    }

    let id = format!("instance-{}", Uuid::new_v4().simple());
    let dir = instance_dir(&id)?;

    fs::create_dir_all(dir.join("mods"))
        .map_err(|e| format!("mods 폴더 생성 실패: {e}"))?;
    fs::create_dir_all(dir.join("resourcepacks"))
        .map_err(|e| format!("resourcepacks 폴더 생성 실패: {e}"))?;
    fs::create_dir_all(dir.join("shaderpacks"))
        .map_err(|e| format!("shaderpacks 폴더 생성 실패: {e}"))?;
    fs::create_dir_all(dir.join("saves"))
        .map_err(|e| format!("saves 폴더 생성 실패: {e}"))?;

    let meta = InstanceMeta {
        id,
        name: clean_name.to_string(),
        minecraft_version: clean_version.to_string(),
        loader: clean_loader,
        loader_build: if loader == "vanilla" {
            "none".to_string()
        } else if loader_build.trim().is_empty() {
            "latest".to_string()
        } else {
            loader_build.trim().to_string()
        },
        max_memory: if max_memory.trim().is_empty() {
            "4G".to_string()
        } else {
            max_memory.trim().to_string()
        },
        created_at: now_unix(),
        last_played_at: None,
        installed: false,
    };

    save_meta(&meta)?;
    meta_to_info(meta)
}


#[tauri::command]
fn update_instance(
    instance_id: String,
    name: String,
    minecraft_version: String,
    loader: String,
    loader_build: String,
    max_memory: String,
) -> Result<InstanceInfo, String> {
    let mut meta = load_meta(&instance_id)?;

    let clean_name = name.trim();
    let clean_version = minecraft_version.trim();
    let clean_loader = loader.trim().to_lowercase();
    let clean_loader_build = if clean_loader == "vanilla" {
        "none".to_string()
    } else if loader_build.trim().is_empty() {
        "latest".to_string()
    } else {
        loader_build.trim().to_string()
    };
    let clean_memory = if max_memory.trim().is_empty() {
        "4G".to_string()
    } else {
        max_memory.trim().to_string()
    };

    if clean_name.is_empty() {
        return Err("인스턴스 이름이 비어 있습니다.".to_string());
    }
    if clean_version.is_empty() {
        return Err("Minecraft 버전을 입력해 주세요.".to_string());
    }
    if !matches!(
        clean_loader.as_str(),
        "vanilla" | "fabric" | "forge" | "neoforge" | "quilt"
    ) {
        return Err("지원하지 않는 모드 로더입니다.".to_string());
    }

    let compatibility_changed =
        meta.minecraft_version != clean_version
        || meta.loader != clean_loader
        || meta.loader_build != clean_loader_build;

    meta.name = clean_name.to_string();
    meta.minecraft_version = clean_version.to_string();
    meta.loader = clean_loader;
    meta.loader_build = clean_loader_build;
    meta.max_memory = clean_memory;

    // Minecraft 버전이나 로더가 달라지면 다음 Play에서 필요한 파일을 다시 준비합니다.
    // 인스턴스 폴더 자체는 그대로 유지하므로 월드/모드/리소스팩은 삭제하지 않습니다.
    if compatibility_changed {
        meta.installed = false;
    }

    save_meta(&meta)?;
    meta_to_info(meta)
}

#[tauri::command]
fn delete_instance(instance_id: String) -> Result<(), String> {
    let dir = instance_dir(&instance_id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir)
            .map_err(|e| format!("인스턴스를 삭제할 수 없습니다: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
fn import_mod(
    source_path: String,
    instance_id: String,
) -> Result<ImportResult, String> {
    let meta = load_meta(&instance_id)?;

    if meta.loader == "vanilla" {
        return Err(
            "Vanilla 인스턴스에는 모드를 설치할 수 없습니다. 모드 로더 인스턴스를 사용해 주세요."
                .to_string(),
        );
    }

    let source = PathBuf::from(&source_path);
    let source_info = inspect_mod(&source)?;

    if let Some(mod_loader) = source_info.loader.as_deref() {
        if !loader_matches(&meta.loader, mod_loader) {
            return Err(format!(
                "이 모드는 {}용으로 보이지만 현재 인스턴스는 {}입니다.",
                mod_loader.to_uppercase(),
                meta.loader.to_uppercase()
            ));
        }
    }

    let target_dir = mods_dir(&instance_id)?;
    fs::create_dir_all(&target_dir)
        .map_err(|e| format!("mods 폴더를 만들 수 없습니다: {e}"))?;

    let target = target_dir.join(&source_info.filename);

    if target.exists() {
        let existing_hash = file_sha256(&target)?;
        if existing_hash == source_info.sha256 {
            return Ok(ImportResult {
                status: "already_installed".to_string(),
                mod_info: inspect_mod(&target)?,
            });
        }

        return Err(format!(
            "같은 이름의 다른 파일({})이 이미 설치되어 있습니다.",
            source_info.filename
        ));
    }

    fs::copy(&source, &target)
        .map_err(|e| format!("모드 복사 실패: {e}"))?;

    Ok(ImportResult {
        status: "installed".to_string(),
        mod_info: inspect_mod(&target)?,
    })
}

#[tauri::command]
fn list_installed_mods(instance_id: String) -> Result<Vec<ModInfo>, String> {
    let target_dir = mods_dir(&instance_id)?;
    if !target_dir.exists() {
        return Ok(Vec::new());
    }

    let mut result = Vec::new();

    for entry in fs::read_dir(&target_dir)
        .map_err(|e| format!("mods 폴더 읽기 실패: {e}"))?
    {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };

        let path = entry.path();
        if path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("jar"))
            != Some(true)
        {
            continue;
        }

        if let Ok(info) = inspect_mod(&path) {
            result.push(info);
        }
    }

    result.sort_by(|a, b| {
        (a.name.as_deref().unwrap_or(&a.filename))
            .to_lowercase()
            .cmp(&(b.name.as_deref().unwrap_or(&b.filename)).to_lowercase())
    });

    Ok(result)
}


#[tauri::command]
async fn search_modrinth_mods(
    query: String,
    game_version: String,
    loader: String,
) -> Result<Vec<ModrinthSearchHit>, String> {
    let clean_query = query.trim();
    if clean_query.is_empty() {
        return Err("검색어가 비어 있습니다.".to_string());
    }

    let loader_category = modrinth_loader_category(&loader)?;
    let facets = serde_json::to_string(&vec![
        vec!["project_type:mod".to_string()],
        vec![format!("versions:{}", game_version.trim())],
        vec![format!("categories:{}", loader_category)],
    ])
    .map_err(|e| format!("Modrinth 검색 조건 생성 실패: {e}"))?;

    let client = reqwest::Client::builder()
        .user_agent(modrinth_user_agent())
        .build()
        .map_err(|e| format!("Modrinth 클라이언트 생성 실패: {e}"))?;

    let response = client
        .get("https://api.modrinth.com/v2/search")
        .query(&[
            ("query", clean_query),
            ("facets", facets.as_str()),
            ("index", "downloads"),
            ("limit", "12"),
        ])
        .send()
        .await
        .map_err(|e| format!("Modrinth 검색 요청 실패: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Modrinth 검색 오류: {}", response.status()));
    }

    let parsed = response
        .json::<ModrinthSearchResponse>()
        .await
        .map_err(|e| format!("Modrinth 검색 결과 해석 실패: {e}"))?;

    Ok(parsed
        .hits
        .into_iter()
        .map(|hit| ModrinthSearchHit {
            project_id: hit.project_id,
            slug: hit.slug,
            title: hit.title,
            description: hit.description,
            author: hit.author,
            icon_url: hit.icon_url,
            downloads: hit.downloads,
            follows: hit.follows,
            versions: hit.versions,
        })
        .collect())
}

#[tauri::command]
async fn install_modrinth_mod(
    instance_id: String,
    project_id: String,
) -> Result<ModrinthInstallResult, String> {
    let meta = load_meta(&instance_id)?;
    if meta.loader == "vanilla" {
        return Err("Vanilla 인스턴스에는 Modrinth 모드를 설치할 수 없습니다.".to_string());
    }

    let client = reqwest::Client::builder()
        .user_agent(modrinth_user_agent())
        .build()
        .map_err(|e| format!("Modrinth 클라이언트 생성 실패: {e}"))?;

    let mut acc = ModrinthInstallAccumulator::default();
    let version = install_modrinth_project_recursive(
        &client,
        &instance_id,
        project_id.trim(),
        &mut acc,
        0,
        false,
    )
    .await?;

    Ok(ModrinthInstallResult {
        project_title: project_id,
        version_name: format!("{} ({})", version.name, version.version_number),
        installed_files: acc.installed_files,
        skipped_files: acc.skipped_files,
        dependency_files: acc.dependency_files,
    })
}

fn loader_config(meta: &InstanceMeta) -> Result<LoaderConfig, String> {
    if meta.loader == "vanilla" {
        return Ok(LoaderConfig {
            enable: false,
            ..Default::default()
        });
    }

    let loader_type = match meta.loader.as_str() {
        "fabric" => LoaderType::Fabric,
        "forge" => LoaderType::Forge,
        "neoforge" => LoaderType::NeoForge,
        "quilt" => LoaderType::Quilt,
        _ => return Err("지원하지 않는 로더입니다.".to_string()),
    };

    Ok(LoaderConfig {
        enable: true,
        loader_type: Some(loader_type),
        build: meta.loader_build.clone(),
        path: None,
        config: None,
    })
}

fn emit_launcher_event(
    app: &tauri::AppHandle,
    instance_id: &str,
    stage: &str,
    message: impl Into<String>,
) {
    let _ = app.emit(
        "launcher-event",
        LauncherEventPayload {
            instance_id: instance_id.to_string(),
            stage: stage.to_string(),
            message: message.into(),
        },
    );
}

#[tauri::command]
async fn launch_instance(
    app: tauri::AppHandle,
    instance_id: String,
    username: String,
) -> Result<LaunchResult, String> {
    let mut meta = load_meta(&instance_id)?;
    let root = root_dir()?;
    fs::create_dir_all(&root)
        .map_err(|e| format!("Minecraft 저장 폴더 생성 실패: {e}"))?;

    let clean_username = if username.trim().is_empty() {
        "Player".to_string()
    } else {
        username.trim().to_string()
    };

    let auth = Authenticator {
        access_token: "offline".into(),
        name: clean_username.clone(),
        uuid: offline_uuid(&clean_username),
        xbox_account: None,
        user_properties: None,
        client_id: None,
        client_token: None,
    };

    let options = LaunchOptions {
        path: root.clone(),
        version: meta.minecraft_version.clone(),
        authenticator: auth,
        memory: MemoryConfig {
            min: "1G".into(),
            max: meta.max_memory.clone(),
        },
        loader: loader_config(&meta)?,
        timeout_secs: 60,
        download_concurrency: 10,
        verify_concurrency: 4,
        java: JavaOptions::default(),
        screen: ScreenConfig::default(),
        verify: true,
        game_args: vec![],
        jvm_args: vec![],
        instance: Some(instance_id.clone()),
        url: None,
        mcp: None,
        intel_enabled_mac: false,
        bypass_offline: true,
        skip_bundle_check: false,
        force_ipv4: false,
        dns: None,
    };

    let mut launcher = Launcher::new(options);
    let (tx, mut rx) = mpsc::channel::<LaunchEvent>(512);

    let event_app = app.clone();
    let event_instance = instance_id.clone();

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                LaunchEvent::Progress {
                    downloaded,
                    total,
                    kind,
                } => {
                    emit_launcher_event(
                        &event_app,
                        &event_instance,
                        "download",
                        format!("[{kind}] {downloaded}/{total} 파일 준비 중"),
                    );
                }
                LaunchEvent::Speed(bytes_per_sec) => {
                    emit_launcher_event(
                        &event_app,
                        &event_instance,
                        "download",
                        format!("다운로드 {:.1} MB/s", bytes_per_sec / 1_048_576.0),
                    );
                }
                LaunchEvent::Estimated(seconds) => {
                    emit_launcher_event(
                        &event_app,
                        &event_instance,
                        "download",
                        format!("예상 남은 시간 약 {:.0}초", seconds.max(0.0)),
                    );
                }
                LaunchEvent::Check {
                    current,
                    total,
                    kind,
                } => {
                    emit_launcher_event(
                        &event_app,
                        &event_instance,
                        "check",
                        format!("[{kind}] 파일 검사 {current}/{total}"),
                    );
                }
                LaunchEvent::Extract(name) => {
                    emit_launcher_event(
                        &event_app,
                        &event_instance,
                        "extract",
                        format!("압축 해제: {name}"),
                    );
                }
                LaunchEvent::Patch(name) => {
                    emit_launcher_event(
                        &event_app,
                        &event_instance,
                        "loader",
                        format!("모드 로더 준비: {name}"),
                    );
                }
                LaunchEvent::GameDownloadFinished => {
                    emit_launcher_event(
                        &event_app,
                        &event_instance,
                        "ready",
                        "게임 파일 준비 완료. Minecraft를 시작합니다.",
                    );
                }
                LaunchEvent::Data(line) => {
                    if line.contains("ERROR") || line.contains("Exception") {
                        emit_launcher_event(
                            &event_app,
                            &event_instance,
                            "log",
                            line,
                        );
                    }
                }
                LaunchEvent::Close(code) => {
                    emit_launcher_event(
                        &event_app,
                        &event_instance,
                        "closed",
                        format!("Minecraft가 종료되었습니다. 종료 코드: {code}"),
                    );
                }
                LaunchEvent::Error(message) => {
                    emit_launcher_event(
                        &event_app,
                        &event_instance,
                        "error",
                        message,
                    );
                }
            }
        }
    });

    fs::create_dir_all(mods_dir(&instance_id)?)
        .map_err(|e| format!("mods 폴더 준비 실패: {e}"))?;
    let mod_count = count_mods(&instance_id);

    emit_launcher_event(
        &app,
        &instance_id,
        "mods",
        format!("{}개의 모드를 이 인스턴스에 적용하는 중...", mod_count),
    );

    emit_launcher_event(
        &app,
        &instance_id,
        "starting",
        "Minecraft, Java, 라이브러리와 모드 로더를 확인하는 중...",
    );

    let mut child = launcher
        .start(tx)
        .await
        .map_err(|e| format!("Minecraft 실행 준비 실패: {e}"))?;

    let pid = child.id();

    meta.installed = true;
    meta.last_played_at = Some(now_unix());
    save_meta(&meta)?;

    emit_launcher_event(
        &app,
        &instance_id,
        "running",
        match pid {
            Some(pid) => format!("Minecraft가 실행되었습니다. PID {pid}"),
            None => "Minecraft가 실행되었습니다.".to_string(),
        },
    );

    let exit_app = app.clone();
    let exit_instance = instance_id.clone();

    tauri::async_runtime::spawn(async move {
        match child.wait().await {
            Ok(status) => {
                emit_launcher_event(
                    &exit_app,
                    &exit_instance,
                    "closed",
                    format!("Minecraft가 종료되었습니다. 상태: {status}"),
                );
            }
            Err(error) => {
                emit_launcher_event(
                    &exit_app,
                    &exit_instance,
                    "error",
                    format!("Minecraft 프로세스 확인 실패: {error}"),
                );
            }
        }
    });

    Ok(LaunchResult {
        pid,
        instance_id,
    })
}


#[tauri::command]
fn open_update_page(url: String) -> Result<(), String> {
    const ALLOWED_PREFIX: &str = "https://github.com/pullgena/launch-2.0/";

    if !url.starts_with(ALLOWED_PREFIX) {
        return Err("허용되지 않은 업데이트 주소입니다.".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| format!("업데이트 페이지 열기 실패: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("업데이트 페이지 열기 실패: {e}"))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("업데이트 페이지 열기 실패: {e}"))?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_instances,
            create_instance,
            update_instance,
            delete_instance,
            import_mod,
            list_installed_mods,
            search_modrinth_mods,
            install_modrinth_mod,
            launch_instance,
            open_update_page
        ])
        .run(tauri::generate_context!())
        .expect("error while running YEON Launcher");
}
