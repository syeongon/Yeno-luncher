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

type AuthMode = "offline";

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

const UPDATE_API =
  "https://api.github.com/repos/pullgena/launch-2.0/releases/latest";

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

const loaderLabel: Record<LoaderName, string> = {
  vanilla: "Vanilla",
  fabric: "Fabric",
  forge: "Forge",
  neoforge: "NeoForge",
  quilt: "Quilt",
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
  return "준비 중";
};

const formatCount = (value: number) =>
  new Intl.NumberFormat("ko-KR").format(value);


const MINECRAFT_VERSIONS = [
  "26.2",
  "26.1.1",
  "26.1",
  "1.21.11",
  "1.21.10",
  "1.21.8",
  "1.21.5",
  "1.21.4",
  "1.21.1",
  "1.20.6",
  "1.20.4",
  "1.20.1",
  "1.19.4",
  "1.18.2",
  "1.17.1",
  "1.16.5",
  "1.12.2",
  "1.8.9",
];

export default function App() {
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mods, setMods] = useState<ModInfo[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [notice, setNotice] = useState("새 인스턴스를 만들거나 기존 인스턴스를 선택하세요.");
  const [launchStatus, setLaunchStatus] = useState("");
  const [runningInstances, setRunningInstances] = useState<RunningInstance[]>([]);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [showUpdateDetails, setShowUpdateDetails] = useState(false);
  const [username, setUsername] = useState(() => localStorage.getItem("yeon_username") || "Player");
  const [authMode, setAuthMode] = useState<AuthMode>("offline");
  const [modrinthQuery, setModrinthQuery] = useState("sodium");
  const [modrinthResults, setModrinthResults] = useState<ModrinthSearchHit[]>([]);
  const [modrinthSearching, setModrinthSearching] = useState(false);
  const [modrinthInstalling, setModrinthInstalling] = useState<string | null>(null);
  const [minecraftCheck, setMinecraftCheck] = useState<MinecraftInstallCheck | null>(null);
  const [checkingMinecraft, setCheckingMinecraft] = useState(false);

  const [newName, setNewName] = useState("새 인스턴스");
  const [newVersion, setNewVersion] = useState("26.2");
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

  useEffect(() => {
    void refreshInstances();
  }, [refreshInstances]);


  const checkForUpdates = useCallback(async () => {
    setCheckingUpdate(true);

    try {
      const currentVersion = await getVersion();
      const response = await fetch(UPDATE_API, {
        headers: {
          Accept: "application/vnd.github+json",
        },
      });

      if (response.status === 404) return;
      if (!response.ok) return;

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
      // 업데이트 확인 실패가 런처 실행 자체를 막지 않도록 합니다.
    } finally {
      setCheckingUpdate(false);
    }
  }, []);

  useEffect(() => {
    void checkForUpdates();

    const timer = window.setInterval(() => {
      void checkForUpdates();
    }, 60 * 60 * 1000);

    return () => window.clearInterval(timer);
  }, [checkForUpdates]);

  useEffect(() => {
    void refreshMods(selectedId);
  }, [selectedId, refreshMods]);

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
        setRunningInstances((current) =>
          current.filter((item) => item.id !== payload.instance_id),
        );
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

  const checkMinecraft = async () => {
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
  };

  useEffect(() => {
    void checkMinecraft();
  }, []);

  const searchModrinth = async () => {
    if (!selected) {
      setNotice("먼저 인스턴스를 선택해 주세요.");
      return;
    }

    if (selected.loader === "vanilla") {
      setNotice("Modrinth 모드는 Fabric / Forge / NeoForge / Quilt 인스턴스에서 검색해 주세요.");
      return;
    }

    if (!modrinthQuery.trim()) {
      setNotice("검색할 모드 이름을 입력해 주세요.");
      return;
    }

    setModrinthSearching(true);
    try {
      const results = await invoke<ModrinthSearchHit[]>("search_modrinth_mods", {
        query: modrinthQuery.trim(),
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

      await refreshMods(selected.id);
      await refreshInstances();

      const installed = result.installed_files.length;
      const skipped = result.skipped_files.length;
      const deps = result.dependency_files.length;
      setNotice(
        `${result.project_title} 설치 완료 · 새 파일 ${installed}개 · 이미 설치됨 ${skipped}개 · 필수 의존성 ${deps}개 처리됨. 플레이를 누르면 이 인스턴스의 mods 폴더가 적용되어 Minecraft가 실행됩니다.`,
      );
    } catch (error) {
      setNotice(`Modrinth 설치 실패: ${String(error)}`);
    } finally {
      setModrinthInstalling(null);
      setBusy(false);
    }
  };

  const saveOfflineLogin = () => {
    const cleanName = username.trim() || "Player";
    setUsername(cleanName);
    setAuthMode("offline");
    localStorage.setItem("yeon_username", cleanName);
    localStorage.setItem("yeon_auth_mode", "offline");
    setShowLogin(false);
    setNotice(`${cleanName} 오프라인 프로필 저장했습니다.`);
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
      setNotice(`${created.name} 인스턴스를 만들었습니다. Modrinth에서 모드를 설치하고 플레이를 누르면 해당 인스턴스의 mods 폴더가 적용됩니다.`);
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
    if (!editName.trim()) {
      setNotice("인스턴스 이름을 입력해 주세요.");
      return;
    }
    if (!editVersion.trim()) {
      setNotice("Minecraft 버전을 입력해 주세요.");
      return;
    }

    const compatibilityChanged =
      selected.minecraft_version !== editVersion.trim() ||
      selected.loader !== editLoader ||
      selected.loader_build !== (editLoader === "vanilla" ? "none" : editLoaderBuild.trim() || "latest");

    if (compatibilityChanged && mods.length > 0) {
      const ok = confirm(
        "Minecraft 버전이나 모드 로더를 변경하면 현재 설치된 모드가 새 설정과 호환되지 않을 수 있습니다.\n\n" +
        "월드와 모드 파일은 삭제되지 않으며, 다음 실행 때 새 게임/로더 파일을 다시 준비합니다.\n\n" +
        "계속 수정할까요?"
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

      if (compatibilityChanged) {
        setNotice(
          `${updated.name} 설정을 수정했습니다. 월드와 모드는 그대로 유지되며, 다음 플레이 때 Minecraft/로더 파일을 새 설정에 맞게 다시 준비합니다.`
        );
      } else {
        setNotice(`${updated.name} 인스턴스 설정을 저장했습니다.`);
      }
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
      setNotice("이 PC에서 공식 Minecraft Launcher 또는 .minecraft 폴더를 찾지 못했습니다. Minecraft 설치 확인을 먼저 해 주세요.");
      return;
    }
    const cleanName = username.trim() || "Player";
    localStorage.setItem("yeon_username", cleanName);

    setLaunching(true);
    setLaunchStatus("Minecraft 실행 준비 중...");
    setNotice("첫 실행이라면 게임 파일, Java, 모드 로더를 내려받습니다. 잠시 기다려 주세요.");

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

  return (
    <main className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brandIcon" src="/icon.png" alt="YEON Launcher 아이콘" />
          <div>
            <strong>YEON</strong>
            <span>LAUNCHER</span>
          </div>
        </div>

        <button className="sideButton active">▦ 라이브러리</button>
        <button className="sideButton">🧩 모드</button>
        <button className="sideButton">⚙ 설정</button>

        <div className="sideBottom">
          <label>로그인</label>
          <div className="loginStatusCard">
            <span className="loginAvatar">{username.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{username || "Player"}</strong>
              <small>오프라인 프로필</small>
            </div>
          </div>
          <button
            className="loginButton"
            type="button"
            onClick={() => setShowLogin(true)}
          >
            실행 설정
          </button>
          <button
            className="minecraftCheckButton"
            type="button"
            onClick={() => void checkMinecraft()}
            disabled={checkingMinecraft}
          >
            {checkingMinecraft ? "Minecraft 확인 중..." : "Minecraft 설치 확인"}
          </button>
          {minecraftCheck && (
            <small className={minecraftCheck.found ? "minecraftOk" : "minecraftWarn"}>
              {minecraftCheck.found ? "Minecraft 설치 확인됨" : "Minecraft 설치 확인 필요"}
            </small>
          )}
          <button
            className="updateCheckButton"
            type="button"
            onClick={() => void checkForUpdates()}
            disabled={checkingUpdate}
          >
            {checkingUpdate ? "업데이트 확인 중..." : "업데이트 확인"}
          </button>
        </div>
      </aside>

      <section className="mainArea">
        <header className="topbar">
          <div>
            <p className="eyebrow">MINECRAFT INSTANCES</p>
            <h1>내 인스턴스</h1>
          </div>
          <button className="createButton" onClick={() => setShowCreate(true)}>
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
                    <code className="runningCode" title={`인스턴스 코드: ${running.code}`}>
                      {running.code}
                    </code>
                    <span className="runningStage">
                      {runningStageLabel(running.stage)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}


        <div className="instanceGrid">
          {instances.map((instance) => (
            <button
              key={instance.id}
              className={`instanceCard ${selectedId === instance.id ? "selected" : ""}`}
              onClick={() => setSelectedId(instance.id)}
              onDoubleClick={() => openEditInstance(instance)}
              title="클릭: 인스턴스 열기 · 더블클릭: 인스턴스 수정"
            >
              <div className="instanceIcon">⛏</div>
              <div className="instanceCardText">
                <strong>{instance.name}</strong>
                <span>
                  Minecraft {instance.minecraft_version} · {loaderLabel[instance.loader]}
                </span>
                <small>{instance.mod_count} mods</small>
              </div>
              <span className={`readyDot ${instance.installed ? "ready" : ""}`} />
            </button>
          ))}

          {instances.length === 0 && (
            <button className="emptyCreate catEmpty" onClick={() => setShowCreate(true)}>
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
              <small>인스턴스를 만들면 모드와 월드가 따로 관리됩니다.</small>
            </button>
          )}
        </div>

        {selected && (
          <section className="detailPanel">
            <div className="detailHeader">
              <div>
                <p className="eyebrow">SELECTED INSTANCE</p>
                <h2>{selected.name}</h2>
                <div className="metaLine">
                  <span>Minecraft {selected.minecraft_version}</span>
                  <span>{loaderLabel[selected.loader]} {selected.loader !== "vanilla" ? selected.loader_build : ""}</span>
                  <span>RAM 최대 {selected.max_memory}</span>
                  <span>코드 {instanceCode(selected.id)}</span>
                </div>
              </div>

              <div className="playArea">
                <button
                  className="editInstanceButton"
                  onClick={() => openEditInstance(selected)}
                  disabled={busy || launching}
                >
                  ⚙ 인스턴스 수정
                </button>
                <button
                  className="playButton"
                  onClick={play}
                  disabled={launching || busy}
                >
                  {launching ? "⏳ 준비 중..." : "▶ 플레이"}
                </button>
                <button className="deleteButton" onClick={deleteInstance} disabled={busy || launching}>
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

            <div className="modrinthOnlyNotice">
              <div className="dropIcon">🧩</div>
              <strong>모드는 Modrinth 공식 API로만 설치합니다.</strong>
              <span>.jar 파일 끌어넣기는 제거했습니다. 아래 검색창에서 모드를 찾아 설치해 주세요.</span>
            </div>

            {selected.loader !== "vanilla" && (
              <section className="modrinthPanel">
                <div className="modrinthHeader">
                  <div>
                    <p className="eyebrow">MODRINTH OFFICIAL API</p>
                    <h3>Modrinth에서 모드 설치</h3>
                    <span>Minecraft {selected.minecraft_version} · {loaderLabel[selected.loader]} 조건으로 검색합니다.</span>
                  </div>
                  <span className="modApplyBadge">{mods.length}개 모드 적용 준비</span>
                </div>

                <form
                  className="modrinthSearch"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void searchModrinth();
                  }}
                >
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
                        {project.icon_url ? (
                          <img src={project.icon_url} alt="" />
                        ) : (
                          <div className="modrinthFallbackIcon">M</div>
                        )}
                        <div className="modrinthText">
                          <strong>{project.title}</strong>
                          <span>{project.description}</span>
                          <small>
                            @{project.author} · 다운로드 {formatCount(project.downloads)} · 팔로우 {formatCount(project.follows)}
                          </small>
                        </div>
                        <button
                          type="button"
                          onClick={() => void installModrinthMod(project)}
                          disabled={busy || modrinthInstalling === project.project_id}
                        >
                          {modrinthInstalling === project.project_id ? "설치 중..." : "설치"}
                        </button>
                      </article>
                    ))
                  )}
                </div>
              </section>
            )}

            <div className="notice">{notice}</div>

            <div className="sectionHeading">
              <div>
                <h3>설치된 모드</h3>
                <p>{mods.length}개의 모드 · 인스턴스별 완전 분리</p>
              </div>
              <button className="miniButton" onClick={() => refreshMods()}>
                새로고침
              </button>
            </div>

            <div className="modList">
              {mods.length === 0 ? (
                <div className="emptyMods">아직 모드가 없습니다.</div>
              ) : (
                mods.map((mod) => (
                  <article className="modRow" key={mod.sha256}>
                    <div className="modIcon">🧩</div>
                    <div className="modText">
                      <strong>{mod.name || mod.filename}</strong>
                      <span>
                        {mod.loader ? mod.loader.toUpperCase() : "로더 미확인"}
                        {mod.version ? ` · ${mod.version}` : ""}
                        {` · ${readableSize(mod.size)}`}
                      </span>
                      <small>{mod.mod_id || mod.filename}</small>
                    </div>
                    <span className={`pill ${mod.loader ? "recognized" : ""}`}>
                      {mod.loader ? "인식됨" : "확인 필요"}
                    </span>
                  </article>
                ))
              )}
            </div>

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
              <button className="closeButton" onClick={() => setShowLogin(false)}>×</button>
            </div>

            <section className="loginOption activeLoginOption">
              <div>
                <strong>오프라인 프로필</strong>
                <span>개발 테스트와 싱글플레이 실행용입니다.</span>
              </div>
              <span>사용 가능</span>
            </section>

            <label className="field">
              <span>플레이어 이름</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Player"
              />
            </label>

            <button className="modalCreateButton" onClick={saveOfflineLogin}>
              오프라인 프로필 저장
            </button>

            <section className="loginOption minecraftInstallOption">
              <div>
                <strong>Minecraft 설치 확인</strong>
                <span>계정 앱 연결 없이 이 PC의 공식 런처와 .minecraft 폴더만 확인합니다.</span>
              </div>
              <span>{minecraftCheck?.found ? "확인됨" : "확인 필요"}</span>
            </section>

            <button
              className="modalSecondaryButton"
              type="button"
              onClick={() => void checkMinecraft()}
              disabled={checkingMinecraft}
            >
              {checkingMinecraft ? "확인 중..." : "Minecraft 설치 다시 확인"}
            </button>

            {minecraftCheck && (
              <div className={minecraftCheck.found ? "loginNotice successNotice" : "loginNotice"}>
                {minecraftCheck.message}
              </div>
            )}

            <div className="loginNotice">
              정품 구매 여부는 계정 인증 없이는 100% 확인할 수 없어서, 이 버전은 계정 앱 연결 없이 공식 Minecraft Launcher와 .minecraft 설치 흔적만 확인합니다.
            </div>
          </div>
        </div>
      )}

      {updateInfo && (
        <div className="updateBackdrop" role="presentation">
          <section
            className="updateModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-title"
          >
            <img className="updateIcon" src="/icon.png" alt="YEON Launcher" />
            <p className="updateEyebrow">YEON LAUNCHER UPDATE</p>
            <h2 id="update-title">
              새로운 버전이 나왔습니다. 업데이트를 해주세요
            </h2>
            <p className="updateDescription">
              더 안정적인 기능과 최신 변경사항을 사용하려면 새 버전으로 업데이트해 주세요.
            </p>

            <div className="versionCompare">
              <div>
                <span>현재 버전</span>
                <strong>v{updateInfo.currentVersion}</strong>
              </div>
              <span className="versionArrow">→</span>
              <div>
                <span>새 버전</span>
                <strong>v{updateInfo.latestVersion}</strong>
              </div>
            </div>

            <button
              className="updateDetailsButton"
              type="button"
              aria-expanded={showUpdateDetails}
              onClick={() => setShowUpdateDetails((current) => !current)}
            >
              {showUpdateDetails ? "업데이트 내용 닫기" : "업데이트 내용 보기"}
              <span aria-hidden="true">{showUpdateDetails ? "▲" : "▼"}</span>
            </button>

            {showUpdateDetails && (
              <section className="updateDetailsPanel" aria-label="업데이트 내용">
                <div className="updateDetailsHeader">
                  <div>
                    <span>업데이트 버전</span>
                    <strong>v{updateInfo.latestVersion}</strong>
                  </div>
                  <div>
                    <span>릴리스 이름</span>
                    <strong>{updateInfo.releaseName}</strong>
                  </div>
                </div>

                <div className="releaseNotes">
                  {updateInfo.releaseBody ? (
                    updateInfo.releaseBody
                      .split("\n")
                      .map((line, index) => (
                        <p key={`${index}-${line}`} className={line.trim() ? "" : "emptyLine"}>
                          {line || " "}
                        </p>
                      ))
                  ) : (
                    <p className="noReleaseNotes">
                      등록된 업데이트 내용이 없습니다.
                    </p>
                  )}
                </div>
              </section>
            )}

            <div className="updateActions">
              <button
                className="updatePrimary"
                type="button"
                onClick={async () => {
                  try {
                    await invoke("open_update_page", {
                      url: updateInfo.releaseUrl,
                    });
                  } catch (error) {
                    setNotice(`업데이트 페이지를 열지 못했습니다: ${String(error)}`);
                  }
                }}
              >
                업데이트하러 가기
              </button>
              <button
                className="updateLater"
                type="button"
                onClick={() => {
                  setShowUpdateDetails(false);
                  setUpdateInfo(null);
                }}
              >
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
              <button className="closeButton" onClick={() => setShowEdit(false)}>×</button>
            </div>

            <label className="field">
              <span>인스턴스 이름</span>
              <input
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                placeholder="인스턴스 이름"
              />
              <small>한글 이름도 사용할 수 있습니다.</small>
            </label>

            <label className="field">
              <span>Minecraft 버전</span>
              <input
                value={editVersion}
                onChange={(event) => setEditVersion(event.target.value)}
                placeholder="예: 1.21.11"
              />
            </label>

            <div className="quickVersions">
              {MINECRAFT_VERSIONS.map((version) => (
                <button key={version} type="button" onClick={() => setEditVersion(version)}>
                  {version}
                </button>
              ))}
            </div>

            <label className="field">
              <span>모드 로더</span>
              <select
                value={editLoader}
                onChange={(event) => setEditLoader(event.target.value as LoaderName)}
              >
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
                <input
                  value={editLoaderBuild}
                  onChange={(event) => setEditLoaderBuild(event.target.value)}
                  placeholder="latest"
                />
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
              <strong>수정해도 유지되는 것</strong>
              <span>✓ 월드(saves)</span>
              <span>✓ 설치한 모드 파일</span>
              <span>✓ 리소스팩 / 셰이더</span>
              <span>✓ 인스턴스 저장 폴더</span>
            </div>

            {(selected.minecraft_version !== editVersion.trim() ||
              selected.loader !== editLoader ||
              selected.loader_build !== (editLoader === "vanilla" ? "none" : editLoaderBuild.trim() || "latest")) && (
              <div className="editWarning">
                ⚠ Minecraft 버전 또는 로더가 변경되었습니다. 다음 플레이 때 필요한 게임/로더 파일을 다시 준비합니다.
                기존 모드가 새 버전과 호환되는지도 확인해 주세요.
              </div>
            )}

            <button
              className="modalCreateButton"
              onClick={saveEditedInstance}
              disabled={busy}
            >
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
              <button className="closeButton" onClick={() => setShowCreate(false)}>×</button>
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
              {MINECRAFT_VERSIONS.map((version) => (
                <button key={version} onClick={() => setNewVersion(version)}>
                  {version}
                </button>
              ))}
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
                <input
                  value={newLoaderBuild}
                  onChange={(event) => setNewLoaderBuild(event.target.value)}
                  placeholder="latest"
                />
                <small>보통 latest를 사용하면 됩니다. 특정 빌드도 입력할 수 있습니다.</small>
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
              </select>
            </label>

            <div className="createHint">
              생성 자체는 바로 끝납니다. 첫 플레이 시 Minecraft, 라이브러리, Java 런타임,
              선택한 모드 로더를 자동으로 내려받습니다.
            </div>

            <button className="modalCreateButton" onClick={createInstance} disabled={busy}>
              {busy ? "생성 중..." : "인스턴스 만들기"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
