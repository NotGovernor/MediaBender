import { Match, Switch, Show, createEffect, onMount, createSignal, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
  preflightModalOpen,
  isScanning,
} from "./stores/appStore";
import { scanQueue } from "./lib/autoScanner";
import { checkAndRunDeferredScan } from "./lib/deferredScan";
import type { AppSettings, WorkQueue } from "./types";

// Debounce helpers for auto-save
let settingsSaveTimer: ReturnType<typeof setTimeout> | null = null;
let guidelinesSaveTimer: ReturnType<typeof setTimeout> | null = null;

export default function App() {
  const [loaded, setLoaded] = createSignal(false);
  const [ffmpegMissing, setFfmpegMissing] = createSignal(false);
  const [ffprobeMissing, setFfprobeMissing] = createSignal(false);

  // ── Executor event listener ──
  let unlistenExecutor: (() => void) | null = null;

  onMount(async () => {
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
  });

  onCleanup(() => {
    if (unlistenExecutor) unlistenExecutor();
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
      <Sidebar />

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
        <UpdateDialog onInstall={() => {}} onOpenDownload={() => {}} />
      </div>
    </div>
  );
}
