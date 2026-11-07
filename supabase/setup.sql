create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  first_name text,
  last_name text,
  company text check (company in ('print', 'cafe', 'pharma', 'tech')),
  role text not null check (role in ('admin', 'manager', 'viewer')),
  created_at timestamptz not null default now(),
  constraint profiles_company_role_check check (
    (role = 'admin' and company is null)
    or (role <> 'admin' and company is not null)
  )
);

create unique index if not exists profiles_login_name_unique
on public.profiles (lower(btrim(first_name)), lower(btrim(last_name)))
where first_name is not null and last_name is not null;

create table if not exists public.inventory (
  id uuid primary key default gen_random_uuid(),
  company text not null check (company in ('print', 'cafe', 'pharma', 'tech')),
  name text not null check (char_length(name) between 1 and 80),
  sku text not null default '',
  quantity integer not null check (quantity >= 0),
  unit text not null check (char_length(unit) between 1 and 20),
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0),
  threshold integer not null default 5 check (threshold >= 0),
  batch text not null default '',
  expiry date,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  constraint inventory_pharma_fields_check check (
    company = 'pharma' or (batch = '' and expiry is null)
  )
);

alter table public.profiles enable row level security;
alter table public.inventory enable row level security;

create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where user_id = (select auth.uid())
$$;

create or replace function public.current_profile_company()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select company from public.profiles where user_id = (select auth.uid())
$$;

revoke all on function public.current_profile_role() from public;
revoke all on function public.current_profile_company() from public;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_profile_company() to authenticated;

grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.inventory to authenticated;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
on public.profiles for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Users can read their company inventory" on public.inventory;
create policy "Users can read their company inventory"
on public.inventory for select to authenticated
using (
  (select public.current_profile_role()) = 'admin'
  or company = (select public.current_profile_company())
);

drop policy if exists "Managers can add company inventory" on public.inventory;
create policy "Managers can add company inventory"
on public.inventory for insert to authenticated
with check (
  (select public.current_profile_role()) = 'admin'
  or (
    (select public.current_profile_role()) = 'manager'
    and company = (select public.current_profile_company())
  )
);

drop policy if exists "Managers can update company inventory" on public.inventory;
create policy "Managers can update company inventory"
on public.inventory for update to authenticated
using (
  (select public.current_profile_role()) = 'admin'
  or (
    (select public.current_profile_role()) = 'manager'
    and company = (select public.current_profile_company())
  )
)
with check (
  (select public.current_profile_role()) = 'admin'
  or (
    (select public.current_profile_role()) = 'manager'
    and company = (select public.current_profile_company())
  )
);

drop policy if exists "Managers can delete company inventory" on public.inventory;
create policy "Managers can delete company inventory"
on public.inventory for delete to authenticated
using (
  (select public.current_profile_role()) = 'admin'
  or (
    (select public.current_profile_role()) = 'manager'
    and company = (select public.current_profile_company())
  )
);

-- Creer les comptes dans Supabase Auth, puis leur attribuer un profil ici.
-- Exemple responsable: insert into public.profiles (user_id, company, role)
-- values ('UUID_DU_COMPTE', 'pharma', 'manager');
-- Exemple administrateur: insert into public.profiles (user_id, company, role)
-- values ('UUID_DU_COMPTE', null, 'admin');