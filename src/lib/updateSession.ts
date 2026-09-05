import type { Update } from "@tauri-apps/plugin-updater";
import { check } from "@tauri-apps/plugin-updater";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  addLog,
  appVersion,
  setAvailableUpdateVersion,
  setUpdateTargetVersion,
  setUpdateNotes,
  setUpdateDialogPhase,
  setUpdateError,
  updateDialogPhase,
} from "../stores/appStore";

let lastUpdate: Update | null = null;

export function setLastUpdate(update: Update | null): void {
  lastUpdate = update;
}

export function getLastUpdate(): Update | null {
  return lastUpdate;
}

export async function performCheck(opts: { silent: boolean }) {
  if (import.meta.env.DEV) {
    if (!opts.silent) {
      addLog({
        timestamp: new Date().toISOString(),
        level: "debug",
        message: "Skipping update check in dev",
      });
    }
    return;
  }

  try {
    const result = await check();
    setLastUpdate(result);
    if (!result) {
      setAvailableUpdateVersion(null);
      if (!opts.silent) {
        addLog({
          timestamp: new Date().toISOString(),
          level: "info",
          message: `You're on the latest version (v${appVersion()}).`,
        });
      }
      return;
    }

    setAvailableUpdateVersion(result.version);
    setUpdateTargetVersion(result.version);
    setUpdateNotes(result.body ?? "");
    if (!opts.silent) {
      setUpdateDialogPhase("confirm");
    }
  } catch (err) {
    setLastUpdate(null);
    if (opts.silent) {
      addLog({
        timestamp: new Date().toISOString(),
        level: "debug",
        message: `Update check failed: ${err}`,
      });
      return;
    }
    addLog({
      timestamp: new Date().toISOString(),
      level: "error",
      message: `Update check failed: ${err}`,
    });
    if (updateDialogPhase() !== "idle") {
      setUpdateError(String(err));
      setUpdateDialogPhase("error");
    }
  }
}

export async function openDownloadPage() {
  try {
    await openUrl("https://github.com/NotGovernor/MediaBender/releases");
  } catch (err) {
    addLog({
      timestamp: new Date().toISOString(),
      level: "error",
      message: `Failed to open download page: ${err}`,
    });
  }
}
