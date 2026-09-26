import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Report service is not configured" }, 503);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await supabase.from("reports")
    .select("id, kind, title, category, color, location, report_date, description, visual_type, visual_label, image_path, status, display_name, created_at, finder_secret_hash")
    .eq("kind", "found")
    .eq("status", "Active")
    .order("created_at", { ascending: false })
    .limit(100);

  if (result.error) return json({ error: "Could not load shared reports" }, 502);

  const reports = await Promise.all((result.data || []).map(async (report) => {
    let imageUrl: string | null = null;
    if (report.image_path) {
      const signed = await supabase.storage.from("report-images").createSignedUrl(report.image_path, 3600);
      imageUrl = signed.data?.signedUrl || null;
    }
    const { finder_secret_hash, ...publicReport } = report;
    return { ...publicReport, image_url: imageUrl, claim_enabled: Boolean(finder_secret_hash) };
  }));

  return json({ reports });
});
