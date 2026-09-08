export function clampMaxParallel(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(4, Math.max(1, Math.trunc(n)));
}
