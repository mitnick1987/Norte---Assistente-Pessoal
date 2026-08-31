export function diskUsagePercent(totalBytes: number, freeBytes: number): number {
  if (totalBytes <= 0) return 0;
  return ((totalBytes - freeBytes) / totalBytes) * 100;
}

export function diskUsageExceeded(usagePercent: number, thresholdPercent: number): boolean {
  return usagePercent > thresholdPercent;
}
