import { For, Index, Show, createSignal, createEffect } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { settings, setSettings, appVersion, availableUpdateVersion, updateCheckPhase, updateCheckError } from "../stores/appStore";
import { formatAvailableNote } from "../lib/updates";
import { openDownloadPage, performCheck } from "../lib/updateSession";
import type { AIProviderConfig, AppSettings } from "../types";
import { clampMaxParallel } from "../lib/clampMaxParallel";

function getProviderTitle(provider: AIProviderConfig): string {
  let domain = "";
  try {
    const url = new URL(provider.base_url);
    const parts = url.hostname.split(".");
    if (parts.length > 2) {
      domain = parts.slice(-2).join(".");
    } else {
      domain = url.hostname;
    }
  } catch {
    domain = provider.base_url.trim() || "New Provider";
  }
  const model = provider.model.trim();
  if (domain && model) return `${domain} - ${model}`;
  if (domain) return domain;
  if (model) return model;
  return "New Provider";
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = createSignal<"providers" | "paths" | "file-handling" | "execution">("providers");
  const [availableModels, setAvailableModels] = createSignal<Record<number, string[]>>({});
  const [fetchingIndex, setFetchingIndex] = createSignal<number | null>(null);
  const [fetchError, setFetchError] = createSignal<Record<number, string>>({});
  const [verifyingPaths, setVerifyingPaths] = createSignal(false);
  const [ffmpegStatus, setFfmpegStatus] = createSignal<"good" | "not_found" | null>(null);
  const [ffprobeStatus, setFfprobeStatus] = createSignal<"good" | "not_found" | null>(null);

  // Derive status from settings so it shows immediately when the tab opens
  createEffect(() => {
    const s = settings();
    setFfmpegStatus(s.ffmpeg_path !== "" ? "good" : "not_found");
    setFfprobeStatus(s.ffprobe_path !== "" ? "good" : "not_found");
  });

  const updateProvider = (index: number, updates: Partial<AIProviderConfig>) => {
    setSettings((s) => ({
      ...s,
      providers: s.providers.map((p, i) => (i === index ? { ...p, ...updates } : p)),
    }));
  };

  const addProvider = () => {
    setSettings((s) => ({
      ...s,
      providers: [
        ...s.providers,
        {
          base_url: "",
          api_key: "",
          model: "",
        },
      ],
      active_provider_index: s.providers.length,
    }));
  };

  const removeProvider = (index: number) => {
    setSettings((s) => ({
      ...s,
      providers: s.providers.filter((_, i) => i !== index),
      active_provider_index:
        s.active_provider_index >= index && s.active_provider_index > 0
          ? s.active_provider_index - 1
          : s.active_provider_index,
    }));
    setAvailableModels((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    setFetchError((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const handleVerifyPaths = async () => {
    setVerifyingPaths(true);
    setFfmpegStatus(null);
    setFfprobeStatus(null);
    try {
      await invoke("save_settings", { newSettings: settings() });
      const result = await invoke<[boolean, boolean]>("verify_ffmpeg_paths");
      const [ffmpegFound, ffprobeFound] = result;

      // Refresh settings from backend to pick up discovered paths
      const refreshed = await invoke<AppSettings>("load_settings");
      setSettings(refreshed);

      setFfmpegStatus(ffmpegFound ? "good" : "not_found");
      setFfprobeStatus(ffprobeFound ? "good" : "not_found");
    } catch (err) {
      setFfmpegStatus("not_found");
      setFfprobeStatus("not_found");
    } finally {
      setVerifyingPaths(false);
    }
  };

  const handleRefreshModels = async (index: number) => {
    const provider = settings().providers[index];
    if (!provider.base_url.trim()) {
      setFetchError((prev) => ({ ...prev, [index]: "Enter a Base URL first" }));
      return;
    }

    setFetchingIndex(index);
    setFetchError((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });

    try {
      const models = await invoke<string[]>("fetch_models", {
        baseUrl: provider.base_url.trim(),
        apiKey: provider.api_key,
      });
      setAvailableModels((prev) => ({ ...prev, [index]: models }));
    } catch (err) {
      setFetchError((prev) => ({ ...prev, [index]: String(err) }));
    } finally {
      setFetchingIndex(null);
    }
  };

  return (
    <div class="h-full flex flex-col">
      <div class="px-6 py-4 border-b border-border">
        <h1 class="text-lg font-semibold text-text-primary">Settings</h1>
        <p class="text-sm text-text-muted mt-1">Configure AI providers, FFmpeg paths, and execution settings</p>
      </div>

      {/* Tabs */}
      <div class="flex border-b border-border px-6">
        {[
          { key: "providers" as const, label: "AI Providers" },
          { key: "paths" as const, label: "FFmpeg Paths" },
          { key: "file-handling" as const, label: "File Handling" },
          { key: "execution" as const, label: "Execution" },
        ].map((tab) => (
          <button
            onClick={() => setActiveTab(tab.key)}
            class={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab() === tab.key
                ? "border-gold text-gold"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div class="flex-1 overflow-y-auto p-6">
        {/* AI Providers */}
        {activeTab() === "providers" && (
          <div class="space-y-6 max-w-3xl">
            <Index each={settings().providers}>
              {(provider, index) => (
                <div
                  class={`border rounded-lg p-4 ${
                    settings().active_provider_index === index
                      ? "border-gold/50 bg-gold/5"
                      : "border-border bg-bg-tertiary"
                  }`}
                >
                  <div class="flex items-center justify-between mb-3">
                    <div
                      class="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => setSettings((s) => ({ ...s, active_provider_index: index }))}
                    >
                      <input
                        type="radio"
                        name="active_provider"
                        checked={settings().active_provider_index === index}
                        onChange={() => setSettings((s) => ({ ...s, active_provider_index: index }))}
                        class="accent-gold pointer-events-none"
                      />
                      <span class="text-sm font-medium text-text-primary">{getProviderTitle(provider())}</span>
                      {settings().active_provider_index === index && (
                        <span class="text-xs bg-gold/20 text-gold px-2 py-0.5 rounded">Active</span>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeProvider(index);
                      }}
                      class="text-text-muted hover:text-danger text-xs"
                    >
                      Remove
                    </button>
                  </div>

                  <div class="space-y-3">
                    <div>
                      <label class="block text-xs text-text-muted mb-1">Base URL</label>
                      <input
                        type="text"
                        value={provider().base_url}
                        onInput={(e) => updateProvider(index, { base_url: e.currentTarget.value })}
                        placeholder="https://api.example.com/v1"
                        class="w-full bg-bg-secondary border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                    </div>
                    <div>
                      <label class="block text-xs text-text-muted mb-1">API Key</label>
                      <input
                        type="password"
                        value={provider().api_key}
                        onInput={(e) => updateProvider(index, { api_key: e.currentTarget.value })}
                        placeholder="sk-..."
                        class="w-full bg-bg-secondary border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                      />
                    </div>
                    <div>
                      <label class="block text-xs text-text-muted mb-1">Model</label>
                      <div class="flex gap-2">
                        <select
                          value={provider().model}
                          onChange={(e) => updateProvider(index, { model: e.currentTarget.value })}
                          class="flex-1 bg-bg-secondary border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-gold/50"
                        >
                          <option value="" disabled={provider().model !== ""}>
                            {availableModels()[index]?.length
                              ? "Select a model..."
                              : "Enter URL + API key, then click refresh"}
                          </option>
                          <For each={availableModels()[index] ?? []}>
                            {(model) => <option value={model}>{model}</option>}
                          </For>
                          {provider().model && !(availableModels()[index] ?? []).includes(provider().model) && (
                            <option value={provider().model}>{provider().model} (custom)</option>
                          )}
                        </select>
                        <button
                          onClick={() => handleRefreshModels(index)}
                          disabled={fetchingIndex() === index}
                          class="px-3 py-1.5 rounded text-xs font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 disabled:opacity-50 transition-colors flex items-center gap-1"
                          title="Refresh available models"
                        >
                          {fetchingIndex() === index ? (
                            <span class="inline-block w-3 h-3 border-2 border-text-muted border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          )}
                          Refresh
                        </button>
                      </div>
                      {fetchError()[index] && (
                        <p class="text-xs text-danger mt-1">{fetchError()[index]}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </Index>

            {settings().providers.length === 0 && (
              <div class="text-center py-12 border border-dashed border-border rounded-lg bg-bg-secondary/50">
                <p class="text-sm text-text-muted mb-4">No AI providers configured</p>
              <button
                onClick={addProvider}
                class="px-4 py-2 rounded text-sm font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 transition-colors"
              >
                + Add Provider
              </button>
            </div>
          )}

            {settings().providers.length > 0 && (
              <button
                onClick={addProvider}
                class="px-4 py-2 rounded text-sm font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 transition-colors"
              >
                + Add Provider
              </button>
            )}
          </div>
        )}

        {/* FFmpeg Paths */}
        {activeTab() === "paths" && (
          <div class="space-y-5 max-w-2xl">
            <div>
              <label class="block text-xs font-medium text-text-muted mb-1">
                FFmpeg Path
                {ffmpegStatus() === "good" && (
                  <span class="ml-2 text-xs text-emerald-400 font-normal">Good</span>
                )}
                {ffmpegStatus() === "not_found" && (
                  <span class="ml-2 text-xs text-danger font-normal">Not Found</span>
                )}
              </label>
              <input
                type="text"
                value={settings().ffmpeg_path}
                onInput={(e) => setSettings((s) => ({ ...s, ffmpeg_path: e.currentTarget.value }))}
                placeholder="ffmpeg"
                class="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
              />
              <p class="text-xs text-text-muted mt-1">Leave as "ffmpeg" to use system PATH</p>
            </div>

            <div>
              <label class="block text-xs font-medium text-text-muted mb-1">
                FFprobe Path
                {ffprobeStatus() === "good" && (
                  <span class="ml-2 text-xs text-emerald-400 font-normal">Good</span>
                )}
                {ffprobeStatus() === "not_found" && (
                  <span class="ml-2 text-xs text-danger font-normal">Not Found</span>
                )}
              </label>
              <input
                type="text"
                value={settings().ffprobe_path}
                onInput={(e) => setSettings((s) => ({ ...s, ffprobe_path: e.currentTarget.value }))}
                placeholder="ffprobe"
                class="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
              />
              <p class="text-xs text-text-muted mt-1">Leave as "ffprobe" to use system PATH</p>
            </div>

            <div>
              <button
                onClick={handleVerifyPaths}
                disabled={verifyingPaths()}
                class="px-4 py-2 rounded text-sm font-medium bg-gold text-bg-primary hover:bg-gold-light disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                {verifyingPaths() && (
                  <span class="inline-block w-3.5 h-3.5 border-2 border-bg-primary border-t-transparent rounded-full animate-spin" />
                )}
                Verify FFmpeg
              </button>
            </div>
          </div>
        )}

        {/* File Handling */}
        {activeTab() === "file-handling" && (
          <div class="space-y-5 max-w-2xl">
            <div>
              <label class="block text-xs font-medium text-text-muted mb-1">Naming Template</label>
              <input
                type="text"
                value={settings().naming_template}
                onInput={(e) => setSettings((s) => ({ ...s, naming_template: e.currentTarget.value }))}
                placeholder="{name}.mkv"
                class="w-full bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-gold/50"
              />
              <p class="text-xs text-text-muted mt-1">Use {'{name}'} for original filename without extension</p>
            </div>

            <div>
              <label for="flatten-output-folders" class="flex items-center gap-2">
                <input
                  id="flatten-output-folders"
                  type="checkbox"
                  checked={settings().flatten_output_folders}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      flatten_output_folders: e.currentTarget.checked,
                    }))
                  }
                  class="accent-gold"
                />
                <span class="text-sm text-text-primary">Flatten output folders</span>
              </label>
              <p class="text-xs text-text-muted mt-1">
                Place every transcoded file directly in the output folder. Off (default): recreate the dropped folder and its subfolders.
              </p>
            </div>
          </div>
        )}

        {/* Execution */}
        {activeTab() === "execution" && (
          <div class="space-y-5 max-w-2xl">
            <div>
              <label class="block text-xs font-medium text-text-muted mb-1" for="max-parallel">
                Max Parallel Jobs:{" "}
                <span class="text-text-primary tabular-nums">
                  {clampMaxParallel(settings().max_parallel)}
                </span>
              </label>
              <div class="flex items-center gap-3">
                <input
                  id="max-parallel"
                  type="range"
                  min="1"
                  max="4"
                  step="1"
                  aria-label="Max Parallel Jobs"
                  value={clampMaxParallel(settings().max_parallel)}
                  onInput={(e) => {
                    const max_parallel = clampMaxParallel(parseInt(e.currentTarget.value, 10));
                    setSettings((s) => ({ ...s, max_parallel }));
                    void invoke("save_settings", {
                      newSettings: { ...settings(), max_parallel },
                    });
                  }}
                  class="max-parallel-slider flex-1"
                />
              </div>
              <div class="flex justify-between text-xs text-text-muted mt-1 px-0.5">
                <span>1</span><span>2</span><span>3</span><span>4</span>
              </div>
              <p class="text-xs text-text-muted mt-1">
                Number of files to process simultaneously (1 = sequential). 2 is a safe starting point for hardware encoding; drop to 1 if you hit session-limit errors.
              </p>
            </div>

            <div>
              <label class="block text-xs font-medium text-text-muted mb-1">Updates</label>
              <p class="text-sm text-text-primary">Current version: v{appVersion()}</p>
              <Show when={availableUpdateVersion()}>
                {(version) => (
                  <p class="text-sm text-gold">{formatAvailableNote(version())}</p>
                )}
              </Show>
              <Show when={!availableUpdateVersion() && updateCheckPhase() === "current"}>
                <p class="text-sm text-text-muted">Up to date</p>
              </Show>
              <Show when={!availableUpdateVersion() && updateCheckPhase() === "skipped_dev"}>
                <p class="text-sm text-text-muted">Update checks are skipped in development</p>
              </Show>
              <Show when={!availableUpdateVersion() && updateCheckPhase() === "error"}>
                <p class="text-sm text-danger">Update check failed: {updateCheckError()}</p>
              </Show>
              <label class="flex items-center gap-2 mt-3">
                <input
                  type="checkbox"
                  checked={settings().check_updates_on_startup}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      check_updates_on_startup: e.currentTarget.checked,
                    }))
                  }
                  class="accent-gold"
                />
                <span class="text-sm text-text-primary">Check for updates on startup</span>
              </label>
              <div class="flex items-center gap-3 mt-3">
                <button
                  type="button"
                  onClick={() => performCheck({ silent: false })}
                  disabled={updateCheckPhase() === "checking"}
                  class="px-4 py-2 rounded text-sm font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 disabled:opacity-50 transition-colors flex items-center gap-2"
                >
                  {updateCheckPhase() === "checking" && (
                    <span class="inline-block w-3.5 h-3.5 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                  )}
                  Check for updates
                </button>
                <button
                  type="button"
                  onClick={() => openDownloadPage()}
                  class="text-sm text-gold underline hover:opacity-80"
                >
                  Open download page
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
