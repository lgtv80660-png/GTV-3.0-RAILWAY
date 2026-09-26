export function channelLogoUrl(
  name: string,
  fallback?: string | null
) {
  const params = new URLSearchParams();
  params.set("name", name);
  if (fallback) params.set("fallback", fallback);
  return `/api/channel-logo?${params.toString()}`;
}
