/**
 * Best-effort human-readable text for an unknown thrown value.
 *
 * Transport errors cross the Tauri/HTTP boundary as plain objects rather than
 * `Error` instances, so `e.message` alone misses them and `String(e)` degrades
 * to "[object Object]". Checking the shape the backend actually sends keeps the
 * real cause in front of the user.
 */
export function errorText(e: unknown): string {
  if (typeof e === "string") return e
  const obj = (e ?? {}) as Record<string, unknown>
  const parts = [obj.message, obj.detail, obj.code].filter(
    (p): p is string => typeof p === "string" && p.length > 0
  )
  return parts.length ? parts.join(" | ") : String(e ?? "")
}
