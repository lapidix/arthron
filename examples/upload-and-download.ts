// Multipart upload, binary download, and reading a filename from headers —
// the cases where you want the raw Response rather than a parsed body.
import { arthron, isArthronError } from "../src";

const api = arthron({ baseURL: "https://files.example.com" });

export async function upload(file: File, folder: string) {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", folder);
  // FormData is sent as-is; the runtime sets the multipart boundary.
  return api.post("/upload", form).json<{ id: string }>();
}

export async function download(id: string) {
  const res = await api.get(`/files/${id}`); // Response — nothing has been read yet
  const disposition = res.headers.get("content-disposition") ?? "";
  const name = /filename="?([^"]+)"?/.exec(disposition)?.[1] ?? id;
  return { name, blob: await res.blob() };
}

export async function exists(id: string) {
  try {
    await api.head(`/files/${id}`);
    return true;
  } catch (error) {
    if (isArthronError(error) && error.status === 404) return false;
    throw error;
  }
}
