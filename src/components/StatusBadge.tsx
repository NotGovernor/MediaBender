import type { FileStatus } from "../types";

const statusConfig: Record<
  FileStatus,
  { label: string; bg: string; text: string }
> = {
  Pending: { label: "Pending", bg: "bg-status-pending/20", text: "text-status-pending" },
  Generating: { label: "Generating", bg: "bg-status-generating/20", text: "text-status-generating" },
  Processing: { label: "Processing", bg: "bg-status-processing/20", text: "text-status-processing" },
  Completed: { label: "Completed", bg: "bg-status-completed/20", text: "text-status-completed" },
  Error: { label: "Error", bg: "bg-status-error/20", text: "text-status-error" },
  Skipped: { label: "Skipped", bg: "bg-status-skipped/20", text: "text-status-skipped" },
};

export default function StatusBadge(props: { status: FileStatus }) {
  const config = () => statusConfig[props.status];
  return (
    <span
      class={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${config().bg} ${config().text}`}
    >
      {props.status === "Processing" || props.status === "Generating" ? (
        <svg
          class="w-3 h-3 mr-1 animate-spin"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            class="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-width="4"
          />
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ) : null}
      {config().label}
    </span>
  );
}
