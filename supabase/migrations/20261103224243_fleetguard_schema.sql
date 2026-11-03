-- FleetGuard: execute against a Supabase PostgreSQL project, never an existing unrelated schema.
-- PostgreSQL 15+ provides gen_random_uuid() in pg_catalog.
create type public.employee_role as enum ('administrator','supervisor','driver');
create sequence public.employee_number start 1001;
create table public.user_roles (role public.employee_role primary key, description_en text not null, description_ar text not null);
insert into public.user_roles values ('administrator','Administrator','مدير النظام'),('supervisor','Supervisor','مشرف'),('driver','Driver','سائق');
create table public.profiles (
 id uuid primary key references auth.users(id) on delete restrict,
 employee_id text not null unique check(employee_id ~ '^FG-[0-9]{4,10}$'),
 full_name text not null check(length(trim(full_name)) between 2 and 160),
 email text not null unique, role public.employee_role not null,
 active boolean not null default true, language text not null default 'en' check(language in ('en','ar')),
 supervisor_id uuid references public.profiles(id) on delete restrict,
 licence_expiry date, created_at timestamptz not null default now(), check(supervisor_id is distinct from id)
);
create table public.vehicles (
 id uuid primary key default gen_random_uuid(), plate text not null unique check(length(trim(plate)) between 1 and 40),
 model text not null check(length(trim(model)) between 1 and 120), vehicle_type text not null check(vehicle_type in ('light','heavy')),
 location text not null default '' check(length(location)<=160), active boolean not null default true, created_at timestamptz not null default now()
);
create table public.vehicle_assignments (
 id uuid primary key default gen_random_uuid(), vehicle_id uuid not null references public.vehicles(id),
 driver_id uuid not null references public.profiles(id), operation_day date not null,
 created_at timestamptz not null default now(), unique(vehicle_id,operation_day), unique(driver_id,operation_day)
);
create table public.inspection_templates (
 id uuid primary key default gen_random_uuid(), version integer not null unique check(version>0),
 title text not null check(length(title) between 1 and 160), items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items)=32),
 active boolean not null default true, created_at timestamptz not null default now()
);
create unique index one_active_template on public.inspection_templates(active) where active;
create table public.inspections (
 id uuid primary key default gen_random_uuid(), request_id uuid not null, driver_id uuid not null references public.profiles(id),
 supervisor_id uuid references public.profiles(id), vehicle_id uuid not null references public.vehicles(id),
 template_id uuid not null references public.inspection_templates(id), operation_day date not null default ((now() at time zone 'Asia/Muscat')::date),
 status text not null default 'draft' check(status in ('draft','submitted','approved','rejected')),
 starting_km numeric(12,1), closing_km numeric(12,1), driver_name text, driver_signature text, licence_expiry date,
 notes text not null default '' check(length(notes)<=4000), submitted_at timestamptz, created_at timestamptz not null default now(),
 unique(driver_id,request_id), unique(driver_id,vehicle_id,operation_day),
 check(starting_km >= 0 and closing_km >= starting_km)
);
create table public.inspection_answers (
 inspection_id uuid not null references public.inspections(id), item_no integer not null check(item_no between 1 and 27),
 result text not null check(result in ('pass','fail','na')), comment text not null default '' check(length(comment)<=2000),
 photos text[] not null default '{}', primary key(inspection_id,item_no),
 check(result='pass' or length(trim(comment))>0), check(cardinality(photos)<=3)
);
create table public.vehicle_defects (
 id uuid primary key default gen_random_uuid(), inspection_id uuid not null references public.inspections(id),
 item_no integer not null, vehicle_id uuid not null references public.vehicles(id), description text not null,
 action_taken text not null default '' check(length(action_taken)<=4000), status text not null default 'open' check(status in ('open','in_progress','resolved')),
 assigned_to uuid references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(inspection_id,item_no) references public.inspection_answers(inspection_id,item_no), unique(inspection_id,item_no)
);
create table public.supervisor_approvals (
 id uuid primary key default gen_random_uuid(), inspection_id uuid not null unique references public.inspections(id),
 reviewer_id uuid not null references public.profiles(id), decision text not null check(decision in ('approved','rejected')),
 comment text not null check(length(trim(comment)) between 1 and 2000), signature text not null check(length(trim(signature)) between 2 and 160), created_at timestamptz not null default now()
);
create table public.audit_logs (
 id bigint generated always as identity primary key, actor_id uuid, action text not null, entity text not null, entity_id text,
 details jsonb not null default '{}', created_at timestamptz not null default now()
);
create table public.rate_limits (bucket text primary key, count integer not null, window_start timestamptz not null);
create index assignments_driver_day on public.vehicle_assignments(driver_id,operation_day);
create index inspections_supervisor on public.inspections(supervisor_id,submitted_at);
create index inspections_driver on public.inspections(driver_id,created_at);
create index defects_vehicle on public.vehicle_defects(vehicle_id,status);
create index profiles_supervisor on public.profiles(supervisor_id);
create index audit_created on public.audit_logs(created_at desc);

