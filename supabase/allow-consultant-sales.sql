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

  if not found or v_role not in ('admin', 'manager', 'viewer') then
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