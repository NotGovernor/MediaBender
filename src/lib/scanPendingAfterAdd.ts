import { requestScanPending } from "./autoScanner";

export { requestScanPending };

export async function scanPendingAfterAdd(): Promise<void> {
  return requestScanPending({ logIfEmpty: false });
}
