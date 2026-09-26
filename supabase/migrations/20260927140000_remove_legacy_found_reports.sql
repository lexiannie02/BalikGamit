-- Reports created before finder keys cannot route ownership proof to a finder.
delete from public.reports
where kind = 'found' and finder_secret_hash is null;
