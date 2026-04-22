import OpenAI from "openai";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  client = new OpenAI({ apiKey });
  return client;
}

export async function embedQuery(
  text: string,
  model: string,
): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("embedQuery: text must be non-empty");
  const resp = await getClient().embeddings.create({
    model,
    input: trimmed,
  });
  const first = resp.data[0]?.embedding;
  if (!first || first.length === 0) {
    throw new Error("embedQuery: OpenAI returned no embedding");
  }
  return first;
}

export function __resetOpenAIForTest() {
  client = null;
}
