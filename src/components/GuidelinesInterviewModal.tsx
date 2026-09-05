import { For, Show, createEffect, createSignal } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import Modal from "./Modal";
import type { ChatMessage, InterviewResponse } from "../types";
import { updateQueue, addLog } from "../stores/appStore";

interface GuidelinesInterviewModalProps {
  open: boolean;
  onClose: () => void;
}

export default function GuidelinesInterviewModal(props: GuidelinesInterviewModalProps) {
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [isComplete, setIsComplete] = createSignal(false);
  const [generatedGuidelines, setGeneratedGuidelines] = createSignal("");
  const [draft, setDraft] = createSignal("");

  let generation = 0;
  let prevOpen = false;
  let listEl: HTMLDivElement | undefined;

  async function requestInterview(history: ChatMessage[]) {
    generation += 1;
    const g = generation;
    setIsLoading(true);
    setError("");
    try {
      const res = await invoke<InterviewResponse>("interview_guidelines", {
        messages: history,
      });
      if (g !== generation) return;
      if (res.type === "message") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: res.content },
        ]);
      } else if (res.type === "complete") {
        setIsComplete(true);
        setGeneratedGuidelines(res.guidelines_markdown);
      }
    } catch (err) {
      if (g !== generation) return;
      setError(String(err));
    } finally {
      if (g === generation) setIsLoading(false);
    }
  }

  createEffect(() => {
    const open = props.open;
    if (open && !prevOpen) {
      setMessages([]);
      setIsLoading(false);
      setError("");
      setIsComplete(false);
      setGeneratedGuidelines("");
      setDraft("");
      generation += 1;
      void requestInterview([]);
    } else if (!open && prevOpen) {
      generation += 1;
    }
    prevOpen = open;
  });

  createEffect(() => {
    messages();
    isLoading();
    error();
    const el = listEl;
    if (el) el.scrollTop = el.scrollHeight;
  });

  function submit() {
    if (isLoading()) return;
    const text = draft().trim();
    if (!text) return;
    const next: ChatMessage[] = [...messages(), { role: "user", content: text }];
    setMessages(next);
    setDraft("");
    void requestInterview(next);
  }

  async function apply() {
    const guidelines = generatedGuidelines();
    updateQueue({ guidelines });
    try {
      await invoke("save_guidelines", { guidelines });
      addLog({
        timestamp: new Date().toISOString(),
        level: "info",
        message: "Guidelines updated",
      });
      props.onClose();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title="Guidelines Interview"
      maxWidth="max-w-3xl"
      bodyClass="flex-1 min-h-0 flex flex-col overflow-hidden p-0"
    >
      <Show
        when={isComplete()}
        fallback={
          <>
            <div
              class="flex-1 min-h-0 overflow-y-auto p-4 space-y-3"
              aria-label="Interview conversation"
              ref={(el) => {
                listEl = el;
              }}
            >
              <For each={messages()}>
                {(msg) => (
                  <div
                    class={msg.role === "user" ? "flex justify-end" : "flex justify-start"}
                  >
                    <div
                      class={`whitespace-pre-wrap text-sm rounded-lg px-3 py-2 max-w-[85%] ${
                        msg.role === "user" ? "bg-gold/10" : "bg-bg-tertiary"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                )}
              </For>
              <Show when={isLoading()}>
                <div role="status" aria-label="Assistant is typing" class="text-text-muted">
                  …
                </div>
              </Show>
              <Show when={error()}>
                <div class="text-danger text-sm whitespace-pre-wrap">{error()}</div>
              </Show>
            </div>
            <div class="border-t border-border p-3 flex gap-2">
              <input
                aria-label="Interview message"
                value={draft()}
                onInput={(e) => setDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                class="flex-1 bg-bg-tertiary border border-border rounded px-3 py-2 text-sm text-text-primary"
              />
              <button
                type="button"
                onClick={submit}
                disabled={isLoading() || !draft().trim()}
                class="bg-gold text-bg-primary px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </>
        }
      >
        <pre class="flex-1 min-h-0 overflow-auto p-4 text-sm font-mono text-text-primary whitespace-pre-wrap">
          {generatedGuidelines()}
        </pre>
        <Show when={error()}>
          <div class="text-danger text-sm whitespace-pre-wrap px-4 pb-2">{error()}</div>
        </Show>
        <div class="border-t border-border p-3 flex justify-end gap-3">
          <button
            type="button"
            onClick={() => props.onClose()}
            class="px-4 py-2 rounded text-sm font-medium bg-transparent text-gold border border-gold hover:bg-gold/10 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void apply()}
            class="px-4 py-2 rounded text-sm font-medium bg-gold text-bg-primary hover:bg-gold-light transition-colors"
          >
            Apply
          </button>
        </div>
      </Show>
    </Modal>
  );
}
