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

  it("uses a fresh boundary each time", () => {
    expect(encodeFormData(new FormData()).type).not.toBe(
      encodeFormData(new FormData()).type,
    );
  });
});
