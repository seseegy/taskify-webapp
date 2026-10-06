export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '–';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString('id-ID', { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`;
}
