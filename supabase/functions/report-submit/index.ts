import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

async function verifyTurnstile(token: string) {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) return false;

  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  if (!response.ok) return false;
  const result = await response.json();
  return result.success === true;
}

function clean(value: FormDataEntryValue | null, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const form = await request.formData();
    const token = clean(form.get("turnstileToken"), 4096);
    if (!(await verifyTurnstile(token))) return json({ error: "Security check failed" }, 400);

    const kind = clean(form.get("kind"), 10);
    const description = clean(form.get("description"), 1200);
    const title = clean(form.get("title"), 120) || (kind === "lost" ? description.slice(0, 120) : "");
    const category = clean(form.get("category"), 80);
    const color = clean(form.get("color"), 50);
    const location = clean(form.get("location"), 160);
    const reportDate = clean(form.get("date"), 10) || (kind === "lost" ? new Date().toISOString().slice(0, 10) : "");
    const visualType = clean(form.get("type"), 30) || "box";
    const visualLabel = clean(form.get("visualLabel"), 80);
    const displayName = clean(form.get("displayName"), 80) || "Anonymous helper";

    if (!['lost', 'found'].includes(kind) || !title || !description || (kind === "found" && (!category || !color || !location || !reportDate))) {
      return json({ error: "Please complete the required report details" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) return json({ error: "Report service is not configured" }, 503);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let imagePath: string | null = null;
    const image = form.get("photo");
    if (image instanceof File && image.size > 0) {
      if (!image.type.startsWith("image/") || image.size > 8 * 1024 * 1024) {
        return json({ error: "Images must be under 8MB" }, 400);
      }

      const extension = (image.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      imagePath = `${kind}/${crypto.randomUUID()}.${extension}`;
      const upload = await supabase.storage.from("report-images").upload(imagePath, image, {
        contentType: image.type,
        upsert: false,
      });
      if (upload.error) return json({ error: "Could not store the report image" }, 502);
    }

    const insert = await supabase.from("reports").insert({
      kind,
      title,
      category: category || "Other",
      color,
      location,
      report_date: reportDate,
      description,
      visual_type: visualType,
      visual_label: visualLabel || null,
      image_path: imagePath,
      display_name: displayName,
    }).select("id, kind, title, category, color, location, report_date, description, visual_type, visual_label, image_path, status, display_name, created_at").single();

    if (insert.error) {
      if (imagePath) await supabase.storage.from("report-images").remove([imagePath]);
      return json({ error: "Could not save the report" }, 502);
    }

    let imageUrl: string | null = null;
    if (imagePath) {
      const signed = await supabase.storage.from("report-images").createSignedUrl(imagePath, 3600);
      imageUrl = signed.data?.signedUrl || null;
    }

    return json({ report: { ...insert.data, image_url: imageUrl } }, 201);
  } catch (_error) {
    return json({ error: "Invalid report request" }, 400);
  }
});
