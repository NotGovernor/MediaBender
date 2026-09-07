import { Match, Switch, Show, createEffect, onMount, createSignal, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import Sidebar from "./components/Sidebar";
import ConfirmDialog from "./components/ConfirmDialog";
import UpdateDialog from "./components/UpdateDialog";
import ReviewModal from "./components/ReviewModal";
import DetailModal from "./components/DetailModal";
import FFprobeRawModal from "./components/FFprobeRawModal";
import PreflightModal from "./components/PreflightModal";
import DashboardPage from "./pages/DashboardPage";
import SettingsPage from "./pages/SettingsPage";
import GuidelinesPage from "./pages/GuidelinesPage";
import {
  currentView,
  settings,
  setSettings,
  workQueue,
  setWorkQueue,
  addLog,
  updateFile,
  reviewModalOpen,
  detailModalOpen,
  ffprobeRawModalOpen,
  preflightModalOpen,
  confirmDialogOpen,
  isScanning,
  appVersion,
  setAppVersion,
  availableUpdateVersion,
  updateDialogPhase,
  setUpdateDialogPhase,
  setUpdateProgress,
  setUpdateError,
  setFileDropHovering,
} from "./stores/appStore";
import { scanQueue } from "./lib/autoScanner";
import { checkAndRunDeferredScan } from "./lib/deferredScan";
import { isQueueBlockingUpdate, shouldCheckOnLaunch } from "./lib/updates";
import { getLastUpdate, setLastUpdate, performCheck, openDownloadPage } from "./lib/updateSession";
import {
  shouldAcceptFileDrop,
  nextFileDropHover,
  applyFileDrop,
} from "./lib/fileDrop";
import { scanPendingAfterAdd } from "./lib/scanPendingAfterAdd";
import { applyGenerateEvent } from "./lib/applyGenerateEvent";
import type { AddPathsResult, AppSettings, VideoFile, WorkQueue } from "./types";

// Debounce helpers for auto-save
let settingsSaveTimer: ReturnType<typeof setTimeout> | null = null;
let guidelinesSaveTimer: ReturnType<typeof setTimeout> | null = null;

function formatByteCount(n: number): string {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

async function handleVersionClick() {
  if (isQueueBlockingUpdate(workQueue().files) && availableUpdateVersion()) {
    addLog({
      timestamp: new Date().toISOString(),
      level: "warn",
      message: "Finish or stop the queue before updating.",
    });
    return;
  }
  if (availableUpdateVersion()) {
    setUpdateDialogPhase("confirm");
    return;
  }
  await performCheck({ silent: false });
}

async function handleInstall() {
  if (isQueueBlockingUpdate(workQueue().files)) {
    addLog({
      timestamp: new Date().toISOString(),
      level: "warn",
      message: "Finish or stop the queue before updating.",
    });
    setUpdateDialogPhase("idle");
    return;
  }

  setUpdateDialogPhase("downloading");
  setUpdateProgress("Starting download…");

  try {
    let update = getLastUpdate();
    if (!update) {
      update = await check();
      setLastUpdate(update);
    }
    if (!update) {
      const message = "No update available to install.";
      setUpdateError(message);
      setUpdateDialogPhase("error");
      addLog({
        timestamp: new Date().toISOString(),
        level: "error",
        message,
      });
      return;
    }

    let downloaded = 0;
    let contentLength: number | undefined;
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        downloaded = 0;
        contentLength = event.data.contentLength;
        setUpdateProgress("Downloading…");
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        if (contentLength != null) {
          setUpdateProgress(
            `Downloading ${formatByteCount(downloaded)} / ${formatByteCount(contentLength)}`,
          );
        }
      } else if (event.event === "Finished") {
        setUpdateProgress("Installing…");
      }
    });
    await relaunch();
  } catch (err) {
    setUpdateError(String(err));
    setUpdateDialogPhase("error");
    addLog({
      timestamp: new Date().toISOString(),
      level: "error",
      message: `Update install failed: ${err}`,
    });
  }
}

async function handleOpenDownload() {
  await openDownloadPage();
}

