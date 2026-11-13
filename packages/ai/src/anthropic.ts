import Anthropic from "@anthropic-ai/sdk";
import type { AiProvider } from "./index.js";

/** Claude via the official SDK. Reads ANTHROPIC_API_KEY from the environment. */
export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private client = new Anthropic();

  constructor(private model: string) {}

  private async ask(system: string, text: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      output_config: { effort: "low" },
      system,
      messages: [{ role: "user", content: text }],
    });
    if (response.stop_reason === "refusal") throw new Error("The model declined this request.");
    return response.content
      .flatMap((b) => (b.type === "text" ? [b.text] : []))
      .join("")
      .trim();
  }

  summarize(text: string, opts: { maxWords?: number } = {}): Promise<string> {
    return this.ask(
      `Summarize this school announcement or email for a student in at most ${opts.maxWords ?? 60} words. ` +
        "Lead with anything the student must do and its deadline. Plain text, no preamble.",
      text,
    );
  }

  async extractJson(instructions: string, text: string): Promise<unknown> {
    const out = await this.ask(`${instructions}\nReply with JSON only.`, text);
    return JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  }
}
