import { Show, type JSX } from "solid-js";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: JSX.Element;
  maxWidth?: string;
  cardClass?: string;
  zIndex?: string;
  bodyClass?: string;
}

export default function Modal(props: ModalProps) {
  return (
    <Show when={props.open}>
      <div class={`fixed inset-0 flex items-center justify-center ${props.zIndex ?? "z-50"}`}>
        {/* Backdrop */}
        <div
          class="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={props.onClose}
        />

        {/* Modal */}
        <div
          class={`relative bg-bg-secondary border rounded-xl shadow-2xl flex flex-col ${props.maxWidth ?? "max-w-2xl"} w-full mx-4 max-h-[85vh] ${props.cardClass ?? "border-border"}`}
        >
          {/* Header */}
          <div class="flex items-start justify-between px-6 py-4 border-b border-border">
            <div class="flex-1 min-w-0">
              <h2 class="text-base font-semibold text-text-primary">{props.title}</h2>
              <Show when={props.subtitle}>
                <p class="text-sm text-text-secondary mt-0.5">{props.subtitle}</p>
              </Show>
            </div>
            <button
              onClick={props.onClose}
              class="text-text-muted hover:text-text-primary transition-colors flex-shrink-0 ml-4 mt-0.5"
              aria-label="Close"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div class={props.bodyClass ?? "flex-1 overflow-y-auto p-6"}>{props.children}</div>
        </div>
      </div>
    </Show>
  );
}
