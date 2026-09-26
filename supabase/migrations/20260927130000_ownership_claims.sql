alter table public.reports add column finder_secret_hash text;

create table public.ownership_claims (
  id uuid primary key default gen_random_uuid(),
  found_report_id uuid not null references public.reports(id) on delete cascade,
  claimant_name text not null,
  proof text not null,
  claimant_secret_hash text not null,
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Needs more information')),
  created_at timestamptz not null default now()
);

create index ownership_claims_report_idx on public.ownership_claims(found_report_id, created_at desc);
alter table public.ownership_claims enable row level security;
-- Claims and proof are accessible only through the Edge Function's token checks.
