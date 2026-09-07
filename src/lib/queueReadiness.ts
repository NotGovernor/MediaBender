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
