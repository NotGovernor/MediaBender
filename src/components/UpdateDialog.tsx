import { Show } from "solid-js";
import {
  updateDialogPhase,
  setUpdateDialogPhase,
  updateTargetVersion,
  updateNotes,
  updateProgress,
  updateError,
} from "../stores/appStore";

export default function UpdateDialog(props: {
  currentVersion?: string;
  onInstall: () => void;
  onOpenDownload: () => void;
}) {
  const isOpen = () => {
    const phase = updateDialogPhase();
    return phase === "confirm" || phase === "downloading" || phase === "error";
  };

  const isDownloading = () => updateDialogPhase() === "downloading";
  const isError = () => updateDialogPhase() === "error";

  const handleBackdrop = () => {
    const phase = updateDialogPhase();
    if (phase === "confirm" || phase === "error") {
      setUpdateDialogPhase("idle");
    }
  };

  const handleCancel = () => {
    if (isDownloading()) return;
    setUpdateDialogPhase("idle");
  };

  return (
    <Show when={isOpen()}>
      <div class="fixed inset-0 z-[60] flex items-center justify-center">
        <div
          class="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={handleBackdrop}
        />

        <div class="relative bg-bg-secondary border border-border rounded-lg shadow-2xl w-full max-w-md mx-4 p-6">
          <div class="flex items-start gap-4">
            <div class="flex-shrink-0 w-10 h-10 rounded-full bg-gold/10 flex items-center justify-center text-gold text-lg">
              ↑
            </div>
            <div class="flex-1">
              <h3 class="text-base font-semibold text-text-primary mb-1">
                Update available
              </h3>
              <p class="text-sm text-text-secondary mb-2">
                You're on v{props.currentVersion ?? ""}. v{updateTargetVersion()} is
                available.
              </p>
              <Show when={updateNotes()}>
                <p class="text-sm text-text-secondary mb-2 whitespace-pre-wrap">
                  {updateNotes()}
                </p>
              </Show>
              <Show when={isDownloading() && updateProgress()}>
                <p class="text-sm text-text-secondary mb-2">{updateProgress()}</p>
              </Show>
              <Show when={isError() && updateError()}>
                <p class="text-sm text-danger mb-2">{updateError()}</p>
              </Show>
            </div>
          </div>

          <div class="flex justify-end gap-3 mt-6">
            <button
              type="button"
              disabled={isDownloading()}
              onClick={handleCancel}
              class="px-4 py-2 rounded text-sm font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isDownloading()}
              onClick={() => props.onOpenDownload()}
              class="px-4 py-2 rounded text-sm font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 transition-colors disabled:opacity-50 disabled:pointer-events-none"
            >
              Open download page
            </button>
            <Show when={!isError()}>
              <button
                type="button"
                disabled={isDownloading()}
                onClick={() => props.onInstall()}
                class="px-4 py-2 rounded text-sm font-medium bg-gold text-bg-primary hover:bg-gold-light transition-colors disabled:opacity-50 disabled:pointer-events-none"
              >
                Install and restart
              </button>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}
