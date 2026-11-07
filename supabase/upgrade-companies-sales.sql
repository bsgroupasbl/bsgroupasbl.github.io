alter table public.profiles
  drop constraint if exists profiles_company_check;

alter table public.profiles
  add constraint profiles_company_check
  check (company in ('print', 'cafe', 'pharma', 'tech'));

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text;

create unique index if not exists profiles_login_name_unique
on public.profiles (lower(btrim(first_name)), lower(btrim(last_name)))
where first_name is not null and last_name is not null;

alter table public.inventory
  drop constraint if exists inventory_company_check;

alter table public.inventory
  add constraint inventory_company_check
  check (company in ('print', 'cafe', 'pharma', 'tech'));

alter table public.inventory
  add column if not exists unit_price numeric(12, 2) not null default 0
  check (unit_price >= 0);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  company text not null check (company in ('print', 'cafe', 'pharma', 'tech')),
  inventory_id uuid references public.inventory (id) on delete set null,
  item_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  total_amount numeric(14, 2) generated always as (quantity * unit_price) stored,
  sold_by uuid not null default auth.uid() references auth.users (id),
  sold_at timestamptz not null default now()
);

alter table public.sales enable row level security;
grant select on public.sales to authenticated;

drop policy if exists "Users can read authorized company sales" on public.sales;
create policy "Users can read authorized company sales"
on public.sales for select to authenticated
using (
  (select public.current_profile_role()) = 'admin'
  or company = (select public.current_profile_company())
);

create or replace function public.record_sale(p_inventory_id uuid, p_quantity integer)
returns public.sales
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_role text;
  v_company text;
  v_item public.inventory%rowtype;
  v_sale public.sales%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Connexion requise.';
  end if;

  select role, company into v_role, v_company
  from public.profiles
  where user_id = v_user_id;

  if not found or v_role not in ('admin', 'manager') then
    raise exception using errcode = '42501', message = 'Vente non autorisee.';
  end if;

  if p_quantity is null or p_quantity <= 0 then
    raise exception using errcode = '22023', message = 'La quantite doit etre superieure a zero.';
  end if;

  select * into v_item
  from public.inventory
  where id = p_inventory_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Article introuvable.';
  end if;

  if v_role <> 'admin' and v_item.company <> v_company then
    raise exception using errcode = '42501', message = 'Acces refuse pour cette entreprise.';
  end if;

  if v_item.quantity < p_quantity then
    raise exception using errcode = '22003', message = 'Stock insuffisant.';
  end if;

  update public.inventory
  set quantity = quantity - p_quantity
  where id = v_item.id;

  insert into public.sales (
    company, inventory_id, item_name, quantity, unit_price, sold_by
  ) values (
    v_item.company, v_item.id, v_item.name, p_quantity, v_item.unit_price, v_user_id
  ) returning * into v_sale;

  return v_sale;
end;
$$;

revoke all on function public.record_sale(uuid, integer) from public;
grant execute on function public.record_sale(uuid, integer) to authenticated;