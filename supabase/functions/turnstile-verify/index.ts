const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) {
    return new Response(JSON.stringify({ success: false, error: "Verification is not configured" }), {
      status: 503,
      headers: corsHeaders,
    });
  }

  try {
    const body = await request.json();
    const token = typeof body?.token === "string" ? body.token.trim() : "";

    if (!token || token.length > 4096) {
      return new Response(JSON.stringify({ success: false, error: "Missing or invalid token" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const form = new FormData();
    form.append("secret", secret);
    form.append("response", token);

    const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });

    if (!verification.ok) {
      return new Response(JSON.stringify({ success: false, error: "Verification provider unavailable" }), {
        status: 502,
        headers: corsHeaders,
      });
    }

    const result = await verification.json();
    return new Response(JSON.stringify({
      success: result.success === true,
      errors: Array.isArray(result["error-codes"]) ? result["error-codes"] : [],
    }), {
      status: result.success === true ? 200 : 400,
      headers: corsHeaders,
    });
  } catch (_error) {
    return new Response(JSON.stringify({ success: false, error: "Invalid verification request" }), {
      status: 400,
      headers: corsHeaders,
    });
  }
});
