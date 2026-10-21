import type { UploadProgressEvent } from "../../types/request.types";

/** An empty body is complete at once, not `0 / 0`. */
export function progressEvent(
  loaded: number,
  total: number | undefined,
): UploadProgressEvent {
  const fraction =
    total === undefined ? undefined : total === 0 ? 1 : loaded / total;
  return { loaded, total, fraction };
}
