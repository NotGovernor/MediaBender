import { Show } from "solid-js";
import { confirmDialogOpen, confirmDialogConfig, setConfirmDialogOpen } from "../stores/appStore";

export default function ConfirmDialog() {
  const config = confirmDialogConfig;

  const handleConfirm = () => {
    config()?.onConfirm();
    setConfirmDialogOpen(false);
  };

  return (
    <Show when={confirmDialogOpen()}>
      <div class="fixed inset-0 z-[60] flex items-center justify-center">
        <div
          class="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={() => setConfirmDialogOpen(false)}
        />

        <div class="relative bg-bg-secondary border border-border rounded-lg shadow-2xl w-full max-w-md mx-4 p-6">
          <div class="flex items-start gap-4">
            <div class="flex-shrink-0 w-10 h-10 rounded-full bg-danger/10 flex items-center justify-center text-danger text-lg">
              ⚠
            </div>
            <div class="flex-1">
              <h3 class="text-base font-semibold text-text-primary mb-1">
                {config()?.title ?? "Confirm"}
              </h3>
              <p class="text-sm text-text-secondary mb-2">{config()?.message}</p>
              <Show when={config()?.detail}>
                <div class="bg-danger/10 border border-danger/20 rounded px-3 py-2 text-sm text-danger font-mono break-all">
                  {config()?.detail}
                </div>
              </Show>
            </div>
          </div>

          <div class="flex justify-end gap-3 mt-6">
            <button
              onClick={() => setConfirmDialogOpen(false)}
              class="px-4 py-2 rounded text-sm font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              class={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                config()?.confirmVariant === "danger"
                  ? "bg-danger text-white hover:bg-danger-hover"
                  : "bg-gold text-bg-primary hover:bg-gold-light"
              }`}
            >
              {config()?.confirmText ?? "Confirm"}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