export default function App() {
  const [loaded, setLoaded] = createSignal(false);
  const [ffmpegMissing, setFfmpegMissing] = createSignal(false);
  const [ffprobeMissing, setFfprobeMissing] = createSignal(false);

  // ── Executor event listener ──
  let unlistenExecutor: (() => void) | null = null;
  let unlistenGenerate: (() => void) | null = null;
  let unlistenDrag: (() => void) | undefined;
  const preventNav = (e: DragEvent) => {
    e.preventDefault();
  };

  onMount(async () => {
    window.addEventListener("dragover", preventNav);
    window.addEventListener("drop", preventNav);

    // Listen for executor events from backend
    unlistenExecutor = await listen("executor-event", (event) => {
      const payload = event.payload as {
        type: string;
        fileId: string;
        line?: string;
        success?: boolean;
        message?: string;
        outputSize?: number;
        processingDuration?: number;
        completedAt?: string;
      };

      if (payload.type === "stdout" || payload.type === "stderr") {
        // FFmpeg output — log at debug level
        addLog({
          timestamp: new Date().toISOString(),
          level: "debug",
          message: `[${payload.type}] ${payload.line ?? ""}`,
          file_id: payload.fileId,
        });
      } else if (payload.type === "started") {
        updateFile(payload.fileId, {
          status: "Processing",
          updated_at: new Date().toISOString(),
        });
        addLog({
          timestamp: new Date().toISOString(),
          level: "info",
          message: `Started processing: ${payload.fileId}`,
          file_id: payload.fileId,
        });
      } else if (payload.type === "completed") {
        const success = payload.success ?? false;
        const fileId = payload.fileId;

        if (success) {
          updateFile(fileId, {
            status: "Completed",
            output_size: payload.outputSize ?? 0,
            error_message: "",
            processing_duration: payload.processingDuration ?? 0,
            completed_at: payload.completedAt ?? new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          addLog({
            timestamp: new Date().toISOString(),
            level: "info",
            message: `Completed: ${payload.message ?? ""}`,
            file_id: fileId,
          });
        } else {
          updateFile(fileId, {
            status: "Error",
            error_message: payload.message ?? "Processing failed",
            processing_duration: payload.processingDuration ?? 0,
            completed_at: payload.completedAt ?? new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          addLog({
            timestamp: new Date().toISOString(),
            level: "error",
            message: `Failed: ${payload.message ?? ""}`,
            file_id: fileId,
          });
        }
      }
    });

    unlistenGenerate = await listen<VideoFile>("generate-event", (event) => {
      applyGenerateEvent(event.payload);
    });

    try {
      setAppVersion(await getVersion());
    } catch {
      /* ignore in tests / non-tauri */
    }

    let dropInFlight = false;
    try {
      unlistenDrag = await getCurrentWebview().onDragDropEvent(async (event) => {
        const accept = shouldAcceptFileDrop({
          view: currentView(),
          reviewModalOpen: reviewModalOpen(),
          detailModalOpen: detailModalOpen(),
          ffprobeRawModalOpen: ffprobeRawModalOpen(),
          preflightModalOpen: preflightModalOpen(),
          confirmDialogOpen: confirmDialogOpen(),
          updateDialogOpen: updateDialogPhase() !== "idle",
        });
        const type = event.payload.type;
        setFileDropHovering(nextFileDropHover(type, accept));
        if (type !== "drop") return;
        if (!accept) return;
        if (dropInFlight) return;
        dropInFlight = true;
        try {
          const paths = event.payload.paths;
          await applyFileDrop(paths, {
            accept: true,
            addPaths: (p) => invoke<AddPathsResult>("add_paths", { paths: p }),
            setWorkQueue,
            addLog,
            scanAfterAdd: scanPendingAfterAdd,
          });
        } finally {
          dropInFlight = false;
        }
      });
    } catch {
      /* ignore in tests / non-tauri */
    }

    try {
      const loadedSettings = await invoke<AppSettings>("load_settings");
      setSettings(loadedSettings);
    } catch (err) {
      addLog({
        timestamp: new Date().toISOString(),
        level: "warn",
        message: `Failed to load settings: ${err}`,
      });
    }

    try {
      const loadedGuidelines = await invoke<string>("load_guidelines");
      setWorkQueue((q) => ({ ...q, guidelines: loadedGuidelines }));
    } catch (err) {
      addLog({
        timestamp: new Date().toISOString(),
        level: "warn",
        message: `Failed to load guidelines: ${err}`,
      });
    }

    try {
      const loadedQueue = await invoke<WorkQueue>("load_queue");
      setWorkQueue(loadedQueue);
    } catch (err) {
      addLog({
        timestamp: new Date().toISOString(),
        level: "warn",
        message: `Failed to load queue: ${err}`,
      });
    }

    setLoaded(true);

    if (
      shouldCheckOnLaunch({
        isDev: import.meta.env.DEV,
        checkOnStartup: settings().check_updates_on_startup,
      })
    ) {
      await performCheck({ silent: true });
    }
  });

  onCleanup(() => {
    window.removeEventListener("dragover", preventNav);
    window.removeEventListener("drop", preventNav);
    unlistenDrag?.();
    if (unlistenExecutor) unlistenExecutor();
    unlistenGenerate?.();
  });

  // Keep FFmpeg missing signals in sync with settings
  createEffect(() => {
    const s = settings();
    setFfmpegMissing(s.ffmpeg_path === "");
    setFfprobeMissing(s.ffprobe_path === "");
  });

  // ── Auto-save settings (2s debounce) ──
  createEffect(() => {
    if (!loaded()) return;
    const s = settings();

    if (settingsSaveTimer) clearTimeout(settingsSaveTimer);
    settingsSaveTimer = setTimeout(async () => {
      try {
        await invoke("save_settings", { newSettings: s });
      } catch (err) {
        addLog({
          timestamp: new Date().toISOString(),
          level: "error",
          message: `Failed to save settings: ${err}`,
        });
      }
    }, 2000);
  });

  // ── Auto-save guidelines (2s debounce) ──
  createEffect(() => {
    if (!loaded()) return;
    const guidelines = workQueue().guidelines;

    if (guidelinesSaveTimer) clearTimeout(guidelinesSaveTimer);
    guidelinesSaveTimer = setTimeout(async () => {
      try {
        await invoke("save_guidelines", { guidelines });
      } catch (err) {
        addLog({
          timestamp: new Date().toISOString(),
          level: "error",
          message: `Failed to save guidelines: ${err}`,
        });
      }
    }, 2000);
  });

  // ── Deferred auto-scan when ffprobe path becomes configured ──
  let previousFfprobePath = "";
  createEffect(() => {
    if (!loaded()) return;
    const currentPath = settings().ffprobe_path;

    checkAndRunDeferredScan({
      previousPath: previousFfprobePath,
      currentPath,
      isScanning: isScanning(),
      scanQueue,
      addLog,
    });

    previousFfprobePath = currentPath;
  });

  const missingMessage = () => {
    if (ffmpegMissing() && ffprobeMissing()) return "FFmpeg and FFprobe not found.";
    if (ffmpegMissing()) return "FFmpeg not found.";
    return "FFprobe not found.";
  };

  return (
    <div class="h-full flex bg-bg-primary text-text-primary">
      <Sidebar onVersionClick={handleVersionClick} />

      <div class="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Show when={ffmpegMissing() || ffprobeMissing()}>
          <div class="bg-danger/10 border-b border-danger/20 px-4 py-2.5 flex items-center gap-3 flex-shrink-0">
            <svg class="w-4 h-4 text-danger flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span class="text-xs text-danger">
              {missingMessage()}{" "}
              <a
                href="https://ffmpeg.org/download.html"
                target="_blank"
                class="underline hover:opacity-80"
              >
                Download FFmpeg
              </a>
              {" "}to use this app, then restart.
            </span>
          </div>
        </Show>

        <main class="flex-1 overflow-hidden">
          <Switch>
            <Match when={currentView() === "dashboard"}>
              <DashboardPage />
            </Match>
            <Match when={currentView() === "settings"}>
              <SettingsPage />
            </Match>
            <Match when={currentView() === "guidelines"}>
              <GuidelinesPage />
            </Match>
          </Switch>
        </main>

        {/* Global Modals */}
        <ReviewModal />
        <DetailModal />
        <FFprobeRawModal />
        <Show when={preflightModalOpen()}>
          <PreflightModal />
        </Show>
        <ConfirmDialog />
        <UpdateDialog
          currentVersion={appVersion()}
          onInstall={handleInstall}
          onOpenDownload={handleOpenDownload}
        />
      </div>
    </div>
  );
}
