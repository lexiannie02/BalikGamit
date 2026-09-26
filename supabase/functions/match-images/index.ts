import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const groqKey = Deno.env.get("GROQ_API_KEY");
  const model = Deno.env.get("GROQ_MODEL") || "qwen/qwen3.8-27b";
  if (!groqKey) return json({ error: "Image matching is not configured" }, 503);

  try {
    const body = await request.json();
    const lost = body?.lost || {};
    const reports = Array.isArray(body?.foundReports) ? body.foundReports.slice(0, 10) : [];
    const lostImageUrl = text(lost.image_url, 2000);
    const candidates = reports.filter((report: Record<string, unknown>) => text(report.image_url, 2000));
    if (!lostImageUrl || candidates.length === 0) return json({ matches: [], reason: "Both reports need photos for image comparison" });

    const imageParts = [
      { type: "text", text: `LOST ITEM PHOTO. Details: title=${text(lost.title, 120)}; category=${text(lost.category, 80)}; color=${text(lost.color, 50)}; description=${text(lost.description, 600)}` },
      { type: "image_url", image_url: { url: lostImageUrl } },
    ];
    for (const report of candidates) {
      imageParts.push({ type: "text", text: `FOUND ITEM PHOTO. report_id=${text(report.id, 80)}; title=${text(report.title, 120)}; category=${text(report.category, 80)}; color=${text(report.color, 50)}; description=${text(report.description, 600)}` } as never);
      imageParts.push({ type: "image_url", image_url: { url: text(report.image_url, 2000) } } as never);
    }
    imageParts.push({ type: "text", text: `Compare the lost photo with every found photo. Return JSON only in this exact shape: {"matches":[{"report_id":"string","score":0,"reasons":["short reason"]}]}.
Score visual similarity and item identity, not ownership certainty. Use 0-100. Include only scores of 35 or higher, sort highest first, and give at most 5 results. Mention matching shape, color, brand, pattern, or distinctive marks when visible. Never claim certainty.` } as never);

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 1200,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: imageParts }],
      }),
    });
    if (!response.ok) return json({ error: "Image matching provider unavailable" }, 502);

    const result = await response.json();
    const content = result?.choices?.[0]?.message?.content;
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    const allowed = new Set(candidates.map((report: Record<string, unknown>) => text(report.id, 80)));
    const matches = Array.isArray(parsed?.matches) ? parsed.matches
      .filter((match: Record<string, unknown>) => allowed.has(text(match.report_id, 80)))
      .map((match: Record<string, unknown>) => ({
        report_id: text(match.report_id, 80),
        score: Math.max(0, Math.min(100, Number(match.score) || 0)),
        reasons: Array.isArray(match.reasons) ? match.reasons.map((reason: unknown) => text(reason, 180)).filter(Boolean).slice(0, 3) : [],
      }))
      .filter((match: { score: number }) => match.score >= 35)
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
      .slice(0, 5) : [];
    return json({ matches });
  } catch (_error) {
    return json({ error: "Could not compare the item images" }, 400);
  }
});
