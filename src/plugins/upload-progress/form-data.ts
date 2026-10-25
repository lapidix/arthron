const encoder = new TextEncoder();

/** Names and filenames inside the quoted Content-Disposition parameters. */
const escapeName = (name: string): string =>
  name.replace(/\n/g, "%0A").replace(/\r/g, "%0D").replace(/"/g, "%22");

/** String values go out with CRLF line breaks, as the runtime's encoder sends them. */
const normalizeBreaks = (value: string): string =>
  value.replace(/\r\n|\r|\n/g, "\r\n");

function boundary(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `----arthron${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

type Part = Uint8Array | Blob;

/**
 * A FormData body as multipart/form-data, with its length known before
 * anything is read: the parts' headers and string values are encoded up
 * front, files are only counted by size and streamed while the body is
 * sent — a large file is not held in memory to learn the length.
 */
export function encodeFormData(form: FormData): {
  stream: ReadableStream<Uint8Array>;
  total: number;
  type: string;
} {
  const b = boundary();
  const parts: Part[] = [];
  for (const [name, value] of form) {
    // A name's line breaks become CRLF before escaping, as in the runtime's
    // encoder; a filename is only escaped.
    let head = `--${b}\r\nContent-Disposition: form-data; name="${escapeName(normalizeBreaks(name))}"`;
    if (typeof value === "string") {
      parts.push(encoder.encode(`${head}\r\n\r\n`));
      parts.push(encoder.encode(normalizeBreaks(value)));
    } else {
      head += `; filename="${escapeName(value.name)}"\r\nContent-Type: ${value.type || "application/octet-stream"}`;
      parts.push(encoder.encode(`${head}\r\n\r\n`));
      parts.push(value);
    }
    parts.push(encoder.encode("\r\n"));
  }
  parts.push(encoder.encode(`--${b}--\r\n`));

  const total = parts.reduce(
    (sum, part) =>
      sum + (part instanceof Uint8Array ? part.byteLength : part.size),
    0,
  );
  let index = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        for (;;) {
          if (reader) {
            const { value, done } = await reader.read();
            if (!done) return controller.enqueue(value);
            reader = undefined;
          }
          const part = parts[index++];
          if (part === undefined) return controller.close();
          if (part instanceof Uint8Array) return controller.enqueue(part);
          reader = part.stream().getReader();
        }
      },
      cancel: (reason) => reader?.cancel(reason),
    },
    { highWaterMark: 0 },
  );
  return { stream, total, type: `multipart/form-data; boundary=${b}` };
}
