import type { AiProvider } from "./index.js";

/**
 * Any OpenAI-compatible chat endpoint. The default points at a local Ollama
 * server, so nothing leaves your Mac.
 */
export class OpenAICompatProvider implements AiProvider {
  readonly name = "openai-compatible";

  constructor(
    private baseUrl: string,
    private model: string,
    private apiKey?: string,
  ) {}

  private async ask(system: string, text: string): Promise<string> {
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: text },
        ],
      }),
    });
    if (!res.ok) throw new Error(`AI provider error ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  }

  summarize(text: string, opts: { maxWords?: number } = {}): Promise<string> {
    return this.ask(
      `Summarize this for a student in at most ${opts.maxWords ?? 60} words. Lead with action items and deadlines.`,
      text,
    );
  }

  async extractJson(instructions: string, text: string): Promise<unknown> {
    const out = await this.ask(`${instructions}\nReply with JSON only.`, text);
    return JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  }
}
