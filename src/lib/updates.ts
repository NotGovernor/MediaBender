export function isQueueBlockingUpdate(
  files: { status: string }[],
  scheduledIds: readonly string[] = [],
): boolean {
  return scheduledIds.length > 0 || files.some((f) => f.status === "Processing");
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

export type UpdateCheckPhase = "idle" | "checking" | "current" | "skipped_dev" | "error";

export function canStartUpdateCheck(phase: UpdateCheckPhase): boolean {
  return phase !== "checking";
}

export function outcomeAfterCheck(opts: {
  isDev: boolean;
  silent: boolean;
  errorMessage: string | null;
  foundVersion: string | null;
}): {
  phase: UpdateCheckPhase;
  errorMessage: string;
  availableVersion: string | null;
  openDialog: boolean;
  skipNetwork: boolean;
} {
  if (opts.isDev) {
    if (opts.silent) {
      return {
        phase: "idle",
        errorMessage: "",
        availableVersion: null,
        openDialog: false,
        skipNetwork: true,
      };
    }
    return {
      phase: "skipped_dev",
      errorMessage: "",
      availableVersion: null,
      openDialog: false,
      skipNetwork: true,
    };
  }
  if (opts.errorMessage) {
    if (opts.silent) {
      return {
        phase: "idle",
        errorMessage: "",
        availableVersion: null,
        openDialog: false,
        skipNetwork: false,
      };
    }
    return {
      phase: "error",
      errorMessage: opts.errorMessage,
      availableVersion: null,
      openDialog: false,
      skipNetwork: false,
    };
  }
  if (opts.foundVersion) {
    return {
      phase: "idle",
      errorMessage: "",
      availableVersion: opts.foundVersion,
      openDialog: !opts.silent,
      skipNetwork: false,
    };
  }
  return {
    phase: "current",
    errorMessage: "",
    availableVersion: null,
    openDialog: false,
    skipNetwork: false,
  };
}
