import type { Update } from "@tauri-apps/plugin-updater";

let lastUpdate: Update | null = null;

export function setLastUpdate(update: Update | null): void {
  lastUpdate = update;
}

export function getLastUpdate(): Update | null {
  return lastUpdate;
}
