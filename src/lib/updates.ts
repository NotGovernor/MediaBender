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
