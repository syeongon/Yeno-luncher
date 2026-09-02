import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";

type LoaderName = "vanilla" | "fabric" | "forge" | "neoforge" | "quilt";

type InstanceInfo = {
  id: string;
  name: string;
  minecraft_version: string;
  loader: LoaderName;
  loader_build: string;
  max_memory: string;
  created_at: number;
  last_played_at: number | null;
  installed: boolean;
  mod_count: number;
  path: string;
};

type ModInfo = {
  filename: string;
  path: string;
  size: number;
  sha256: string;
  loader: string | null;
  name: string | null;
  version: string | null;
  mod_id: string | null;
};

type LaunchResult = {
  pid: number | null;
  instance_id: string;
};

type LauncherEvent = {
  instance_id: string;
  stage: string;
  message: string;
};

type RunningInstance = {
  id: string;
  message: string;
  stage: string;
  startedAt: number;
};

type ModrinthSearchHit = {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  icon_url: string | null;
  downloads: number;
  follows: number;
  versions: string[];
};

type ModrinthInstallResult = {
  project_title: string;
  version_name: string;
  installed_files: string[];
  skipped_files: string[];
  dependency_files: string[];
};

type MinecraftInstallCheck = {
  found: boolean;
  official_launcher_found: boolean;
  minecraft_folder_found: boolean;
  checked_paths: string[];
  message: string;
};

type UpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseName: string;
  releaseBody: string;
  publishedAt: string | null;
};

const UPDATE_API = "https://api.github.com/repos/pullgena/launch-2.0/releases/latest";

const MINECRAFT_VERSIONS = [
  "26.2",
  "26.1.1",
  "26.1",
  "1.21.11",
  "1.21.10",
  "1.21.9",
  "1.21.8",
  "1.21.7",
  "1.21.6",
  "1.21.5",
  "1.21.4",
  "1.21.3",
  "1.21.2",
  "1.21.1",
  "1.21",
  "1.20.6",
  "1.20.5",
  "1.20.4",
  "1.20.3",
  "1.20.2",
  "1.20.1",
  "1.20",
  "1.19.4",
  "1.19.3",
  "1.19.2",
  "1.19.1",
  "1.19",
  "1.18.2",
  "1.18.1",
  "1.18",
  "1.17.1",
  "1.17",
  "1.16.5",
  "1.16.4",
  "1.16.3",
  "1.16.2",
  "1.16.1",
  "1.16",
  "1.15.2",
  "1.14.4",
  "1.13.2",
  "1.12.2",
  "1.10.2",
  "1.8.9",
  "1.7.10",
];

const loaderLabel: Record<LoaderName, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  forge: "Forge",
  neoforge: "NeoForge",
  quilt: "Quilt",
};

const normalizeVersion = (value: string) =>
  value.trim().replace(/^v/i, "").split("-")[0];

const isNewerVersion = (latest: string, current: string) => {
  const a = normalizeVersion(latest)
    .split(".")
    .map((value) => Number.parseInt(value, 10) || 0);
  const b = normalizeVersion(current)
    .split(".")
    .map((value) => Number.parseInt(value, 10) || 0);

  const length = Math.max(a.length, b.length, 3);

  for (let index = 0; index < length; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }

  return false;
};

const readableSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const timestampText = (value: number | null) => {
  if (!value) return "아직 실행하지 않음";
  return new Date(value * 1000).toLocaleString("ko-KR");
};

const instanceCode = (id: string) =>
  id.replace(/^instance-/i, "").slice(0, 8).toUpperCase() || "UNKNOWN";

const runningStageLabel = (stage: string) => {
  if (stage === "running") return "실행 중";
  if (stage === "mods") return "모드 적용 중";
  if (stage === "download") return "다운로드 중";
  if (stage === "check") return "검사 중";
  if (stage === "extract") return "압축 해제";
  if (stage === "loader") return "로더 준비";
  return "준비 중";
};

const formatCount = (value: number) =>
  new Intl.NumberFormat("ko-KR").format(value);

