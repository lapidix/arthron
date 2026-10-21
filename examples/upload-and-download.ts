// Multipart upload, binary download, and reading a filename from headers —
// the cases where you want the raw Response rather than a parsed body.
import { arthron } from "../src";

const api = arthron({ baseURL: "https://files.example.com" });

export async function upload(file: File, folder: string) {
  const form = new FormData();
  form.append("file", file);
  form.append("folder", folder);
  // FormData is sent as-is; the runtime sets the multipart boundary.
  return api.post("/upload", form).json<{ id: string }>();
}

export async function download(id: string) {
  // `pathParams` encodes `id` into one segment — a hostile id cannot reach other paths.
  const response = await api.get("/files/{id}", { pathParams: { id } }); // Response — nothing has been read yet
  const disposition = response.headers.get("content-disposition") ?? "";
  const name = /filename="?([^"]+)"?/.exec(disposition)?.[1] ?? id;
  return { name, blob: await response.blob() };
}

export async function exists(id: string) {
  // A 404 is the answer here, not a failure: throwOn hands it back as a Response.
  const response = await api.head("/files/{id}", {
    pathParams: { id },
    throwOn: (response) => response.status !== 404,
  });
  return response.ok;
}
