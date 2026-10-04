-- Mumbai Broker Map: Supabase schema. Run once in the SQL editor of a fresh project.
-- Replace SERVER_SECRET_SHA256 with the SHA-256 (hex) of the COMMUTE_DB_SECRET you set in Vercel:
--   printf %s "$COMMUTE_DB_SECRET" | shasum -a 256

-- ---------- Broker directory (public, read-only for visitors) ----------
create table if not exists public.brokers (
  place_id        text primary key,               -- Google place ID
  area            text,
  name            text,
  address         text,
  phone           text,
  whatsapp        text,                           -- 91XXXXXXXXXX when the phone is an Indian mobile
  rating          numeric(2,1),
  reviews         integer not null default 0,
  website         text,
  lat             double precision,
  lng             double precision,
  approx_location boolean not null default false,
  updated_at      timestamptz not null default now()
);
create index if not exists brokers_lat_lng on public.brokers (lat, lng);
create index if not exists brokers_area on public.brokers (area);

alter table public.brokers enable row level security;
drop policy if exists "Visitors read the directory" on public.brokers;
create policy "Visitors read the directory" on public.brokers for select to anon, authenticated using (true);
revoke all on public.brokers from anon, authenticated;
grant select (place_id, area, name, address, phone, whatsapp, rating, reviews, website, lat, lng)
  on public.brokers to anon, authenticated;

create or replace function public.broker_map_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists brokers_touch on public.brokers;
create trigger brokers_touch before update on public.brokers
  for each row execute function public.broker_map_touch_updated_at();

-- Areas with counts and centres, for "Browse by area".
create or replace view public.broker_areas with (security_invoker = true) as
  select area, count(*)::int as brokers, avg(lat) as lat, avg(lng) as lng
  from public.brokers
  where area is not null and area <> 'Unsorted' and lat is not null
  group by area;
grant select on public.broker_areas to anon, authenticated;

-- ---------- Daily Google budget for the browser (map loads, searches, nearby fallback) ----------
create table if not exists public.broker_map_usage (
  day  date not null,
  kind text not null,
  used integer not null default 0,
  primary key (day, kind)
);
alter table public.broker_map_usage enable row level security;
revoke all on public.broker_map_usage from anon, authenticated;

create or replace function public.broker_map_take(kind text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  k text := broker_map_take.kind;  -- the parameter, not the table column of the same name
  cap integer := case k
    when 'map_load' then 300   -- Dynamic Maps: 10,000 free a month
    when 'search'   then 300   -- Autocomplete session + Place Details Essentials: 10,000 free
    when 'nearby'   then 150   -- Nearby Search Pro: 5,000 free
    else 0 end;
  today date := (now() at time zone 'Asia/Kolkata')::date;
  n integer;
begin
  if cap = 0 then return false; end if;
  insert into public.broker_map_usage as u (day, kind, used) values (today, k, 1)
  on conflict on constraint broker_map_usage_pkey do update set used = u.used + 1
  returning u.used into n;
  return n <= cap;
end $$;
revoke all on function public.broker_map_take(text) from public;
grant execute on function public.broker_map_take(text) to anon, authenticated;

-- ---------- Commute Search (server only) ----------
-- No RLS policies: only broker_map_server(), which checks the server secret, touches these.
create table if not exists public.broker_map_commute_cache (
  key        text primary key,
  result     jsonb not null,
  elements   integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.broker_map_rate (
  day  date not null,
  who  text not null,   -- SHA-256 of the visitor IP, never the IP itself
  hits integer not null default 0,
  primary key (day, who)
);
create table if not exists public.broker_map_payments (
  order_id   text primary key,
  office_key text not null,
  amount     integer not null,
  status     text not null default 'created',
  payment_id text,
  created_at timestamptz not null default now(),
  paid_at    timestamptz
);
alter table public.broker_map_commute_cache enable row level security;
alter table public.broker_map_rate enable row level security;
alter table public.broker_map_payments enable row level security;
revoke all on public.broker_map_commute_cache, public.broker_map_rate, public.broker_map_payments from anon, authenticated;

create or replace function public.broker_map_server_ok(secret text) returns boolean
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(secret, 'sha256'), 'hex') = 'SERVER_SECRET_SHA256'
$$;
revoke all on function public.broker_map_server_ok(text) from public, anon, authenticated;

create or replace function public.broker_map_server(secret text, action text, args jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  n integer;
  r jsonb;
begin
  if not public.broker_map_server_ok(secret) then raise exception 'not allowed'; end if;

  if action = 'cache_get' then
    select c.result into r from public.broker_map_commute_cache c
     where c.key = args->>'key'
       and c.created_at > now() - make_interval(hours => coalesce((args->>'ttl_hours')::int, 24));
    return r;

  elsif action = 'cache_put' then
    insert into public.broker_map_commute_cache (key, result, elements)
    values (args->>'key', args->'result', coalesce((args->>'elements')::int, 0))
    on conflict (key) do update set result = excluded.result, elements = excluded.elements, created_at = now();
    return 'true'::jsonb;

  elsif action = 'rate_hit' then
    insert into public.broker_map_rate as t (day, who, hits) values (today, args->>'who', 1)
    on conflict (day, who) do update set hits = t.hits + 1
    returning hits into n;
    return to_jsonb(n);

  elsif action = 'budget' then
    -- Adds n units to today's counter for `kind` only if it stays within `cap`; returns whether it fit.
    insert into public.broker_map_usage (day, kind, used) values (today, args->>'kind', 0)
    on conflict (day, kind) do nothing;
    update public.broker_map_usage u set used = u.used + (args->>'n')::int
     where u.day = today and u.kind = args->>'kind' and u.used + (args->>'n')::int <= (args->>'cap')::int
    returning used into n;
    return to_jsonb(n is not null);

  elsif action = 'payment_create' then
    insert into public.broker_map_payments (order_id, office_key, amount)
    values (args->>'order_id', args->>'office_key', (args->>'amount')::int)
    on conflict (order_id) do nothing;
    return 'true'::jsonb;

  elsif action = 'payment_paid' then
    update public.broker_map_payments
       set status = 'paid', payment_id = coalesce(args->>'payment_id', payment_id), paid_at = coalesce(paid_at, now())
     where order_id = args->>'order_id'
    returning to_jsonb(office_key) into r;
    return coalesce(r, 'null'::jsonb);

  elsif action = 'payment_get' then
    select to_jsonb(p) into r from public.broker_map_payments p where p.order_id = args->>'order_id';
    return r;
  end if;
  raise exception 'unknown action %', action;
end $$;
revoke all on function public.broker_map_server(text, text, jsonb) from public;
grant execute on function public.broker_map_server(text, text, jsonb) to anon;
