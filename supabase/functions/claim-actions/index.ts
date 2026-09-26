import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value);
const token = (value: unknown) => typeof value === "string" && /^[0-9a-f-]{64,}$/i.test(value);
const contactMethods = new Set(["Facebook", "Messenger", "Email", "Phone", "Other"]);

async function hashToken(value: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "Claim service is not configured" }, 503);
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const body = await request.json();
    if (body.action === "submit") {
      const reportId = body.reportId;
      const proof = typeof body.proof === "string" ? body.proof.trim() : "";
      const claimantName = typeof body.claimantName === "string" ? body.claimantName.trim().slice(0, 80) : "";
      if (!uuid(reportId) || !proof || proof.length > 1200) return json({ error: "Enter ownership proof for a valid found item" }, 400);
      const { data: report } = await db.from("reports").select("id,kind,status,finder_secret_hash,title").eq("id", reportId).maybeSingle();
      if (!report || report.kind !== "found" || report.status !== "Active") return json({ error: "This found item is no longer available" }, 404);
      if (!report.finder_secret_hash) return json({ error: "This older report cannot receive secure claims. Ask the finder to post it again." }, 409);
      const claimantToken = `${crypto.randomUUID()}${crypto.randomUUID()}`;
      const { data: claim, error } = await db.from("ownership_claims").insert({
        found_report_id: reportId,
        claimant_name: claimantName || "A community member",
        proof,
        claimant_secret_hash: await hashToken(claimantToken),
      }).select("id,found_report_id,claimant_name,proof,status,created_at").single();
      if (error) return json({ error: "Could not submit ownership proof" }, 502);
      return json({ claim: { ...claim, title: report.title, role: "claimant" }, claimantToken }, 201);
    }

    if (body.action === "list") {
      const claims: Array<Record<string, unknown>> = [];
      const finderAccess = Array.isArray(body.finderAccess) ? body.finderAccess.slice(0, 50) : [];
      const claimantAccess = Array.isArray(body.claimantAccess) ? body.claimantAccess.slice(0, 50) : [];
      for (const access of finderAccess) {
        if (!uuid(access.reportId) || !token(access.token)) continue;
        const { data: report } = await db.from("reports").select("id,title,finder_secret_hash").eq("id", access.reportId).maybeSingle();
        if (!report?.finder_secret_hash || report.finder_secret_hash !== await hashToken(access.token)) continue;
        const { data: rows } = await db.from("ownership_claims").select("id,found_report_id,claimant_name,proof,status,created_at,meeting_place,meeting_at,finder_contact_method,finder_contact_value,handoff_note").eq("found_report_id", report.id).order("created_at", { ascending: false });
        for (const claim of rows || []) claims.push({ ...claim, title: report.title, role: "finder" });
      }
      for (const access of claimantAccess) {
        if (!uuid(access.claimId) || !token(access.token)) continue;
        const { data: claim } = await db.from("ownership_claims").select("id,found_report_id,claimant_name,proof,status,created_at,claimant_secret_hash,meeting_place,meeting_at,finder_contact_method,finder_contact_value,handoff_note").eq("id", access.claimId).maybeSingle();
        if (!claim || claim.claimant_secret_hash !== await hashToken(access.token)) continue;
        const { data: report } = await db.from("reports").select("title,display_name").eq("id", claim.found_report_id).maybeSingle();
        claims.push({ id: claim.id, found_report_id: claim.found_report_id, claimant_name: claim.claimant_name, proof: claim.proof, status: claim.status, created_at: claim.created_at, title: report?.title || "Found item", finder_name: report?.display_name || "Finder", role: "claimant", meeting_place: claim.status === "Approved" ? claim.meeting_place : null, meeting_at: claim.status === "Approved" ? claim.meeting_at : null, finder_contact_method: claim.status === "Approved" ? claim.finder_contact_method : null, finder_contact_value: claim.status === "Approved" ? claim.finder_contact_value : null, handoff_note: claim.status === "Approved" ? claim.handoff_note : null });
      }
      return json({ claims });
    }

    if (body.action === "approve" || body.action === "reject" || body.action === "set-handoff") {
      if (!uuid(body.reportId) || !uuid(body.claimId) || !token(body.finderToken)) return json({ error: "Finder access is required" }, 403);
      const { data: report } = await db.from("reports").select("id,finder_secret_hash").eq("id", body.reportId).maybeSingle();
      if (!report?.finder_secret_hash || report.finder_secret_hash !== await hashToken(body.finderToken)) return json({ error: "Only the finder can review this claim" }, 403);
      let update: Record<string, string | null>;
      if (body.action === "reject") {
        update = { status: "Needs more information" };
      } else {
        const meetingPlace = typeof body.meetingPlace === "string" ? body.meetingPlace.trim().slice(0, 160) : "";
        const meetingAt = typeof body.meetingAt === "string" ? body.meetingAt : "";
        const contactMethod = typeof body.contactMethod === "string" ? body.contactMethod : "";
        const contactValue = typeof body.contactValue === "string" ? body.contactValue.trim().slice(0, 160) : "";
        const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
        const when = new Date(meetingAt);
        if (meetingPlace.length < 3 || !Number.isFinite(when.getTime()) || when.getTime() < Date.now() || !contactMethods.has(contactMethod) || contactValue.length < 3) {
          return json({ error: "Add a future meeting time, public place, and contact details" }, 400);
        }
        update = { status: "Approved", meeting_place: meetingPlace, meeting_at: when.toISOString(), finder_contact_method: contactMethod, finder_contact_value: contactValue, handoff_note: note || null };
      }
      const expectedStatus = body.action === "set-handoff" ? "Approved" : "Pending";
      const { data: claim, error } = await db.from("ownership_claims").update(update).eq("id", body.claimId).eq("found_report_id", report.id).eq("status", expectedStatus).select("id,status,meeting_place,meeting_at,finder_contact_method,finder_contact_value,handoff_note").maybeSingle();
      if (error) return json({ error: "Could not update the claim" }, 502);
      if (!claim) return json({ error: "This claim has changed. Refresh and try again." }, 409);
      return json({ claim });
    }
    return json({ error: "Unknown claim action" }, 400);
  } catch (_error) {
    return json({ error: "Invalid claim request" }, 400);
  }
});
