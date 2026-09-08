import type { Update } from "@tauri-apps/plugin-updater";
import { check } from "@tauri-apps/plugin-updater";
import { openUrl } from "@tauri-apps/plugin-opener";
import { canStartUpdateCheck, outcomeAfterCheck } from "./updates";
import {
  addLog,
  appVersion,
  setAvailableUpdateVersion,
  setUpdateTargetVersion,
  setUpdateNotes,
  setUpdateDialogPhase,
  setUpdateError,
  updateDialogPhase,
  updateCheckPhase,
  setUpdateCheckPhase,
  setUpdateCheckError,
} from "../stores/appStore";

let lastUpdate: Update | null = null;

export function setLastUpdate(update: Update | null): void {
  lastUpdate = update;
}

export function getLastUpdate(): Update | null {
  return lastUpdate;
}

export async function performCheck(opts: { silent: boolean }) {
  if (!canStartUpdateCheck(updateCheckPhase())) return;

  setUpdateCheckPhase("checking");
  setUpdateCheckError("");

  const finishDev = () => {
    const out = outcomeAfterCheck({
      isDev: true,
      silent: opts.silent,
      errorMessage: null,
      foundVersion: null,
    });
    setUpdateCheckPhase(out.phase);
    setUpdateCheckError(out.errorMessage);
    if (!opts.silent) {
      addLog({
        timestamp: new Date().toISOString(),
        level: "debug",
        message: "Skipping update check in dev",
      });
    }
  };

  if (import.meta.env.DEV) {
    finishDev();
    return;
  }

  try {
    const result = await check();
    setLastUpdate(result);
    const out = outcomeAfterCheck({
      isDev: false,
      silent: opts.silent,
      errorMessage: null,
      foundVersion: result ? result.version : null,
    });
    setUpdateCheckPhase(out.phase);
    setUpdateCheckError(out.errorMessage);
    setAvailableUpdateVersion(out.availableVersion);
    if (result && out.availableVersion) {
      setUpdateTargetVersion(result.version);
      setUpdateNotes(result.body ?? "");
    }
    if (out.openDialog) {
      setUpdateDialogPhase("confirm");
    }
    if (!result && !opts.silent) {
      addLog({
        timestamp: new Date().toISOString(),
        level: "info",
        message: `You're on the latest version (v${appVersion()}).`,
      });
    }
  } catch (err) {
    setLastUpdate(null);
    const out = outcomeAfterCheck({
      isDev: false,
      silent: opts.silent,
      errorMessage: String(err),
      foundVersion: null,
    });
    setUpdateCheckPhase(out.phase);
    setUpdateCheckError(out.errorMessage);
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
