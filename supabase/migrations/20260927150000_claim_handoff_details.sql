alter table public.ownership_claims
  add column meeting_place text,
  add column meeting_at timestamptz,
  add column finder_contact_method text,
  add column finder_contact_value text,
  add column handoff_note text;
