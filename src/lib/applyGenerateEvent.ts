import type { VideoFile } from "../types";
import { updateFile, removeGeneratingId } from "../stores/appStore";

export function applyGenerateEvent(file: VideoFile) {
  updateFile(file.id, file);
  removeGeneratingId(file.id);
}
