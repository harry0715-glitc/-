-- Signed worker onboarding documents. Health details and handwritten strokes
-- live only inside the immutable PDF packet, not in searchable columns.

begin;

create table if not exists public.worker_document_packets (
  id text primary key,
  worker_id text not null references public.workers(id) on delete cascade,
  contractor_id text not null references public.contractors(id),
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  template_version text not null check (char_length(template_version) between 1 and 80),
  signer_name text not null check (char_length(trim(signer_name)) between 1 and 60),
  signed_at timestamptz not null,
  acceptance_log jsonb not null check (jsonb_typeof(acceptance_log) = 'object'),
  status text not null default 'active' check (status in ('active', 'superseded')),
  created_at timestamptz not null default now(),
  superseded_at timestamptz
);

create unique index if not exists worker_document_packets_active_worker_key
  on public.worker_document_packets (worker_id)
  where status = 'active';

create index if not exists worker_document_packets_contractor_key
  on public.worker_document_packets (contractor_id, created_at desc);

alter table public.worker_document_packets enable row level security;
grant all on public.worker_document_packets to service_role;

-- Invalidate the packet in the same transaction as the worker change.
create or replace function public.invalidate_worker_document_packets()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if row(old.name, old.phone, old.job_title, old.contractor_id, old.status)
    is distinct from row(new.name, new.phone, new.job_title, new.contractor_id, new.status) then
    update public.worker_document_packets
      set status = 'superseded', superseded_at = now()
      where worker_id = new.id and status = 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists invalidate_worker_documents on public.workers;
create trigger invalidate_worker_documents
  after update on public.workers
  for each row execute function public.invalidate_worker_document_packets();

create or replace function public.replace_worker_document_packet(packet jsonb, expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path = public
as $$
declare
  current_worker public.workers;
begin
  select * into current_worker from public.workers
    where id = packet->>'worker_id' and status = 'active' for update;
  if not found or current_worker.updated_at is distinct from expected_updated_at
    or current_worker.contractor_id is distinct from packet->>'contractor_id'
    or current_worker.name is distinct from packet->>'signer_name' then
    raise exception '人員資料已變更，請重新整理後再簽署';
  end if;
  update public.worker_document_packets set status = 'superseded', superseded_at = now()
    where worker_id = current_worker.id and status = 'active';
  insert into public.worker_document_packets
    select (jsonb_populate_record(null::public.worker_document_packets, packet)).*;
end;
$$;
revoke all on function public.replace_worker_document_packet(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.replace_worker_document_packet(jsonb, timestamptz) to service_role;

grant select on public.worker_document_packets to authenticated;

drop policy if exists worker_document_packets_manager_select on public.worker_document_packets;
create policy worker_document_packets_manager_select
  on public.worker_document_packets for select to authenticated
  using (
    public.is_active_owner()
    or (status = 'active' and contractor_id = public.current_manager_contractor_id())
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'worker-documents',
  'worker-documents',
  false,
  2500000,
  array['application/pdf']::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = 2500000,
    allowed_mime_types = array['application/pdf']::text[];

drop policy if exists worker_documents_manager_select on storage.objects;
create policy worker_documents_manager_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'worker-documents'
    and (
      public.is_active_owner()
      or exists (
        select 1 from public.worker_document_packets p
        where p.storage_path = storage.objects.name
          and p.status = 'active'
          and p.contractor_id = public.current_manager_contractor_id()
      )
    )
  );

commit;
