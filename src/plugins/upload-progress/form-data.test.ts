import { describe, expect, it } from "vitest";
import { encodeFormData } from "./form-data";

const bytesOf = async (stream: ReadableStream<Uint8Array>) =>
  new Uint8Array(await new Response(stream).arrayBuffer());

describe("encodeFormData", () => {
  const form = () => {
    const f = new FormData();
    f.append("name", "김민기");
    f.append("note", 'say "hi"\r\nbye');
    f.append(
      "file",
      new File([new Uint8Array(70_000).fill(1)], 'a b".bin', {
        type: "application/x-test",
      }),
    );
    f.append("blob", new Blob(["xyz"]));
    return f;
  };

  it("knows its length before sending", async () => {
    const { stream, total } = encodeFormData(form());
    expect((await bytesOf(stream)).byteLength).toBe(total);
  });

  it("round-trips through the runtime's multipart parser", async () => {
    const { stream, type } = encodeFormData(form());
    const parsed = await new Response(await bytesOf(stream), {
      headers: { "content-type": type },
    }).formData();
    expect(parsed.get("name")).toBe("김민기");
    expect(parsed.get("note")).toBe('say "hi"\r\nbye');
    const file = parsed.get("file") as File;
    expect([file.name, file.type, file.size]).toEqual([
      'a b".bin',
      "application/x-test",
      70_000,
    ]);
    const blob = parsed.get("blob") as File;
    expect([blob.name, await blob.text()]).toEqual(["blob", "xyz"]);
  });

  it("writes names and filenames as the runtime's encoder does", async () => {
    const f = new FormData();
    f.append('a\nb\rc\r\nd"e', "v");
    f.append("file", new File(["x"], 'n\na\rm\r\ne".txt'));
    // Each with its own boundary; the runtime's may end without a final CRLF.
    const text = async (body: BodyInit, type: string) =>
      (await new Response(body).text())
        .replaceAll(type.split("boundary=")[1] as string, "BOUNDARY")
        .replace(/\r\n$/, "");
    const ours = encodeFormData(f);
    const runtime = new Request("https://a", { method: "POST", body: f });
    expect(await text(ours.stream, ours.type)).toBe(
      await text(
        await runtime.arrayBuffer(),
        runtime.headers.get("content-type") as string,
      ),
    );
  });

  it("uses a fresh boundary each time", () => {
    expect(encodeFormData(new FormData()).type).not.toBe(
      encodeFormData(new FormData()).type,
    );
  });
});
