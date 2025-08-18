// Zentrale Formatierungs-Utils für das Frontend (TypeScript-Version)
export function formatJaNein(val: boolean, t: (key: string) => string): string {
  if (typeof val !== 'boolean') return String(val);
  return val ? t('common:yes') : t('common:no');
}
