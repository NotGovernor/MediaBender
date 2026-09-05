import { Show } from "solid-js";
import {
  currentView,
  setCurrentView,
  workQueue,
  appVersion,
  availableUpdateVersion,
} from "../stores/appStore";
import { formatAvailableNote } from "../lib/updates";
import type { View } from "../types";

const navItems: { view: View; label: string; icon: string }[] = [
  { view: "dashboard", label: "Work Queue", icon: "📁" },
  { view: "settings", label: "Settings", icon: "⚙️" },
  { view: "guidelines", label: "Guidelines", icon: "📝" },
];

export default function Sidebar(props: { onVersionClick?: () => void }) {
  const fileCount = () => workQueue().files.length;

  return (
    <aside class="w-56 bg-bg-secondary border-r border-border flex flex-col flex-shrink-0">
      {/* Logo */}
      <div class="h-14 flex items-center px-4 border-b border-border">
        <img
          src="/icon.png"
          alt="MediaBender"
          class="w-7 h-7 rounded mr-3"
          draggable={false}
        />
        <span class="text-sm font-semibold text-text-primary">MediaBender</span>
      </div>

      {/* Navigation */}
      <nav class="flex-1 p-3 space-y-1">
        {navItems.map((item) => (
          <button
            onClick={() => setCurrentView(item.view)}
            class={`w-full flex items-center gap-3 px-3 py-2 rounded text-sm font-medium transition-colors ${
              currentView() === item.view
                ? "bg-gold/10 text-gold"
                : "text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
            }`}
          >
            <span class="text-base">{item.icon}</span>
            <span>{item.label}</span>
            {item.view === "dashboard" && fileCount() > 0 && (
              <span class="ml-auto text-xs bg-bg-tertiary text-text-muted px-1.5 py-0.5 rounded">
                {fileCount()}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div class="p-3 border-t border-border">
        <button type="button" onClick={props.onVersionClick}>
          <Show when={appVersion()}>
            <span class="text-xs text-text-muted">v{appVersion()}</span>
          </Show>
          <Show when={availableUpdateVersion()}>
            <span class="text-xs text-gold">
              {formatAvailableNote(availableUpdateVersion()!)}
            </span>
          </Show>
        </button>
      </div>
    </aside>
  );
}
