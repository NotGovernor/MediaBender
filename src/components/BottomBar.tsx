import { createSignal, Show } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import {
  workQueue,
  setWorkQueue,
  settings,
  setSettings,
  addLog,
  setConfirmDialogOpen,
  setConfirmDialogConfig,
} from "../stores/appStore";
import type { WorkQueue } from "../types";
import { scanPendingAfterAdd } from "../lib/scanPendingAfterAdd";

export default function BottomBar() {
  const [dropdownOpen, setDropdownOpen] = createSignal(false);

  const handleAddFiles = async () => {
    setDropdownOpen(false);
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "Video Files",
            extensions: ["mkv", "mp4", "avi", "mov", "wmv", "flv", "webm", "m4v", "ts", "m2ts", "mts", "vob"],
          },
        ],
      });

      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];

      const added = await invoke<WorkQueue>("add_files", { paths });
      setWorkQueue(added);
      addLog({
        timestamp: new Date().toISOString(),
        level: "info",
        message: `Added ${paths.length} file(s) to queue`,
      });

      await scanPendingAfterAdd();
    } catch (err) {
      addLog({
        timestamp: new Date().toISOString(),
        level: "error",
        message: `Failed to add files: ${err}`,
      });
    }
  };

  const handleAddFolder = async () => {
    setDropdownOpen(false);
    try {
      const selected = await open({
        multiple: false,
        directory: true,
      });

      if (!selected || Array.isArray(selected)) return;

      const added = await invoke<WorkQueue>("add_folder", { folderPath: selected });
      setWorkQueue(added);
      addLog({
        timestamp: new Date().toISOString(),
        level: "info",
        message: `Added folder to queue: ${selected}`,
      });

      await scanPendingAfterAdd();
    } catch (err) {
      addLog({
        timestamp: new Date().toISOString(),
        level: "error",
        message: `Failed to add folder: ${err}`,
      });
    }
  };

  const handleClearQueue = () => {
    if (workQueue().files.length === 0) return;
    setConfirmDialogConfig({
      title: "Clear Queue?",
      message: "This will remove all files from the current queue. This action cannot be undone.",
      confirmText: "Clear Queue",
      confirmVariant: "danger",
      onConfirm: async () => {
        try {
          const cleared = await invoke<WorkQueue>("clear_queue");
          setWorkQueue(cleared);
          addLog({
            timestamp: new Date().toISOString(),
            level: "info",
            message: "Queue cleared",
          });
        } catch (err) {
          addLog({
            timestamp: new Date().toISOString(),
            level: "error",
            message: `Failed to clear queue: ${err}`,
          });
        }
      },
    });
    setConfirmDialogOpen(true);
  };

  const handleSelectOutputFolder = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: true,
      });
      if (!selected || Array.isArray(selected)) return;
      setSettings((s) => ({ ...s, default_output_folder: selected }));
      addLog({
        timestamp: new Date().toISOString(),
        level: "info",
        message: `Output folder set to: ${selected}`,
      });
    } catch (err) {
      addLog({
        timestamp: new Date().toISOString(),
        level: "error",
        message: `Failed to select output folder: ${err}`,
      });
    }
  };

  const outputFolder = () => settings().default_output_folder;

  return (
    <div class="h-12 bg-bg-secondary border-t border-border flex items-center px-4 gap-3 flex-shrink-0">
      <button
        onClick={handleClearQueue}
        disabled={workQueue().files.length === 0}
        class="px-3 py-1.5 rounded text-xs font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        Clear Queue
      </button>

      <div class="flex-1 flex items-center gap-2 min-w-0">
        <span class="text-xs text-text-muted flex-shrink-0">Output:</span>
        {outputFolder() ? (
          <span class="text-xs text-text-primary truncate min-w-0" title={outputFolder()}>
            {outputFolder()}
          </span>
        ) : (
          <span class="text-xs text-danger truncate min-w-0">
            No output folder selected — select one before processing
          </span>
        )}
        <button
          onClick={handleSelectOutputFolder}
          class="px-2.5 py-1 rounded text-xs font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 transition-colors flex-shrink-0"
        >
          Select...
        </button>
      </div>

      {/* Split Add Button */}
      <div class="relative flex-shrink-0">
        <div class="flex">
          <button
            onClick={handleAddFiles}
            class="px-3 py-1.5 rounded-l text-xs font-medium bg-gold text-bg-primary hover:bg-gold-light transition-colors"
          >
            + Add Files
          </button>
          <button
            onClick={() => setDropdownOpen(!dropdownOpen())}
            class="px-2 py-1.5 rounded-r text-xs font-medium bg-gold text-bg-primary hover:bg-gold-light border-l border-gold-dark transition-colors"
            aria-label="More add options"
          >
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
        <Show when={dropdownOpen()}>
          <div class="absolute right-0 bottom-full mb-1 w-40 bg-bg-elevated border border-border rounded shadow-lg z-50">
            <button
              onClick={handleAddFiles}
              class="w-full text-left px-3 py-2 text-xs text-gold hover:bg-gold/10 transition-colors rounded-t"
            >
              Add Files...
            </button>
            <button
              onClick={handleAddFolder}
              class="w-full text-left px-3 py-2 text-xs text-gold hover:bg-gold/10 transition-colors rounded-b"
            >
              Add Folder...
            </button>
          </div>
          {/* Click outside to close */}
          <div
            class="fixed inset-0 z-40"
            onClick={() => setDropdownOpen(false)}
          />
        </Show>
      </div>
    </div>
  );
}
