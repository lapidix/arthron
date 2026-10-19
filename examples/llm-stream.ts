// Stream a chat completion from an OpenAI-compatible server (vLLM, Ollama's
// OpenAI endpoint, OpenAI itself) and print tokens as they arrive.
//
// Run: npx tsx examples/llm-stream.ts
import { arthron, retry, timeout } from "../src";

const api = arthron({
  baseURL: process.env.LLM_BASE_URL ?? "http://localhost:8000/v1",
  headers: process.env.LLM_API_KEY
    ? { authorization: `Bearer ${process.env.LLM_API_KEY}` }
    : {},
  // retry only covers the connection and the first bytes; once tokens flow a
  // retry would duplicate output, so keep it outside and let timeout bound
  // the whole stream.
  use: [retry({ methods: ["POST"], retryOn: [429, 503] }), timeout(120_000)],
});

type Chunk = { choices: { delta: { content?: string } }[] };

const stream = api
  .post("/chat/completions", {
    model: process.env.LLM_MODEL ?? "gpt-4o-mini",
    stream: true,
    messages: [{ role: "user", content: "Say hello in one sentence." }],
  })
  .sse();

for await (const { data } of stream) {
  if (data === "[DONE]") break; // OpenAI-style sentinel; arthron passes it through
  const chunk = JSON.parse(data) as Chunk;
  process.stdout.write(chunk.choices[0]?.delta.content ?? "");
}
process.stdout.write("\n");
