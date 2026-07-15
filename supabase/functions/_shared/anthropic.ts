// Anthropic Messages API wrapper + ai_runs audit logging.
// Every prompt is instructed to cite only provided data, invent no numbers, and
// return the exact requested JSON — enforced via the shared system preamble.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWithRetry } from "./http.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export const GROUNDING_PREAMBLE =
  "You are an assistant inside an internal Customer Success platform. " +
  "Strict rules: cite ONLY the data provided in the prompt; never invent numbers, " +
  "names, dates, or facts; if a datapoint is missing say so rather than guessing; " +
  "and when a JSON schema is requested you MUST return exactly that JSON with no " +
  "prose, no markdown fences, and no extra keys.";

export type ModelChoice = "reasoning" | "fast" | string;

function resolveModel(model?: ModelChoice): string {
  if (!model || model === "reasoning") return Deno.env.get("AI_MODEL_REASONING") ?? "claude-sonnet-4-6";
  if (model === "fast") return Deno.env.get("AI_MODEL_FAST") ?? "claude-haiku-4-5";
  return model; // explicit model id
}

export interface AiMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CallAiArgs {
  system?: string;
  messages: AiMessage[];
  model?: ModelChoice;
  maxTokens?: number;
  temperature?: number;
}

export interface AiResult {
  text: string;
  model: string;
  raw: unknown;
}

export async function callAI(args: CallAiArgs): Promise<AiResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
  const model = resolveModel(args.model);
  const system = [GROUNDING_PREAMBLE, args.system?.trim()].filter(Boolean).join("\n\n");

  const res = await fetchWithRetry(
    ANTHROPIC_URL,
    {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: args.maxTokens ?? 1024,
        temperature: args.temperature ?? 0.2,
        system,
        messages: args.messages,
      }),
    },
    { retries: 4 },
  );

  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Anthropic ${res.status}: ${JSON.stringify(body).slice(0, 500)}`);
  }
  const text: string = (body.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("")
    .trim();
  return { text, model, raw: body };
}

// Robust JSON extraction — tolerates stray fences/prose despite the preamble.
export function parseJsonLoose<T = unknown>(text: string): T {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const first = t.indexOf("{");
  const firstArr = t.indexOf("[");
  const start = firstArr !== -1 && (firstArr < first || first === -1) ? firstArr : first;
  if (start > 0) t = t.slice(start);
  const lastObj = t.lastIndexOf("}");
  const lastArr = t.lastIndexOf("]");
  const end = Math.max(lastObj, lastArr);
  if (end !== -1) t = t.slice(0, end + 1);
  return JSON.parse(t) as T;
}

// Ask for JSON and parse it, retrying once with a stricter reminder on failure.
export async function callAIJson<T = unknown>(args: CallAiArgs): Promise<{ data: T; result: AiResult }> {
  const result = await callAI(args);
  try {
    return { data: parseJsonLoose<T>(result.text), result };
  } catch {
    const retry = await callAI({
      ...args,
      messages: [
        ...args.messages,
        { role: "assistant", content: result.text },
        { role: "user", content: "That was not valid JSON. Return ONLY the requested JSON object, nothing else." },
      ],
    });
    return { data: parseJsonLoose<T>(retry.text), result: retry };
  }
}

export interface AiRunLog {
  kind: string;
  companyId?: string | null;
  dealId?: string | null;
  model: string;
  inputSummary: string;
  output: unknown;
  appliedChanges?: unknown;
  createdBy?: string;
}

export async function logAiRun(supabase: SupabaseClient, run: AiRunLog): Promise<void> {
  const { error } = await supabase.from("ai_runs").insert({
    kind: run.kind,
    company_id: run.companyId ?? null,
    deal_id: run.dealId ?? null,
    model: run.model,
    input_summary: run.inputSummary,
    output: run.output ?? {},
    applied_changes: run.appliedChanges ?? null,
    created_by: run.createdBy ?? "system",
  });
  if (error) console.error("logAiRun failed:", error.message);
}