create table public.role_permissions (
 role public.employee_role not null references public.user_roles(role),
 permission text not null check(permission in ('submit_inspection','review_inspection','manage_defects','export_reports')),
 enabled boolean not null default true, primary key(role,permission), check(role<>'administrator')
);
insert into public.role_permissions values ('driver','submit_inspection',true),('driver','export_reports',true),('supervisor','review_inspection',true),('supervisor','manage_defects',true),('supervisor','export_reports',true);
create function public.my_role() returns public.employee_role language sql stable security definer set search_path='' as $$
 select role from public.profiles where id=auth.uid() and active;
$$;
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.my_role()='administrator',false);
$$;
create function public.has_permission(p_permission text) returns boolean language sql stable security definer set search_path='' as $$
 select public.is_admin() or exists(select 1 from public.role_permissions where role=public.my_role() and permission=p_permission and enabled);
$$;
create function public.can_read_employee(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.my_role() is not null and (public.is_admin() or p_id=auth.uid() or (public.my_role()='supervisor' and exists(select 1 from public.profiles where id=p_id and supervisor_id=auth.uid())));
$$;
create function public.can_read_inspection(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.my_role() is not null and exists(select 1 from public.inspections i where i.id=p_id and (public.is_admin() or i.driver_id=auth.uid() or (public.my_role()='supervisor' and i.supervisor_id=auth.uid())));
$$;
create function public.can_read_vehicle(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.my_role() is not null and (public.is_admin() or exists(select 1 from public.vehicle_assignments a join public.profiles p on p.id=a.driver_id where a.vehicle_id=p_id and (a.driver_id=auth.uid() or (public.my_role()='supervisor' and p.supervisor_id=auth.uid()))) or exists(select 1 from public.inspections i where i.vehicle_id=p_id and public.can_read_inspection(i.id)));
$$;
create function public.can_upload(p_name text) returns boolean language sql stable security definer set search_path='' as $$
 select public.my_role()='driver' and split_part(p_name,'/',1)=auth.uid()::text and exists(select 1 from public.inspections i join public.vehicle_assignments a on a.vehicle_id=i.vehicle_id and a.driver_id=i.driver_id and a.operation_day=i.operation_day join public.vehicles v on v.id=i.vehicle_id where i.id::text=split_part(p_name,'/',2) and i.driver_id=auth.uid() and i.status='draft' and v.active and i.operation_day=(now() at time zone 'Asia/Muscat')::date);
$$;
create function public.can_read_photo(p_name text) returns boolean language sql stable security definer set search_path='' as $$
 select public.my_role() is not null and (public.can_upload(p_name) or exists(select 1 from public.inspection_answers a where p_name=any(a.photos) and public.can_read_inspection(a.inspection_id)));
$$;

alter table public.user_roles enable row level security;
alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.vehicle_assignments enable row level security;
alter table public.inspection_templates enable row level security;
alter table public.inspections enable row level security;
alter table public.inspection_answers enable row level security;
alter table public.vehicle_defects enable row level security;
alter table public.supervisor_approvals enable row level security;
alter table public.audit_logs enable row level security;
alter table public.rate_limits enable row level security;
alter table public.role_permissions enable row level security;
revoke all on all tables in schema public from anon,authenticated;
revoke all on all sequences in schema public from anon,authenticated;
grant select on public.role_permissions,public.user_roles,public.profiles,public.vehicles,public.vehicle_assignments,public.inspection_templates,public.inspections,public.inspection_answers,public.vehicle_defects,public.supervisor_approvals,public.audit_logs to authenticated;
create policy permissions_read on public.role_permissions for select to authenticated using(public.my_role() is not null);
create policy roles_read on public.user_roles for select to authenticated using(public.my_role() is not null);
create policy profiles_read on public.profiles for select to authenticated using(public.can_read_employee(id));
create policy vehicles_read on public.vehicles for select to authenticated using(public.can_read_vehicle(id));
create policy assignments_read on public.vehicle_assignments for select to authenticated using(public.can_read_employee(driver_id));
create policy templates_read on public.inspection_templates for select to authenticated using(public.my_role() is not null);
create policy inspections_read on public.inspections for select to authenticated using(public.can_read_inspection(id));
create policy answers_read on public.inspection_answers for select to authenticated using(public.can_read_inspection(inspection_id));
create policy defects_read on public.vehicle_defects for select to authenticated using(public.can_read_inspection(inspection_id));
create policy approvals_read on public.supervisor_approvals for select to authenticated using(public.can_read_inspection(inspection_id));
create policy audit_read on public.audit_logs for select to authenticated using(public.is_admin() or (public.my_role() is not null and actor_id=auth.uid()));

-- No client has direct INSERT/UPDATE/DELETE grants. All writes go through checked RPCs.
create function public.audit_change() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.audit_logs(actor_id,action,entity,entity_id,details) values(auth.uid(),tg_op,tg_table_name,coalesce(to_jsonb(new)->>'id',to_jsonb(old)->>'id'),jsonb_build_object('before',case when tg_op<>'INSERT' then to_jsonb(old)-'email' end,'after',case when tg_op<>'DELETE' then to_jsonb(new)-'email' end));
 return coalesce(new,old);
end $$;
create trigger profiles_audit after insert or update or delete on public.profiles for each row execute function public.audit_change();
create trigger vehicles_audit after insert or update or delete on public.vehicles for each row execute function public.audit_change();
create trigger assignments_audit after insert or update or delete on public.vehicle_assignments for each row execute function public.audit_change();
create trigger inspections_audit after insert or update or delete on public.inspections for each row execute function public.audit_change();
create trigger defects_audit after insert or update or delete on public.vehicle_defects for each row execute function public.audit_change();
create trigger approvals_audit after insert or update or delete on public.supervisor_approvals for each row execute function public.audit_change();
create trigger templates_audit after insert or update or delete on public.inspection_templates for each row execute function public.audit_change();

create function public.profile_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(17001);
 if tg_op='UPDATE' and old.active and old.role='administrator' and (not new.active or new.role<>'administrator') and not exists(select 1 from public.profiles where id<>old.id and active and role='administrator') then raise exception 'last_administrator'; end if;
 if new.supervisor_id is not null and not exists(select 1 from public.profiles where id=new.supervisor_id and active and role='supervisor') then raise exception 'invalid_supervisor';end if;
 if new.role<>'driver' and new.supervisor_id is not null then raise exception 'invalid_supervisor';end if;
 if tg_op='UPDATE' and (new.role<>'supervisor' or not new.active) and exists(select 1 from public.profiles where supervisor_id=old.id and active) then raise exception 'reassign_drivers_first';end if;
 return new;
end $$;
create trigger profile_validation before insert or update on public.profiles for each row execute function public.profile_guard();

create function public.set_language(p_language text) returns void language plpgsql security definer set search_path='' as $$
begin
 if public.my_role() is null then raise exception 'forbidden';end if;
 if p_language not in ('en','ar') then raise exception 'invalid_language';end if;
 update public.profiles set language=p_language where id=auth.uid();
end $$;
create function public.save_vehicle(p_id uuid,p_plate text,p_model text,p_type text,p_location text,p_active boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not public.is_admin() then raise exception 'forbidden';end if;
 if p_id is null then insert into public.vehicles(plate,model,vehicle_type,location,active) values(trim(p_plate),trim(p_model),p_type,trim(p_location),p_active) returning id into v_id;
 else update public.vehicles set plate=trim(p_plate),model=trim(p_model),vehicle_type=p_type,location=trim(p_location),active=p_active where id=p_id returning id into v_id;end if;
 if v_id is null then raise exception 'not_found';end if;return v_id;
end $$;
create function public.assign_vehicle(p_vehicle uuid,p_driver uuid,p_day date) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not public.is_admin() then raise exception 'forbidden';end if;
 if not exists(select 1 from public.profiles where id=p_driver and active and role='driver') or not exists(select 1 from public.vehicles where id=p_vehicle and active) then raise exception 'invalid_assignment';end if;
 if p_day < (now() at time zone 'Asia/Muscat')::date then raise exception 'past_assignment';end if;
 insert into public.vehicle_assignments(vehicle_id,driver_id,operation_day) values(p_vehicle,p_driver,p_day) returning id into v_id;return v_id;
end $$;
create function public.remove_assignment(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'forbidden';end if;
 if exists(select 1 from public.vehicle_assignments a join public.inspections i on i.driver_id=a.driver_id and i.vehicle_id=a.vehicle_id and i.operation_day=a.operation_day where a.id=p_id) then raise exception 'inspection_exists';end if;
 delete from public.vehicle_assignments where id=p_id;
end $$;
create function public.start_inspection(p_vehicle uuid,p_request uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_template uuid;
begin
 if public.my_role()<>'driver' or public.my_role() is null or not public.has_permission('submit_inspection') then raise exception 'forbidden';end if;
 if not exists(select 1 from public.vehicle_assignments a join public.vehicles v on v.id=a.vehicle_id where a.vehicle_id=p_vehicle and a.driver_id=auth.uid() and a.operation_day=(now() at time zone 'Asia/Muscat')::date and v.active) then raise exception 'not_assigned';end if;
 select id into v_template from public.inspection_templates where active;
 if v_template is null then raise exception 'no_template';end if;
 insert into public.inspections(request_id,driver_id,supervisor_id,vehicle_id,template_id) select p_request,id,supervisor_id,p_vehicle,v_template from public.profiles where id=auth.uid()
 on conflict(driver_id,vehicle_id,operation_day) do nothing returning id into v_id;
 if v_id is null then select id into v_id from public.inspections where driver_id=auth.uid() and vehicle_id=p_vehicle and operation_day=(now() at time zone 'Asia/Muscat')::date;end if;
 return v_id;
end $$;
create function public.submit_inspection(p_id uuid,p_answers jsonb,p_start numeric,p_end numeric,p_signature text,p_expiry date,p_notes text) returns uuid language plpgsql security definer set search_path='' as $$
declare v_i public.inspections; a jsonb; v_photos text[]; v_photo text;
begin
 select * into v_i from public.inspections where id=p_id for update;
 if public.my_role() is distinct from 'driver' or v_i.driver_id is distinct from auth.uid() or not public.has_permission('submit_inspection') then raise exception 'forbidden';end if;
 if v_i.status<>'draft' then return v_i.id;end if; -- idempotent retry after server-confirmed submission
 if v_i.operation_day<>(now() at time zone 'Asia/Muscat')::date or not exists(select 1 from public.vehicle_assignments va join public.vehicles v on v.id=va.vehicle_id where va.vehicle_id=v_i.vehicle_id and va.driver_id=auth.uid() and va.operation_day=v_i.operation_day and v.active) then raise exception 'not_assigned';end if;
 if p_start is null or p_end is null or p_start<0 or p_end<p_start or p_start='NaN'::numeric or p_end='NaN'::numeric or length(trim(coalesce(p_signature,''))) not between 2 and 160 or p_expiry is null or p_expiry<v_i.operation_day or p_notes is null or length(p_notes)>4000 then raise exception 'invalid_signoff';end if;
 if jsonb_typeof(p_answers) is distinct from 'array' or jsonb_array_length(p_answers)<>27 then raise exception 'incomplete_answers';end if;
 if (select count(distinct (x->>'item_no')::int) from jsonb_array_elements(p_answers) x)<>27 then raise exception 'incomplete_answers';end if;
 for a in select value from jsonb_array_elements(p_answers) loop
  if a->>'result' is null or a->>'result' not in ('pass','fail','na') or (a->>'item_no')::int not between 1 and 27 or a->>'item_no' is null then raise exception 'invalid_answer';end if;
  if a->>'result'<>'pass' and length(trim(coalesce(a->>'comment','')))=0 then raise exception 'comment_required';end if;
  if jsonb_typeof(a->'photos') is distinct from 'array' then raise exception 'invalid_photos';end if;
  select coalesce(array_agg(value),'{}') into v_photos from jsonb_array_elements_text(a->'photos');
  if cardinality(v_photos)>3 then raise exception 'invalid_photos';end if;
  foreach v_photo in array v_photos loop
   if split_part(v_photo,'/',1)<>auth.uid()::text or split_part(v_photo,'/',2)<>p_id::text or not exists(select 1 from storage.objects where bucket_id='inspection-photos' and name=v_photo) then raise exception 'invalid_photos';end if;
  end loop;
  insert into public.inspection_answers(inspection_id,item_no,result,comment,photos) values(p_id,(a->>'item_no')::int,a->>'result',coalesce(a->>'comment',''),v_photos);
 end loop;
 update public.inspections set starting_km=p_start,closing_km=p_end,driver_signature=trim(p_signature),licence_expiry=p_expiry,driver_name=(select full_name from public.profiles where id=auth.uid()),notes=p_notes,submitted_at=now(),status='submitted' where id=p_id;
 insert into public.vehicle_defects(inspection_id,item_no,vehicle_id,description) select inspection_id,item_no,v_i.vehicle_id,comment from public.inspection_answers where inspection_id=p_id and result='fail';
 return p_id;
end $$;
create function public.review_inspection(p_id uuid,p_decision text,p_comment text,p_signature text) returns void language plpgsql security definer set search_path='' as $$
declare v_i public.inspections;
begin
 select * into v_i from public.inspections where id=p_id for update;
 if not public.has_permission('review_inspection') or not (public.is_admin() or (public.my_role()='supervisor' and v_i.supervisor_id=auth.uid())) or public.my_role() is null or v_i.id is null or v_i.driver_id=auth.uid() then raise exception 'forbidden';end if;
 if v_i.status<>'submitted' then raise exception 'already_reviewed';end if;
 insert into public.supervisor_approvals(inspection_id,reviewer_id,decision,comment,signature) values(p_id,auth.uid(),p_decision,trim(p_comment),trim(p_signature));
 update public.inspections set status=p_decision where id=p_id;
end $$;
create function public.update_defect(p_id uuid,p_status text,p_action text,p_assignee uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.has_permission('manage_defects') or public.my_role() is null or public.my_role()='driver' or not exists(select 1 from public.vehicle_defects where id=p_id and public.can_read_inspection(inspection_id)) then raise exception 'forbidden';end if;
 if p_assignee is not null and not public.can_read_employee(p_assignee) then raise exception 'invalid_assignee';end if;
 if length(trim(coalesce(p_action,'')))=0 then raise exception 'action_required';end if;
 update public.vehicle_defects set status=p_status,action_taken=p_action,assigned_to=p_assignee,updated_at=now() where id=p_id;
end $$;
create function public.publish_template(p_title text,p_items jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not public.is_admin() then raise exception 'forbidden';end if;
 perform pg_advisory_xact_lock(17002);
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)<>32 or (select count(distinct (x->>'source_row')::int) from jsonb_array_elements(p_items) x where (x->>'source_row')::int between 1 and 32)<>32 then raise exception 'invalid_template';end if;
 -- Company source keys and field kinds cannot be changed or omitted.
 if exists(select 1 from jsonb_array_elements(p_items) x left join public.inspection_templates t on t.version=1 where not exists(select 1 from jsonb_array_elements(t.items) old where old->>'source_row'=x->>'source_row' and old->>'key'=x->>'key' and old->>'kind'=x->>'kind') or length(trim(coalesce(x->>'label_en','')))=0 or length(trim(coalesce(x->>'label_ar','')))=0) then raise exception 'invalid_template';end if;
 update public.inspection_templates set active=false where active;
 insert into public.inspection_templates(version,title,items) select coalesce(max(version),0)+1,p_title,p_items from public.inspection_templates returning id into v_id;return v_id;
end $$;
create function public.dashboard_stats() returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare d date := (now() at time zone 'Asia/Muscat')::date;
begin
 if public.my_role() is null then raise exception 'forbidden';end if;
 return jsonb_build_object(
 'employees',(select count(*) from public.profiles),'activeEmployees',(select count(*) from public.profiles where active),
 'vehicles',(select count(*) from public.vehicles),'today',(select count(*) from public.inspections where operation_day=d and status<>'draft'),
 'pending',(select count(*) from public.vehicle_assignments a where operation_day=d and not exists(select 1 from public.inspections i where i.driver_id=a.driver_id and i.vehicle_id=a.vehicle_id and i.operation_day=d and i.status<>'draft')),
 'failed',(select count(*) from public.inspections i where i.operation_day=d and exists(select 1 from public.inspection_answers a where a.inspection_id=i.id and a.result='fail')),
 'maintenance',(select count(distinct vehicle_id) from public.vehicle_defects where status<>'resolved'),
 'approvals',(select count(*) from public.inspections where status='submitted'),
 'trend',(select coalesce(jsonb_agg(jsonb_build_object('day',g.day::date,'count',(select count(*) from public.inspections where operation_day=g.day::date and status<>'draft')) order by g.day),'[]') from generate_series(d-6,d,'1 day'::interval) g(day)));
end $$;

create function public.set_permission(p_role public.employee_role,p_permission text,p_enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'forbidden';end if;
 update public.role_permissions set enabled=p_enabled where role=p_role and permission=p_permission;
 if not found then raise exception 'invalid_permission';end if;
 insert into public.audit_logs(actor_id,action,entity,entity_id,details) values(auth.uid(),'PERMISSION_CHANGED','role_permissions',p_role::text,jsonb_build_object('permission',p_permission,'enabled',p_enabled));
end $$;
-- Service-only helpers: no public account enumeration or signup.
create function public.next_employee_id() returns text language sql security definer set search_path='' as $$select 'FG-'||nextval('public.employee_number')::text$$;
create function public.consume_rate_limit(p_bucket text,p_limit integer,p_seconds integer) returns boolean language plpgsql security definer set search_path='' as $$
declare v_count int;
begin
 insert into public.rate_limits(bucket,count,window_start) values(p_bucket,1,now()) on conflict(bucket) do update set count=case when public.rate_limits.window_start<now()-make_interval(secs=>p_seconds) then 1 else public.rate_limits.count+1 end,window_start=case when public.rate_limits.window_start<now()-make_interval(secs=>p_seconds) then now() else public.rate_limits.window_start end returning count into v_count;
 delete from public.rate_limits where window_start<now()-interval '2 days';return v_count<=p_limit;
end $$;
revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function public.my_role(),public.is_admin(),public.can_read_employee(uuid),public.can_read_inspection(uuid),public.can_read_vehicle(uuid),public.can_upload(text),public.can_read_photo(text),public.set_language(text),public.save_vehicle(uuid,text,text,text,text,boolean),public.assign_vehicle(uuid,uuid,date),public.remove_assignment(uuid),public.start_inspection(uuid,uuid),public.submit_inspection(uuid,jsonb,numeric,numeric,text,date,text),public.review_inspection(uuid,text,text,text),public.update_defect(uuid,text,text,uuid),public.publish_template(text,jsonb),public.dashboard_stats(),public.has_permission(text),public.set_permission(public.employee_role,text,boolean) to authenticated;
grant execute on function public.next_employee_id(),public.consume_rate_limit(text,integer,integer) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('inspection-photos','inspection-photos',false,5242880,array['image/jpeg','image/png','image/webp']);
create policy photo_insert on storage.objects for insert to authenticated with check(bucket_id='inspection-photos' and public.can_upload(name));
create policy photo_select on storage.objects for select to authenticated using(bucket_id='inspection-photos' and public.can_read_photo(name));
create policy photo_delete on storage.objects for delete to authenticated using(bucket_id='inspection-photos' and public.can_upload(name));
-- No update policy: submitted evidence cannot be overwritten.

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

create function public.authorize_export() returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.has_permission('export_reports') then raise exception 'forbidden';end if;
 insert into public.audit_logs(actor_id,action,entity) values(auth.uid(),'REPORT_EXPORTED','reports');
end $$;
revoke execute on function public.authorize_export() from public,anon;
grant execute on function public.authorize_export() to authenticated;
-- Realtime complements the client's 30-second refresh fallback.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.inspections,public.vehicle_defects;
 end if;
end $$;
