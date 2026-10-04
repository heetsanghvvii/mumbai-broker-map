-- Brokers who are on Mumbai Broker Map's own list.
-- Only the Google place ID is stored from Google; names, addresses, phones and ratings
-- always come live from Google Maps (Google Maps Platform terms). Everything else here
-- is our own data: what the broker gave us when they claimed their profile, and our outreach notes.

create table if not exists public.brokers (
  place_id        text primary key,               -- Google place ID (allowed to store indefinitely)
  area            text,
  verified        boolean not null default false, -- true once we've checked their MahaRERA registration
  rera_number     text,                           -- e.g. A51800012345, from the broker
  broker_whatsapp text,                           -- number the broker asked buyers to use
  status          text not null default 'not_contacted'
                  check (status in ('not_contacted','messaged','replied','claimed','not_interested','wrong_number')),
  notes           text,
  updated_at      timestamptz not null default now()
);

alter table public.brokers enable row level security;

-- The website (anonymous visitors) may read verified brokers only, and only the columns
-- the page shows. Status, notes and unverified rows stay private.
drop policy if exists "Visitors read verified brokers" on public.brokers;
create policy "Visitors read verified brokers" on public.brokers
  for select to anon, authenticated
  using (verified);

revoke all on public.brokers from anon, authenticated;
grant select (place_id, rera_number, broker_whatsapp, verified) on public.brokers to anon, authenticated;

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists brokers_touch on public.brokers;
create trigger brokers_touch before update on public.brokers
  for each row execute function public.touch_updated_at();
