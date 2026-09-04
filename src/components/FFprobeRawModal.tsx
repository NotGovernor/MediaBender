import { Show } from "solid-js";
import Modal from "./Modal";
import {
  ffprobeRawModalOpen,
  selectedFile,
  setFfprobeRawModalOpen,
} from "../stores/appStore";

export default function FFprobeRawModal() {
  const file = selectedFile;

  const handleClose = () => {
    setFfprobeRawModalOpen(false);
  };

  const filename = () => file()?.input_path.split(/[/\\]/).pop() ?? "";
  const rawText = () => file()?.ffprobe_raw ?? "";

  return (
    <Modal
      open={ffprobeRawModalOpen()}
      onClose={handleClose}
      title={`ffprobe Raw: ${filename()}`}
      maxWidth="max-w-4xl"
      zIndex="z-[60]"
    >
      <Show
        when={rawText()}
        fallback={
          <p class="text-sm text-text-muted">
            No ffprobe raw data available for this file.
          </p>
        }
      >
        <pre class="w-full h-[60vh] bg-bg-primary text-gold font-mono text-xs p-4 rounded overflow-auto whitespace-pre-wrap break-all">
          {rawText()}
        </pre>
      </Show>
    </Modal>
  );
}
