import { For, Show, createEffect, on } from "solid-js";
import { logEntries, logPaneOpen, setLogPaneOpen, clearLogs } from "../stores/appStore";

export default function LogPane() {
  let scrollRef: HTMLDivElement | undefined;

  // Auto-scroll to bottom when new entries arrive
  createEffect(
    on(
      () => logEntries().length,
      () => {
        if (scrollRef) {
          scrollRef.scrollTop = scrollRef.scrollHeight;
        }
      }
    )
  );

  return (
    <div class={`border-t border-border bg-bg-secondary flex flex-col transition-all duration-200 ${logPaneOpen() ? "h-48" : "h-8"}`}>
      {/* Header bar */}
      <div class="flex items-center justify-between px-4 h-8 flex-shrink-0 border-b border-border cursor-pointer" onClick={() => setLogPaneOpen(!logPaneOpen())}>
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-text-secondary">Execution Log</span>
          <Show when={logEntries().length > 0}>
            <span class="text-xs text-text-muted">({logEntries().length})</span>
          </Show>
        </div>
        <div class="flex items-center gap-2">
          <Show when={logEntries().length > 0}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                clearLogs();
              }}
              class="text-xs text-text-muted hover:text-text-primary transition-colors"
            >
              Clear
            </button>
          </Show>
          <span class="text-text-muted text-xs">{logPaneOpen() ? "▼" : "▲"}</span>
        </div>
      </div>

      {/* Log content */}
      <Show when={logPaneOpen()}>
        <div ref={scrollRef} class="flex-1 overflow-y-auto p-2 font-mono text-xs space-y-0.5">
          <For each={logEntries()}>
            {(entry) => {
              const colorClass =
                entry.level === "error"
                  ? "text-status-error"
                  : entry.level === "warn"
                  ? "text-status-ready"
                  : entry.level === "debug"
                  ? "text-text-muted"
                  : "text-text-secondary";
              return (
                <div class={`${colorClass} break-all`}>
                  <span class="text-text-muted opacity-50">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>{" "}
                  <span class="font-semibold">[{entry.level.toUpperCase()}]</span>{" "}
                  {entry.message}
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
