/**
 * Optional AI. Off by default (AI_PROVIDER=none): every feature in the
 * dashboard works without it. When on, it is only used for things you click
 * (summarize this announcement, help parse a messy syllabus), and only the
 * text being processed is sent, never your whole database.
 */
import { AnthropicProvider } from "./anthropic.js";
import { OpenAICompatProvider } from "./openai-compat.js";

export interface AiProvider {
  readonly name: string;
  summarize(text: string, opts?: { maxWords?: number }): Promise<string>;
  /** Ask for JSON matching a description; caller validates the result. */
  extractJson(instructions: string, text: string): Promise<unknown>;
}

export class NoAi implements AiProvider {
  readonly name = "none";
  async summarize(): Promise<string> {
    throw new Error("AI is turned off (AI_PROVIDER=none).");
  }
  async extractJson(): Promise<unknown> {
    throw new Error("AI is turned off (AI_PROVIDER=none).");
  }
}

export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): AiProvider {
  switch (env.AI_PROVIDER ?? "none") {
    case "anthropic":
      return new AnthropicProvider(env.ANTHROPIC_MODEL || "claude-opus-5-5");
    case "openai-compatible":
      return new OpenAICompatProvider(
        env.OPENAI_COMPAT_BASE_URL || "http://127.0.0.1:11434/v1",
        env.OPENAI_COMPAT_MODEL || "llama3.1",
        env.OPENAI_COMPAT_API_KEY,
      );
    default:
      return new NoAi();
  }
}

export { AnthropicProvider, OpenAICompatProvider };
