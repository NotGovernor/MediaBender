export function isQueueBlockingUpdate(files: { status: string }[]): boolean {
  return files.some((f) => f.status === "Processing");
}

export function shouldCheckOnLaunch(opts: {
  isDev: boolean;
  checkOnStartup: boolean;
}): boolean {
  return !opts.isDev && opts.checkOnStartup;
}

export function formatAvailableNote(version: string): string {
  const v = version.startsWith("v") ? version : `v${version}`;
  return `${v} available`;
}

export type UpdateInfo = { version: string; notes: string };

export async function runUpdateCheck(deps: {
  isDev: boolean;
  check: () => Promise<UpdateInfo | null>;
}): Promise<UpdateInfo | null> {
  if (deps.isDev) return null;
  try {
    return await deps.check();
  } catch {
    return null; // launch path treats errors as "no update"
  }
}
