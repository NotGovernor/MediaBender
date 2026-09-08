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
