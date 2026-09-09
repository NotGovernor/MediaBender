import type { FileStatus } from "../types";

export type DisplayFileStatus = FileStatus | "Approved" | "Scanning";
export type OverlayStatus = FileStatus | "Scanning";

export function rowOverlayStatus(
  file: { id: string; status: FileStatus; metadata: unknown; is_approved?: boolean },
  generatingIds: readonly string[],
  scanning: boolean,
): OverlayStatus {
  if (generatingIds.includes(file.id)) return "Generating";
  if (scanning && file.status === "Pending" && !file.metadata) return "Scanning";
  return file.status;
}

export function displayFileStatus(
  status: FileStatus | "Scanning",
  isApproved: boolean,
): DisplayFileStatus {
  if (status === "Scanning") return "Scanning";
  if (status === "Pending" && isApproved) return "Approved";
  return status;
}

export function isStartEligible(file: {
  is_approved: boolean;
  status: FileStatus;
  command_args: string;
}): boolean {
  return file.is_approved && file.status === "Pending" && file.command_args.trim() !== "";
}

export function isAddable(
  file: { id: string; is_approved: boolean; status: FileStatus; command_args: string },
  scheduledIds: readonly string[],
): boolean {
  return isStartEligible(file) && !scheduledIds.includes(file.id);
}

export function isFrozen(
  file: { id: string; status: FileStatus },
  scheduledIds: readonly string[],
): boolean {
  return file.status === "Processing" || scheduledIds.includes(file.id);
}

export function isApprovable(
  file: {
    id: string;
    generated_command: string;
    is_approved: boolean;
    status: FileStatus;
  },
  scheduledIds: readonly string[],
): boolean {
  if (file.generated_command === "" || file.is_approved) return false;
  if (file.status === "Completed" || file.status === "Skipped") return false;
  return !isFrozen(file, scheduledIds);
}

export function isGenerateTarget(
  file: {
    id: string;
    status: FileStatus;
    metadata: unknown;
    generated_command: string;
  },
  scheduledIds: readonly string[],
): boolean {
  if (!file.metadata || file.generated_command) return false;
  return !isFrozen(file, scheduledIds);
}
