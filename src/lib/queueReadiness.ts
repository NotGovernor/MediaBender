import type { FileStatus } from "../types";

export type DisplayFileStatus = FileStatus | "Approved";

export function displayFileStatus(
  status: FileStatus,
  isApproved: boolean,
): DisplayFileStatus {
  if (status === "Pending" && isApproved) return "Approved";
  return status;
}

export function isStartEligible(file: {
  is_approved: boolean;
  status: FileStatus;
}): boolean {
  return file.is_approved && file.status === "Pending";
}

export function isAddable(
  file: { id: string; is_approved: boolean; status: FileStatus },
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
