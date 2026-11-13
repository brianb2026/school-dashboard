import { extractDates, type ParsedDate } from "./dates.js";
import { extractPolicies, type ParsedPolicies } from "./policies.js";
import { extractText } from "./extract-text.js";
import { extractWeights, type WeightsResult } from "./weights.js";

export * from "./dates.js";
export * from "./policies.js";
export * from "./weights.js";
export { extractText };

export interface SyllabusParse {
  text: string;
  weights: WeightsResult;
  dates: ParsedDate[];
  policies: ParsedPolicies;
  /** True when the rules found nothing useful; the UI may offer the optional AI pass. */
  needsHelp: boolean;
}

/**
 * Rule-based syllabus parse. No network, no AI. The optional AI pass
 * (@sd/ai) is only offered, never run automatically, when `needsHelp` is true.
 */
export async function parseSyllabus(
  bytes: Uint8Array,
  filename: string,
  termStart: string,
): Promise<SyllabusParse> {
  const text = await extractText(bytes, filename);
  return parseSyllabusText(text, termStart);
}

export function parseSyllabusText(text: string, termStart: string): SyllabusParse {
  const weights = extractWeights(text);
  const dates = extractDates(text, termStart);
  const policies = extractPolicies(text);
  return { text, weights, dates, policies, needsHelp: !weights.confident && dates.length === 0 };
}
