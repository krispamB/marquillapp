const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

export function normalizeAppUrl(raw?: string): string {
  const value = raw?.trim();
  if (!value) {
    return '#';
  }

  const hasProtocol = /^https?:\/\//i.test(value);
  const withProtocol = hasProtocol
    ? value
    : `${LOCAL_HOSTNAMES.has(value.split('/')[0].split(':')[0].toLowerCase()) ? 'http' : 'https'}://${value}`;

  try {
    return new URL(withProtocol).toString();
  } catch {
    return '#';
  }
}
