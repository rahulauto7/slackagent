export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(dayIso: string, n: number): string {
  const d = new Date(`${dayIso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localDay(d);
}
