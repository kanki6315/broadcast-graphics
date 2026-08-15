export async function timingJson<T>(path: string): Promise<T> {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  const response = await fetch(path, {
    headers: token?.startsWith("bg_comms_") ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Timing history could not be loaded.");
  return body;
}