export default function App() {
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mods, setMods] = useState<ModInfo[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [notice, setNotice] = useState("새 인스턴스를 만들거나 기존 인스턴스를 선택하세요.");
  const [launchStatus, setLaunchStatus] = useState("");
  const [runningInstances, setRunningInstances] = useState<RunningInstance[]>([]);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [showUpdateDetails, setShowUpdateDetails] = useState(false);
  const [username, setUsername] = useState(() => localStorage.getItem("yeon_username") || "Player");
  const [modrinthQuery, setModrinthQuery] = useState("sodium");
  const [modrinthResults, setModrinthResults] = useState<ModrinthSearchHit[]>([]);
  const [modrinthSearching, setModrinthSearching] = useState(false);
  const [modrinthInstalling, setModrinthInstalling] = useState<string | null>(null);
  const [lastInstalledModNames, setLastInstalledModNames] = useState<string[]>([]);
  const [minecraftCheck, setMinecraftCheck] = useState<MinecraftInstallCheck | null>(null);
  const [checkingMinecraft, setCheckingMinecraft] = useState(false);
  const [introStep, setIntroStep] = useState(() =>
    localStorage.getItem("yeon_intro_done") === "yes" ? 0 : 1,
  );

  const [newName, setNewName] = useState("새 인스턴스");
  const [newVersion, setNewVersion] = useState("1.21.1");
  const [newLoader, setNewLoader] = useState<LoaderName>("fabric");
  const [newLoaderBuild, setNewLoaderBuild] = useState("latest");
  const [newMemory, setNewMemory] = useState("4G");

  const [editName, setEditName] = useState("");
  const [editVersion, setEditVersion] = useState("");
  const [editLoader, setEditLoader] = useState<LoaderName>("fabric");
  const [editLoaderBuild, setEditLoaderBuild] = useState("latest");
  const [editMemory, setEditMemory] = useState("4G");

  const selected = useMemo(
    () => instances.find((instance) => instance.id === selectedId) ?? null,
    [instances, selectedId],
  );

  const visibleRunningInstances = useMemo(
    () =>
      runningInstances
        .map((running) => {
          const instance = instances.find((item) => item.id === running.id);
          return {
            ...running,
            name: instance?.name ?? "알 수 없는 인스턴스",
            minecraftVersion: instance?.minecraft_version ?? "",
            loader: instance?.loader ?? "vanilla",
            code: instanceCode(running.id),
          };
        })
        .sort((a, b) => b.startedAt - a.startedAt),
    [runningInstances, instances],
  );

  const refreshInstances = useCallback(async () => {
    try {
      const result = await invoke<InstanceInfo[]>("list_instances");
      setInstances(result);
      setSelectedId((current) => {
        if (current && result.some((item) => item.id === current)) return current;
        return result[0]?.id ?? null;
      });
    } catch (error) {
      setNotice(`인스턴스 목록을 불러오지 못했습니다: ${String(error)}`);
    }
  }, []);

  const refreshMods = useCallback(async (instanceId: string | null = selectedId) => {
    if (!instanceId) {
      setMods([]);
      return;
    }

    try {
      const result = await invoke<ModInfo[]>("list_installed_mods", { instanceId });
      setMods(result);
    } catch (error) {
      setNotice(`모드 목록을 불러오지 못했습니다: ${String(error)}`);
    }
  }, [selectedId]);

  const checkForUpdates = useCallback(async () => {
    setCheckingUpdate(true);
    try {
      const currentVersion = await getVersion();
      const response = await fetch(UPDATE_API, {
        headers: { Accept: "application/vnd.github+json" },
      });

      if (response.status === 404 || !response.ok) return;

      const release = (await response.json()) as {
        tag_name?: string;
        html_url?: string;
        name?: string | null;
        body?: string | null;
        draft?: boolean;
        prerelease?: boolean;
        published_at?: string | null;
      };

      if (release.draft || release.prerelease) return;
      if (!release.tag_name || !release.html_url) return;

      if (isNewerVersion(release.tag_name, currentVersion)) {
        setShowUpdateDetails(false);
        setUpdateInfo({
          currentVersion,
          latestVersion: normalizeVersion(release.tag_name),
          releaseUrl: release.html_url,
          releaseName: release.name || release.tag_name,
          releaseBody: (release.body || "").trim(),
          publishedAt: release.published_at || null,
        });
      }
    } catch {
      // 업데이트 확인 실패가 런처 실행을 막지 않도록 조용히 넘깁니다.
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

  const checkMinecraft = useCallback(async () => {
    setCheckingMinecraft(true);
    try {
      const result = await invoke<MinecraftInstallCheck>("check_minecraft_installation");
      setMinecraftCheck(result);
      setNotice(result.message);
    } catch (error) {
      setNotice(`Minecraft 설치 확인 실패: ${String(error)}`);
    } finally {
      setCheckingMinecraft(false);
    }
  }, []);

  useEffect(() => {
    void refreshInstances();
  }, [refreshInstances]);

  useEffect(() => {
    void checkForUpdates();
    const timer = window.setInterval(() => void checkForUpdates(), 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [checkForUpdates]);

  useEffect(() => {
    setLastInstalledModNames([]);
    void refreshMods(selectedId);
  }, [selectedId, refreshMods]);

  useEffect(() => {
    void checkMinecraft();
  }, [checkMinecraft]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    listen<LauncherEvent>("launcher-event", (event) => {
      const payload = event.payload;

      if (["starting", "mods", "download", "check", "extract", "loader", "ready", "running", "log"].includes(payload.stage)) {
        setRunningInstances((current) => {
          const existing = current.find((item) => item.id === payload.instance_id);
          const nextItem: RunningInstance = {
            id: payload.instance_id,
            message: payload.message,
            stage: payload.stage,
            startedAt: existing?.startedAt ?? Date.now(),
          };

          if (existing) {
            return current.map((item) => (item.id === payload.instance_id ? nextItem : item));
          }

          return [...current, nextItem];
        });
      }

      if (payload.stage === "closed" || payload.stage === "error") {
        setRunningInstances((current) => current.filter((item) => item.id !== payload.instance_id));
      }

      if (payload.instance_id !== selectedId) return;

      setLaunchStatus(payload.message);

      if (payload.stage === "running") {
        setLaunching(false);
        setNotice("Minecraft가 실행되었습니다.");
        void refreshInstances();
      }

      if (payload.stage === "closed") {
        setLaunching(false);
        setNotice(payload.message);
        void refreshInstances();
      }

      if (payload.stage === "error") {
        setLaunching(false);
        setNotice(payload.message);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => unlisten?.();
  }, [selectedId, refreshInstances]);

  const openMinecraftWebLogin = async () => {
    try {
      await invoke("open_minecraft_login_page");
      setShowLogin(false);
      setNotice("브라우저에서 공식 Minecraft 로그인 창을 열었습니다. 로그인 후 런처로 돌아와 Minecraft 설치 확인을 눌러 주세요.");
    } catch (error) {
      setNotice(`Minecraft 로그인 페이지를 열지 못했습니다: ${String(error)}`);
    }
  };

  const finishIntroAndLogin = async () => {
    localStorage.setItem("yeon_intro_done", "yes");
    setIntroStep(0);
    await openMinecraftWebLogin();
  };

  const searchModrinth = async (queryOverride?: string) => {
    if (!selected) {
      setNotice("먼저 인스턴스를 선택해 주세요.");
      return;
    }

    if (selected.loader === "vanilla") {
      setNotice("Vanilla에서는 모드를 적용할 수 없습니다. Fabric, Forge, NeoForge, Quilt 인스턴스를 사용해 주세요.");
      return;
    }

    const query = (queryOverride ?? modrinthQuery).trim();
    if (!query) {
      setNotice("검색할 모드 이름을 입력해 주세요.");
      return;
    }

    setModrinthQuery(query);
    setModrinthSearching(true);
    try {
      const results = await invoke<ModrinthSearchHit[]>("search_modrinth_mods", {
        query,
        gameVersion: selected.minecraft_version,
        loader: selected.loader,
      });
      setModrinthResults(results);
      setNotice(results.length ? `Modrinth에서 ${results.length}개의 모드를 찾았습니다.` : "조건에 맞는 Modrinth 모드가 없습니다.");
    } catch (error) {
      setNotice(`Modrinth 검색 실패: ${String(error)}`);
    } finally {
      setModrinthSearching(false);
    }
  };

  const installModrinthMod = async (project: ModrinthSearchHit) => {
    if (!selected) return;

    setModrinthInstalling(project.project_id);
    setBusy(true);

    try {
      const result = await invoke<ModrinthInstallResult>("install_modrinth_mod", {
        instanceId: selected.id,
        projectId: project.project_id,
      });

      const changedFiles = [...result.installed_files, ...result.skipped_files, ...result.dependency_files];
      setLastInstalledModNames(changedFiles);
      await refreshMods(selected.id);
      await refreshInstances();
      setSelectedId(selected.id);

      setNotice(
        `${project.title} 설치 완료 · 새 파일 ${result.installed_files.length}개 · 이미 설치됨 ${result.skipped_files.length}개 · 의존성 ${result.dependency_files.length}개 처리됨. 이제 설치된 모드 영역에 표시되고 플레이 시 적용됩니다.`,
      );
    } catch (error) {
      setNotice(`Modrinth 설치 실패: ${String(error)}`);
    } finally {
      setModrinthInstalling(null);
      setBusy(false);
    }
  };

  const createInstance = async () => {
    if (!newName.trim()) {
      setNotice("인스턴스 이름을 입력해 주세요.");
      return;
    }

    setBusy(true);
    try {
      const created = await invoke<InstanceInfo>("create_instance", {
        name: newName.trim(),
        minecraftVersion: newVersion.trim(),
        loader: newLoader,
        loaderBuild: newLoader === "vanilla" ? "none" : newLoaderBuild.trim() || "latest",
        maxMemory: newMemory.trim() || "4G",
      });

      setShowCreate(false);
      await refreshInstances();
      setSelectedId(created.id);
      setNotice(`${created.name} 인스턴스를 만들었습니다. Modrinth에서 Sodium 같은 모드를 설치한 뒤 플레이하세요.`);
    } catch (error) {
      setNotice(`인스턴스 생성 실패: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const openEditInstance = (instance: InstanceInfo) => {
    setEditName(instance.name);
    setEditVersion(instance.minecraft_version);
    setEditLoader(instance.loader);
    setEditLoaderBuild(instance.loader === "vanilla" ? "none" : instance.loader_build || "latest");
    setEditMemory(instance.max_memory);
    setShowEdit(true);
  };

  const saveEditedInstance = async () => {
    if (!selected) return;
    if (!editName.trim() || !editVersion.trim()) {
      setNotice("인스턴스 이름과 Minecraft 버전을 입력해 주세요.");
      return;
    }

    const compatibilityChanged =
      selected.minecraft_version !== editVersion.trim() ||
      selected.loader !== editLoader ||
      selected.loader_build !== (editLoader === "vanilla" ? "none" : editLoaderBuild.trim() || "latest");

    if (compatibilityChanged && mods.length > 0) {
      const ok = confirm(
        "Minecraft 버전이나 모드 로더를 바꾸면 지금 설치된 모드가 맞지 않을 수 있습니다.\n월드와 모드 파일은 지우지 않습니다. 계속할까요?",
      );
      if (!ok) return;
    }

    setBusy(true);
    try {
      const updated = await invoke<InstanceInfo>("update_instance", {
        instanceId: selected.id,
        name: editName.trim(),
        minecraftVersion: editVersion.trim(),
        loader: editLoader,
        loaderBuild: editLoader === "vanilla" ? "none" : editLoaderBuild.trim() || "latest",
        maxMemory: editMemory.trim() || "4G",
      });

      setShowEdit(false);
      await refreshInstances();
      setSelectedId(updated.id);
      await refreshMods(updated.id);
      setNotice(compatibilityChanged ? "설정을 저장했습니다. 다음 실행 때 새 설정에 맞춰 파일을 다시 확인합니다." : "인스턴스 설정을 저장했습니다.");
    } catch (error) {
      setNotice(`인스턴스 수정 실패: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteInstance = async () => {
    if (!selected) return;
    if (!confirm(`"${selected.name}" 인스턴스를 삭제할까요?\n월드와 모드도 함께 삭제됩니다.`)) return;

    setBusy(true);
    try {
      await invoke("delete_instance", { instanceId: selected.id });
      setSelectedId(null);
      setMods([]);
      await refreshInstances();
      setNotice("인스턴스를 삭제했습니다.");
    } catch (error) {
      setNotice(`삭제 실패: ${String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const play = async () => {
    if (!selected) return;

    if (minecraftCheck && !minecraftCheck.found) {
      setNotice("이 PC에서 공식 Minecraft Launcher 또는 .minecraft 폴더를 찾지 못했습니다. 먼저 로그인/설치 확인을 해 주세요.");
      return;
    }

    if (selected.loader === "vanilla" && mods.length > 0) {
      setNotice("Vanilla 인스턴스에는 모드가 적용되지 않습니다. Fabric/Forge/NeoForge/Quilt로 바꿔 주세요.");
      return;
    }

    const cleanName = username.trim() || "Player";
    localStorage.setItem("yeon_username", cleanName);

    setLaunching(true);
    setLaunchStatus("Minecraft 실행 준비 중...");
    setNotice(`${mods.length}개의 모드를 확인한 뒤 Minecraft를 실행합니다.`);

    setRunningInstances((current) => {
      const nextItem: RunningInstance = {
        id: selected.id,
        message: "Minecraft 실행 준비 중...",
        stage: "starting",
        startedAt: Date.now(),
      };

      if (current.some((item) => item.id === selected.id)) {
        return current.map((item) => (item.id === selected.id ? nextItem : item));
      }

      return [...current, nextItem];
    });

    try {
      const result = await invoke<LaunchResult>("launch_instance", {
        instanceId: selected.id,
        username: cleanName,
      });
      setLaunchStatus(result.pid ? `Minecraft 프로세스 시작 · PID ${result.pid}` : "Minecraft 시작");
    } catch (error) {
      setLaunching(false);
      setLaunchStatus("");
      setRunningInstances((current) => current.filter((item) => item.id !== selected.id));
      setNotice(`실행 실패: ${String(error)}`);
    }
  };

  if (introStep > 0) {
    return (
      <main className="introShell">
        <section className={`introCard ${introStep === 1 ? "introFirst" : "introSecond"}`}>
          {introStep === 1 ? (
            <>
              <img className="introIcon" src="/icon.png" alt="크마 앱 아이콘" />
              <h1 className="introRiseText">마인크래프트 런처 크마</h1>
              <p className="introCaption">깔끔하게 모드를 설치하고, 원하는 인스턴스를 바로 실행하세요.</p>
              <button className="introPrimary" type="button" onClick={() => setIntroStep(2)}>
                다음
              </button>
            </>
          ) : (
            <>
              <div className="introDemoScreen" aria-label="모드 설치 후 실행 화면 미리보기">
                <aside>
                  <strong>크마</strong>
                  <button>라이브러리</button>
                  <button className="demoActive">모드</button>
                  <button>설정</button>
                </aside>
                <section>
                  <div className="demoTopBar">
                    <span>Sodium 검색</span>
                    <button>설치</button>
                  </div>
                  <article className="demoModCard">
                    <span>🧩</span>
                    <div>
                      <strong>Sodium</strong>
                      <small>Fabric · 성능 최적화 모드</small>
                    </div>
                    <em>적용 준비</em>
                  </article>
                  <div className="demoRunBox">
                    <span className="runningPulse" />
                    <strong>Minecraft 실행 중</strong>
                  </div>
                </section>
              </div>
              <h1>모드를 넣고 실행 하세요.</h1>
              <p className="introCaption">모드 버튼에서 Sodium 같은 모드를 설치하면, 플레이할 때 해당 인스턴스에 적용됩니다.</p>
              <button className="introPrimary" type="button" onClick={() => void finishIntroAndLogin()}>
                시작하기
              </button>
            </>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brandIcon" src="/icon.png" alt="YEON Launcher 아이콘" />
          <div>
            <strong>크마</strong>
            <span>MINECRAFT LAUNCHER</span>
          </div>
        </div>

        <nav className="sideNav" aria-label="주 메뉴">
          <button className="sideButton active" type="button">▦ 라이브러리</button>
          <button
            className="sideButton"
            type="button"
            onClick={() => setNotice("인스턴스를 선택한 뒤 아래 Modrinth 영역에서 모드를 검색하고 설치하세요.")}
          >
            🧩 모드
          </button>
          <button
            className={`sideButton gearSideButton ${settingsOpen ? "gearOpen" : ""}`}
            type="button"
            onClick={() => setSettingsOpen((current) => !current)}
          >
            <span className="gearIcon" aria-hidden="true">⚙</span>
            설정
          </button>

          {settingsOpen && (
            <section className="settingsDropdown" aria-label="설정 메뉴">
              <button type="button" onClick={() => void openMinecraftWebLogin()}>
                마크 웹 로그인 열기
              </button>
              <button type="button" onClick={() => setShowLogin(true)}>
                실행 설정
              </button>
              <button type="button" onClick={() => void checkMinecraft()} disabled={checkingMinecraft}>
                {checkingMinecraft ? "확인 중..." : "Minecraft 설치 확인"}
              </button>
              <button type="button" onClick={() => void checkForUpdates()} disabled={checkingUpdate}>
                {checkingUpdate ? "업데이트 확인 중..." : "업데이트 확인"}
              </button>
              <button type="button" onClick={() => {
                localStorage.removeItem("yeon_intro_done");
                setIntroStep(1);
              }}>
                처음 화면 다시 보기
              </button>
            </section>
          )}
        </nav>

        <div className="sideProfile">
          <span className="loginAvatar">{username.slice(0, 1).toUpperCase()}</span>
          <div>
            <strong>{username || "Player"}</strong>
            <small>{minecraftCheck?.found ? "Minecraft 확인됨" : "Minecraft 확인 필요"}</small>
          </div>
        </div>

        <button className="loginButton" type="button" onClick={() => void openMinecraftWebLogin()}>
          로그인
        </button>
      </aside>

      <section className="mainArea">
        <header className="topbar">
          <div>
            <p className="eyebrow">MINECRAFT INSTANCES</p>
            <h1>내 인스턴스</h1>
          </div>
          <button className="createButton" type="button" onClick={() => setShowCreate(true)}>
            ＋ 새 인스턴스
          </button>
        </header>

        {visibleRunningInstances.length > 0 && (
          <section className="runningPanel" aria-label="실행 중인 인스턴스">
            <div className="runningPanelHeader">
              <div>
                <p className="eyebrow">NOW RUNNING</p>
                <h2>실행 중인 인스턴스</h2>
              </div>
              <span>{visibleRunningInstances.length}개 실행 중</span>
            </div>

            <div className="runningList">
              {visibleRunningInstances.map((running) => (
                <button
                  key={running.id}
                  className="runningCard"
                  type="button"
                  onClick={() => setSelectedId(running.id)}
                >
                  <span className="runningPulse" aria-hidden="true" />
                  <div className="runningText">
                    <strong>{running.name}</strong>
                    <span>
                      {running.minecraftVersion
                        ? `Minecraft ${running.minecraftVersion} · ${loaderLabel[running.loader as LoaderName]}`
                        : "Minecraft 실행 중"}
                    </span>
                    <small>{running.message}</small>
                  </div>
                  <div className="runningRight">
                    <code className="runningCode">{running.code}</code>
                    <span className="runningStage">{runningStageLabel(running.stage)}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="instanceGrid" aria-label="인스턴스 목록">
          {instances.map((instance) => (
            <button
              key={instance.id}
              className={`instanceCard ${selectedId === instance.id ? "selected" : ""}`}
              type="button"
              onClick={() => setSelectedId(instance.id)}
              onDoubleClick={() => openEditInstance(instance)}
              title="클릭: 인스턴스 열기 · 더블클릭: 인스턴스 수정"
            >
              <div className="instanceIcon">⛏</div>
              <div className="instanceCardText">
                <strong>{instance.name}</strong>
                <span>Minecraft {instance.minecraft_version} · {loaderLabel[instance.loader]}</span>
                <small>{instance.mod_count} mods · 코드 {instanceCode(instance.id)}</small>
              </div>
              <span className={`readyDot ${instance.installed ? "ready" : ""}`} />
            </button>
          ))}

          {instances.length === 0 && (
            <button className="emptyCreate catEmpty" type="button" onClick={() => setShowCreate(true)}>
              <svg className="catFaceArt" viewBox="0 0 160 150" role="img" aria-label="마인크래프트 스타일 고양이 얼굴">
                <rect x="20" y="42" width="120" height="88" rx="4" fill="#d6a15f" />
                <rect x="28" y="26" width="32" height="36" fill="#c78345" />
                <rect x="100" y="26" width="32" height="36" fill="#c78345" />
                <rect x="36" y="34" width="16" height="18" fill="#f2c582" />
                <rect x="108" y="34" width="16" height="18" fill="#f2c582" />
                <rect x="44" y="72" width="18" height="18" fill="#151515" />
                <rect x="98" y="72" width="18" height="18" fill="#151515" />
                <rect x="74" y="92" width="12" height="10" fill="#5b2c22" />
                <rect x="66" y="106" width="12" height="6" fill="#151515" />
                <rect x="84" y="106" width="12" height="6" fill="#151515" />
                <rect x="24" y="96" width="34" height="4" fill="#3b2b23" />
                <rect x="102" y="96" width="34" height="4" fill="#3b2b23" />
                <rect x="34" y="112" width="28" height="4" fill="#3b2b23" />
                <rect x="98" y="112" width="28" height="4" fill="#3b2b23" />
              </svg>
              <strong>새로운 인스턴스를 생성해 보세요</strong>
              <small>인스턴스를 만들면 모드, 월드, 설정이 따로 관리됩니다.</small>
            </button>
          )}
        </section>

        {selected && (
          <section className="detailPanel">
            <div className="detailHeader">
              <div>
                <p className="eyebrow">SELECTED INSTANCE</p>
                <h2>{selected.name}</h2>
                <div className="metaLine">
                  <span>Minecraft {selected.minecraft_version}</span>
                  <span>{loaderLabel[selected.loader]} {selected.loader !== "vanilla" ? selected.loader_build : ""}</span>
                  <span>RAM {selected.max_memory}</span>
                  <span>코드 {instanceCode(selected.id)}</span>
                </div>
              </div>

              <div className="playArea">
                <button className="editInstanceButton" type="button" onClick={() => openEditInstance(selected)} disabled={busy || launching}>
                  ⚙ 인스턴스 수정
                </button>
                <button className="playButton" type="button" onClick={() => void play()} disabled={launching || busy}>
                  {launching ? "준비 중..." : "▶ 플레이"}
                </button>
                <button className="deleteButton" type="button" onClick={() => void deleteInstance()} disabled={busy || launching}>
                  삭제
                </button>
              </div>
            </div>

            {(launchStatus || launching) && (
              <div className="launchBox">
                <div className="spinner" />
                <div>
                  <strong>{launching ? "Minecraft 준비 중" : "상태"}</strong>
                  <span>{launchStatus || "필요한 파일을 확인하고 있습니다..."}</span>
                </div>
              </div>
            )}

            <section className="installedModsPanel" aria-label="모드 적용 영역">
              <div className="installedModsHeader">
                <div>
                  <strong>모드 적용 영역</strong>
                  <span>Modrinth에서 설치하면 여기에 바로 보이고, 플레이할 때 적용됩니다.</span>
                </div>
                <div className="installedModsActions">
                  <span className="modApplyBadge">{mods.length}개 적용 준비</span>
                  <button className="miniButton" type="button" onClick={() => void refreshMods()}>
                    새로고침
                  </button>
                </div>
              </div>

              <div className="modInstallPreview">
                {mods.length === 0 ? (
                  <div className="emptyMods">
                    <strong>아직 설치된 모드가 없습니다.</strong>
                    <span>아래에서 Sodium을 검색해 설치해 보세요.</span>
                  </div>
                ) : (
                  mods.map((mod) => {
                    const justInstalled = lastInstalledModNames.includes(mod.filename);
                    return (
                      <article className={`modRow ${justInstalled ? "justInstalledMod" : ""}`} key={mod.sha256}>
                        <div className="modIcon">🧩</div>
                        <div className="modText">
                          <strong>{mod.name || mod.filename}</strong>
                          <span>
                            {mod.loader ? mod.loader.toUpperCase() : "로더 미확인"}
                            {mod.version ? ` · ${mod.version}` : ""}
                            {` · ${readableSize(mod.size)}`}
                          </span>
                          <small>{mod.filename}</small>
                        </div>
                        <span className={`pill ${mod.loader ? "recognized" : ""}`}>
                          {justInstalled ? "방금 설치됨" : mod.loader ? "적용 준비" : "확인 필요"}
                        </span>
                      </article>
                    );
                  })
                )}
              </div>
            </section>

            {selected.loader !== "vanilla" ? (
              <section className="modrinthPanel">
                <div className="modrinthHeader">
                  <div>
                    <p className="eyebrow">MODRINTH OFFICIAL API</p>
                    <h3>모드 설치</h3>
                    <span>Minecraft {selected.minecraft_version} · {loaderLabel[selected.loader]} 조건으로 검색합니다.</span>
                  </div>
                  <button className="sodiumButton" type="button" onClick={() => void searchModrinth("sodium")} disabled={modrinthSearching || busy}>
                    Sodium 검색
                  </button>
                </div>

                <form className="modrinthSearch" onSubmit={(event) => {
                  event.preventDefault();
                  void searchModrinth();
                }}>
                  <input
                    value={modrinthQuery}
                    onChange={(event) => setModrinthQuery(event.target.value)}
                    placeholder="예: sodium, iris, jei"
                  />
                  <button type="submit" disabled={modrinthSearching || busy}>
                    {modrinthSearching ? "검색 중..." : "검색"}
                  </button>
                </form>

                <div className="modrinthResults">
                  {modrinthResults.length === 0 ? (
                    <div className="modrinthEmpty">Modrinth 공식 API로 모드를 검색해 설치해 보세요.</div>
                  ) : (
                    modrinthResults.map((project) => (
                      <article className="modrinthCard" key={project.project_id}>
                        {project.icon_url ? <img src={project.icon_url} alt="" /> : <div className="modrinthFallbackIcon">M</div>}
                        <div className="modrinthText">
                          <strong>{project.title}</strong>
                          <span>{project.description}</span>
                          <small>@{project.author} · 다운로드 {formatCount(project.downloads)} · 팔로우 {formatCount(project.follows)}</small>
                        </div>
                        <button type="button" onClick={() => void installModrinthMod(project)} disabled={busy || modrinthInstalling === project.project_id}>
                          {modrinthInstalling === project.project_id ? "설치 중..." : "설치"}
                        </button>
                      </article>
                    ))
                  )}
                </div>
              </section>
            ) : (
              <section className="vanillaNotice">
                Vanilla 인스턴스는 모드를 적용하지 않습니다. 모드를 쓰려면 인스턴스 수정에서 Fabric, Forge, NeoForge, Quilt 중 하나로 바꿔 주세요.
              </section>
            )}

            <div className="notice">{notice}</div>

            <div className="instanceInfo">
              <div>
                <span>저장 위치</span>
                <strong>{selected.path}</strong>
              </div>
              <div>
                <span>마지막 실행</span>
                <strong>{timestampText(selected.last_played_at)}</strong>
              </div>
            </div>
          </section>
        )}
      </section>

      {showLogin && (
        <div className="modalBackdrop" onMouseDown={() => setShowLogin(false)}>
          <div className="modal loginModal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <p className="eyebrow">LAUNCH SETTINGS</p>
                <h2>실행 설정</h2>
              </div>
              <button className="closeButton" type="button" onClick={() => setShowLogin(false)}>×</button>
            </div>

            <section className="loginOption webLoginOption">
              <div>
                <strong>마크 로그인</strong>
                <span>브라우저에서 공식 Minecraft 로그인 창을 엽니다.</span>
              </div>
              <button type="button" onClick={() => void openMinecraftWebLogin()}>
                로그인 창 열기
              </button>
            </section>

            <label className="field">
              <span>플레이어 이름</span>
              <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Player" />
              <small>웹 로그인은 브라우저에서 진행하고, 이 이름은 실행 표시용으로 사용합니다.</small>
            </label>

            <button className="modalCreateButton" type="button" onClick={() => {
              const cleanName = username.trim() || "Player";
              setUsername(cleanName);
              localStorage.setItem("yeon_username", cleanName);
              setShowLogin(false);
              setNotice(`${cleanName} 이름을 저장했습니다.`);
            }}>
              이름 저장
            </button>

            <section className="loginOption minecraftInstallOption">
              <div>
                <strong>Minecraft 설치 확인</strong>
                <span>공식 런처 또는 .minecraft 폴더를 확인합니다.</span>
              </div>
              <span>{minecraftCheck?.found ? "확인됨" : "확인 필요"}</span>
            </section>

            <button className="modalSecondaryButton" type="button" onClick={() => void checkMinecraft()} disabled={checkingMinecraft}>
              {checkingMinecraft ? "확인 중..." : "Minecraft 설치 다시 확인"}
            </button>

            {minecraftCheck && <div className={minecraftCheck.found ? "loginNotice successNotice" : "loginNotice"}>{minecraftCheck.message}</div>}
          </div>
        </div>
      )}

      {updateInfo && (
        <div className="updateBackdrop" role="presentation">
          <section className="updateModal" role="dialog" aria-modal="true" aria-labelledby="update-title">
            <img className="updateIcon" src="/icon.png" alt="크마 런처" />
            <p className="updateEyebrow">KMA LAUNCHER UPDATE</p>
            <h2 id="update-title">새로운 버전이 나왔습니다. 업데이트를 해주세요</h2>
            <p className="updateDescription">더 안정적인 기능과 최신 변경사항을 사용하려면 새 버전으로 업데이트해 주세요.</p>

            <div className="versionCompare">
              <div><span>현재 버전</span><strong>v{updateInfo.currentVersion}</strong></div>
              <span className="versionArrow">→</span>
              <div><span>새 버전</span><strong>v{updateInfo.latestVersion}</strong></div>
            </div>

            <button className="updateDetailsButton" type="button" aria-expanded={showUpdateDetails} onClick={() => setShowUpdateDetails((current) => !current)}>
              {showUpdateDetails ? "업데이트 내용 닫기" : "업데이트 내용 보기"}
              <span aria-hidden="true">{showUpdateDetails ? "▲" : "▼"}</span>
            </button>

            {showUpdateDetails && (
              <section className="updateDetailsPanel" aria-label="업데이트 내용">
                <div className="releaseNotes">
                  {updateInfo.releaseBody ? updateInfo.releaseBody.split("\n").map((line, index) => (
                    <p key={`${index}-${line}`} className={line.trim() ? "" : "emptyLine"}>{line || " "}</p>
                  )) : <p className="noReleaseNotes">등록된 업데이트 내용이 없습니다.</p>}
                </div>
              </section>
            )}

            <div className="updateActions">
              <button className="updatePrimary" type="button" onClick={async () => {
                try {
                  await invoke("open_update_page", { url: updateInfo.releaseUrl });
                } catch (error) {
                  setNotice(`업데이트 페이지를 열지 못했습니다: ${String(error)}`);
                }
              }}>
                업데이트하러 가기
              </button>
              <button className="updateLater" type="button" onClick={() => {
                setShowUpdateDetails(false);
                setUpdateInfo(null);
              }}>
                나중에
              </button>
            </div>
          </section>
        </div>
      )}

      {showEdit && selected && (
        <div className="modalBackdrop" onMouseDown={() => !busy && setShowEdit(false)}>
          <div className="modal editModal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <p className="eyebrow">EDIT INSTANCE</p>
                <h2>인스턴스 수정</h2>
                <p className="editSubtitle">{selected.name}</p>
              </div>
              <button className="closeButton" type="button" onClick={() => setShowEdit(false)}>×</button>
            </div>

            <label className="field">
              <span>인스턴스 이름</span>
              <input value={editName} onChange={(event) => setEditName(event.target.value)} placeholder="인스턴스 이름" />
            </label>

            <label className="field">
              <span>Minecraft 버전</span>
              <input value={editVersion} onChange={(event) => setEditVersion(event.target.value)} placeholder="예: 1.21.11" />
            </label>

            <div className="quickVersions">
              {MINECRAFT_VERSIONS.map((version) => <button key={version} type="button" onClick={() => setEditVersion(version)}>{version}</button>)}
            </div>

            <label className="field">
              <span>모드 로더</span>
              <select value={editLoader} onChange={(event) => setEditLoader(event.target.value as LoaderName)}>
                <option value="vanilla">Vanilla</option>
                <option value="fabric">Fabric</option>
                <option value="neoforge">NeoForge</option>
                <option value="forge">Forge</option>
                <option value="quilt">Quilt</option>
              </select>
            </label>

            {editLoader !== "vanilla" && (
              <label className="field">
                <span>로더 버전</span>
                <input value={editLoaderBuild} onChange={(event) => setEditLoaderBuild(event.target.value)} placeholder="latest" />
                <small>특별한 이유가 없으면 latest를 사용하면 됩니다.</small>
              </label>
            )}

            <label className="field">
              <span>최대 메모리</span>
              <select value={editMemory} onChange={(event) => setEditMemory(event.target.value)}>
                <option value="2G">2 GB</option>
                <option value="4G">4 GB</option>
                <option value="6G">6 GB</option>
                <option value="8G">8 GB</option>
                <option value="12G">12 GB</option>
                <option value="16G">16 GB</option>
              </select>
            </label>

            <div className="editKeepBox">
              <strong>수정해도 유지됩니다</strong>
              <span>월드 · 설치한 모드 · 리소스팩 · 셰이더 · 인스턴스 폴더</span>
            </div>

            <button className="modalCreateButton" type="button" onClick={() => void saveEditedInstance()} disabled={busy}>
              {busy ? "저장 중..." : "수정 내용 저장"}
            </button>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="modalBackdrop" onMouseDown={() => !busy && setShowCreate(false)}>
          <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <p className="eyebrow">CREATE INSTANCE</p>
                <h2>새 인스턴스</h2>
              </div>
              <button className="closeButton" type="button" onClick={() => setShowCreate(false)}>×</button>
            </div>

            <label className="field">
              <span>이름</span>
              <input value={newName} onChange={(event) => setNewName(event.target.value)} />
            </label>

            <label className="field">
              <span>Minecraft 버전</span>
              <input value={newVersion} onChange={(event) => setNewVersion(event.target.value)} />
            </label>

            <div className="quickVersions">
              {MINECRAFT_VERSIONS.map((version) => <button key={version} type="button" onClick={() => setNewVersion(version)}>{version}</button>)}
            </div>

            <label className="field">
              <span>모드 로더</span>
              <select value={newLoader} onChange={(event) => setNewLoader(event.target.value as LoaderName)}>
                <option value="vanilla">Vanilla</option>
                <option value="fabric">Fabric</option>
                <option value="neoforge">NeoForge</option>
                <option value="forge">Forge</option>
                <option value="quilt">Quilt</option>
              </select>
            </label>

            {newLoader !== "vanilla" && (
              <label className="field">
                <span>로더 버전</span>
                <input value={newLoaderBuild} onChange={(event) => setNewLoaderBuild(event.target.value)} placeholder="latest" />
              </label>
            )}

            <label className="field">
              <span>최대 메모리</span>
              <select value={newMemory} onChange={(event) => setNewMemory(event.target.value)}>
                <option value="2G">2 GB</option>
                <option value="4G">4 GB</option>
                <option value="6G">6 GB</option>
                <option value="8G">8 GB</option>
                <option value="12G">12 GB</option>
                <option value="16G">16 GB</option>
              </select>
            </label>

            <div className="createHint">
              첫 플레이 때 Minecraft, 라이브러리, Java 런타임, 선택한 모드 로더를 자동으로 준비합니다.
            </div>

            <button className="modalCreateButton" type="button" onClick={() => void createInstance()} disabled={busy}>
              {busy ? "생성 중..." : "인스턴스 만들기"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
