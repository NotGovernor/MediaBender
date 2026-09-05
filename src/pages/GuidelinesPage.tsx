import { createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import {
  workQueue,
  updateQueue,
  setConfirmDialogOpen,
  setConfirmDialogConfig,
  settings,
  addLog,
} from "../stores/appStore";
import GuidelinesInterviewModal from "../components/GuidelinesInterviewModal";

export default function GuidelinesPage() {
  const [interviewOpen, setInterviewOpen] = createSignal(false);

  const handleGenerateWithAiInterview = () => {
    const s = settings();
    const provider = s.providers[s.active_provider_index];
    const hasProvider =
      !!provider &&
      provider.base_url.trim() !== "" &&
      provider.api_key.trim() !== "" &&
      provider.model.trim() !== "";
    if (!hasProvider) {
      addLog({
        timestamp: new Date().toISOString(),
        level: "error",
        message:
          "Guidelines interview requires an AI provider. Configure one in Settings.",
      });
      return;
    }
    setInterviewOpen(true);
  };

  const handleResetToDefault = () => {
    setConfirmDialogConfig({
      title: "Reset Guidelines?",
      message:
        "This will replace your current guidelines with the default prompt. This cannot be undone.",
      confirmText: "Reset to Default",
      confirmVariant: "danger",
      onConfirm: async () => {
        try {
          const defaultGuidelines = await invoke<string>(
            "get_default_guidelines"
          );
          updateQueue({ guidelines: defaultGuidelines });
        } catch (err) {
          console.error("Failed to get default guidelines:", err);
        }
      },
    });
    setConfirmDialogOpen(true);
  };

  return (
    <div class="h-full flex flex-col">
      <div class="px-6 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h1 class="text-lg font-semibold text-text-primary">
            Transcoding Guidelines
          </h1>
          <p class="text-sm text-text-muted mt-1">
            Edit the system prompt that guides the AI when generating FFmpeg
            commands
          </p>
        </div>
        <div class="flex items-center gap-3">
          <button
            onClick={handleGenerateWithAiInterview}
            class="px-4 py-1.5 rounded text-sm font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 transition-colors"
          >
            Generate with AI Interview
          </button>
          <button
            onClick={handleResetToDefault}
            class="text-sm font-medium text-text-muted hover:text-danger transition-colors"
          >
            Reset to Default
          </button>
        </div>
      </div>

      <div class="flex-1 flex overflow-hidden">
        {/* Editor */}
        <div class="flex-1 p-6 overflow-y-auto">
          <textarea
            value={workQueue().guidelines}
            onInput={(e) => updateQueue({ guidelines: e.currentTarget.value })}
            class="w-full h-full min-h-[400px] bg-bg-tertiary border border-border rounded p-4 text-sm font-mono text-text-primary resize-none focus:outline-none focus:border-gold/50 leading-relaxed"
            placeholder="Enter your transcoding guidelines here..."
            spellcheck={false}
          />
        </div>

        {/* Help sidebar */}
        <div class="w-72 bg-bg-secondary border-l border-border p-4 overflow-y-auto">
          <h3 class="text-sm font-semibold text-text-primary mb-3">Help</h3>
          <div class="space-y-4 text-xs text-text-secondary">
            <div>
              <h4 class="font-medium text-text-primary mb-1">
                What are Guidelines?
              </h4>
              <p>
                The Guidelines are sent to the AI as a system prompt. They
                define your transcoding philosophy, rules, and preferences.
              </p>
            </div>
            <div>
              <h4 class="font-medium text-text-primary mb-1">
                Fixed Output Rules
              </h4>
              <p>
                Fixed output-format instructions are always appended to the
                system prompt automatically. They are not shown here and cannot
                be edited.
              </p>
            </div>
            <div>
              <h4 class="font-medium text-text-primary mb-1">
                Key Topics to Cover
              </h4>
              <ul class="list-disc pl-4 space-y-1">
                <li>Container format preferences (MKV)</li>
                <li>Audio codec rules (Opus)</li>
                <li>Video codec copy vs transcode logic</li>
                <li>HDR and bit depth handling</li>
                <li>Subtitle and chapter preservation</li>
                <li>Hardware acceleration preferences</li>
                <li>Bitrate and quality targets</li>
              </ul>
            </div>
            <div>
              <h4 class="font-medium text-text-primary mb-1">Tips</h4>
              <ul class="list-disc pl-4 space-y-1">
                <li>Be specific and explicit</li>
                <li>Include edge case handling</li>
                <li>Add examples when possible</li>
                <li>Keep it under ~4000 tokens</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      <GuidelinesInterviewModal
        open={interviewOpen()}
        onClose={() => setInterviewOpen(false)}
      />
    </div>
  );
}
