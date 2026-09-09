import type { VideoFile } from "../types";
import { updateFile } from "../stores/appStore";

export function applyProbeEvent(file: VideoFile) {
  updateFile(file.id, file);
}
