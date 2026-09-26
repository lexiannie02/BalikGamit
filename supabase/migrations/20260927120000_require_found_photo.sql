-- Existing found reports without photos remain readable; new found reports need one.
alter table public.reports
  add constraint found_report_photo_required
  check (kind = 'lost' or (image_path is not null and btrim(image_path) <> ''))
  not valid;
