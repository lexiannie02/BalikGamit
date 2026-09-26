create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('lost', 'found')),
  title text not null,
  category text not null,
  color text not null,
  location text not null,
  report_date date not null,
  description text not null,
  visual_type text not null default 'box',
  visual_label text,
  image_path text,
  status text not null default 'Active' check (status in ('Active', 'Return in Progress', 'Resolved')),
  display_name text not null default 'Anonymous helper',
  created_at timestamptz not null default now()
);

create index if not exists reports_active_kind_date_idx
  on public.reports (kind, status, report_date desc);

alter table public.reports enable row level security;

drop policy if exists "Active reports are publicly readable" on public.reports;
create policy "Active reports are publicly readable"
  on public.reports for select
  using (status = 'Active');

drop policy if exists "Anyone can create reports" on public.reports;
create policy "Anyone can create reports"
  on public.reports for insert
  with check (true);

insert into storage.buckets (id, name, public)
values ('report-images', 'report-images', false)
on conflict (id) do nothing;
