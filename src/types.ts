export type FileStatus =
  | "Pending"
  | "Generating"
  | "Processing"
  | "Completed"
  | "Error"
  | "Skipped";

export interface AudioStream {
  index: number;
  codec: string;
  channels: number;
  layout: string;
  language?: string;
  title?: string;
}

export interface VideoMetadata {
  codec: string;
  width: number;
  height: number;
  hdr: boolean;
  bit_depth: number;
  fps: number;
}

export interface SubtitleStream {
  index: number;
  codec: string;
  language?: string;
  title?: string;
}

export interface FileMetadata {
  container: string;
  video: VideoMetadata;
  audio_streams: AudioStream[];
  subtitle_streams: SubtitleStream[];
  subtitle_count: number;
  has_chapters: boolean;
  duration: number;
  bitrate: number;
}

export interface VideoFile {
  id: string;
  input_path: string;
  output_path: string;
  scan_root: string;
  ffprobe_raw: string;
  metadata: FileMetadata | null;
  generated_command: string;
  command_args: string;
  description: string;
  reasoning: string;
  status: FileStatus;
  is_approved: boolean;
  error_message: string;
  created_at: string;
  updated_at: string;
  input_size: number;
  output_size: number;
  processing_duration: number;
  completed_at: string;
}

export interface WorkQueue {
  output_folder: string;
  guidelines: string;
  files: VideoFile[];
  created_at: string;
  last_modified: string;
}

export interface AddPathsResult {
  queue: WorkQueue;
  added: number;
  skipped_non_video: number;
  skipped_duplicates: number;
}

export interface AIProviderConfig {
  base_url: string;
  api_key: string;
  model: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type InterviewResponse =
  | { type: "message"; content: string }
  | { type: "complete"; guidelines_markdown: string };

export interface AppSettings {
  providers: AIProviderConfig[];
  active_provider_index: number;
  ffmpeg_path: string;
  ffprobe_path: string;
  default_output_folder: string;
  naming_template: string;
  max_parallel: number;
  check_updates_on_startup: boolean;
  flatten_output_folders: boolean;
}

export type View = "dashboard" | "settings" | "guidelines";

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  file_id?: string;
}
