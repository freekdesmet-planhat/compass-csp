// news-refresh — authenticated, on-demand. POST { companyId }. Uses the Anthropic
// web_search tool to fetch 3 recent, business-relevant developments about the
// account and writes them back to companies.latest_news / _at / _sources.
// callAI (_shared/anthropic.ts) doesn't expose a `tools` param, so this hits the
// Messages API directly (per the tool spec) while reusing parseJsonLoose + logAiRun.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient, userClient, json } from "../_shared/supabase.ts";
import { logAiRun, parseJsonLoose } from "../_shared/anthropic.ts";
import { fetchWithRetry } from "../_shared/http.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

interface NewsBullet { text: string; url: string }
interface NewsPayload { bullets: NewsBullet[]; as_of: string }

serve(async (req) => {
  const authHeader = req.headers.get("Authorization") ?? "";
  const asUser = userClient(authHeader);
  const { data: auth } = await asUser.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

  const { companyId } = await req.json();
  if (!companyId) return json({ error: "companyId required" }, 400);

  // Verify the caller can see the company (RLS via user client).
  const { data: company } = await asUser.from("companies").select("id, name, website").eq("id", companyId).maybeSingle();
  if (!company) return json({ error: "forbidden" }, 403);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "missing_api_key" }, 500);
  const model = Deno.env.get("AI_MODEL_REASONING") ?? "claude-sonnet-4-6";
  const supabase = serviceClient();

  const prompt =
    `Find 3 recent, business-relevant developments about ${company.name} ` +
    `(${company.website ?? "website unknown"}), ≤120 words total, each bullet with its source URL. ` +
    `Return strict JSON with shape {"bullets":[{"text":string,"url":string}],"as_of":string}. ` +
    `No prose, no markdown fences, no extra keys.`;

  const res = await fetchWithRetry(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
    }),
  }, { retries: 3 });

  const body = await res.json();
  if (!res.ok) return json({ error: `anthropic_${res.status}`, detail: JSON.stringify(body).slice(0, 300) }, 502);

  // The model's answer is in the final text block(s); tool_use / web_search_tool_result
  // blocks are intermediate and ignored here.
  const text: string = (body.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("")
    .trim();

  let parsed: NewsPayload;
  try {
    parsed = parseJsonLoose<NewsPayload>(text);
  } catch {
    return json({ error: "parse_failed", raw: text.slice(0, 500) }, 502);
  }

  const bullets = Array.isArray(parsed.bullets) ? parsed.bullets : [];
  const latest_news = bullets.map((b) => `• ${b.text}`).join("\n");
  const latest_news_sources = bullets.map((b) => ({ title: b.text, url: b.url }));
  const latest_news_at = new Date().toISOString();

  await supabase.from("companies").update({
    latest_news,
    latest_news_at,
    latest_news_sources,
  }).eq("id", companyId);

  await logAiRun(supabase, {
    kind: "news_refresh",
    companyId,
    model,
    inputSummary: company.name,
    output: parsed,
    createdBy: auth.user.id,
  });

  return json({ latest_news, latest_news_sources, latest_news_at });
});
