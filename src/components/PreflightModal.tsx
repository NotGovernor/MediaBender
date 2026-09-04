import { Show, For } from "solid-js";
import { settings, setCurrentView, setPreflightModalOpen } from "../stores/appStore";
import Modal from "./Modal";

interface Prerequisite {
  id: string;
  label: string;
  description: string;
  satisfied: () => boolean;
  actionLabel: string;
  action: () => void;
}

export default function PreflightModal() {
  const prerequisites = (): Prerequisite[] => [
    {
      id: "ai_provider",
      label: "AI Provider",
      description: "Configure an AI provider with URL, API key, and model",
      satisfied: () => {
        const s = settings();
        const provider = s.providers[s.active_provider_index];
        return !!provider && provider.base_url.trim() !== "" && provider.api_key.trim() !== "" && provider.model.trim() !== "";
      },
      actionLabel: "Go to Settings",
      action: () => {
        setPreflightModalOpen(false);
        setCurrentView("settings");
      },
    },
    {
      id: "output_path",
      label: "Output Folder",
      description: "Select where transcoded files will be saved",
      satisfied: () => settings().default_output_folder.trim() !== "",
      actionLabel: "Go to Dashboard",
      action: () => {
        setPreflightModalOpen(false);
        setCurrentView("dashboard");
      },
    },
    {
      id: "ffmpeg",
      label: "FFmpeg & FFprobe",
      description: "Required for video analysis and transcoding",
      satisfied: () => settings().ffmpeg_path !== "" && settings().ffprobe_path !== "",
      actionLabel: "Go to Settings",
      action: () => {
        setPreflightModalOpen(false);
        setCurrentView("settings");
      },
    },
  ];

  const allSatisfied = () => prerequisites().every((p) => p.satisfied());

  return (
    <Modal
      open={true}
      onClose={() => setPreflightModalOpen(false)}
      title="Ready to Process?"
      maxWidth="max-w-md"
    >
      <div class="space-y-4">
        <p class="text-sm text-text-secondary">
          The following must be configured before you can start processing:
        </p>

        <div class="space-y-3">
          <For each={prerequisites()}>
            {(item) => {
              const ok = item.satisfied();
              return (
                <div
                  class={`border rounded-lg p-3 flex items-start gap-3 ${
                    ok ? "border-gold/30 bg-gold/5" : "border-danger/30 bg-danger/5"
                  }`}
                >
                  <div class="mt-0.5 flex-shrink-0">
                    {ok ? (
                      <svg class="w-5 h-5 text-gold" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg class="w-5 h-5 text-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between gap-2">
                      <span class={`text-sm font-medium ${ok ? "text-gold" : "text-danger"}`}>
                        {item.label}
                      </span>
                      <Show when={!ok}>
                        <button
                          onClick={item.action}
                          class="text-xs text-gold hover:text-gold-light underline flex-shrink-0"
                        >
                          {item.actionLabel}
                        </button>
                      </Show>
                    </div>
                    <p class="text-xs text-text-muted mt-0.5">{item.description}</p>
                  </div>
                </div>
              );
            }}
          </For>
        </div>

        <Show when={allSatisfied()}>
          <div class="text-center pt-2">
            <p class="text-sm text-gold font-medium">All set! You're ready to process.</p>
          </div>
        </Show>

        <div class="flex justify-end pt-2">
          <button
            onClick={() => setPreflightModalOpen(false)}
            class="px-4 py-2 rounded text-sm font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 transition-colors"
          >
            {allSatisfied() ? "Close" : "Dismiss"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
