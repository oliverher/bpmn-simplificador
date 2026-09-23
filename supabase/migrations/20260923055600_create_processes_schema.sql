-- Processos analisados pelo usuário
create table public.processes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  input_type text not null check (input_type in ('process_name', 'activities_list')),
  raw_input text not null,
  department text,
  actors text,
  constraints_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Versões geradas de cada processo (as-is / to-be), com o BPMN e a análise da IA
create table public.process_versions (
  id uuid primary key default gen_random_uuid(),
  process_id uuid not null references public.processes(id) on delete cascade,
  version_type text not null check (version_type in ('as_is', 'to_be')),
  bpmn_xml text not null,
  analysis jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index processes_user_id_idx on public.processes(user_id);
create index process_versions_process_id_idx on public.process_versions(process_id);

alter table public.processes enable row level security;
alter table public.process_versions enable row level security;

create policy "Users can view their own processes"
  on public.processes for select
  using (auth.uid() = user_id);

create policy "Users can insert their own processes"
  on public.processes for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own processes"
  on public.processes for update
  using (auth.uid() = user_id);

create policy "Users can delete their own processes"
  on public.processes for delete
  using (auth.uid() = user_id);

create policy "Users can view versions of their own processes"
  on public.process_versions for select
  using (exists (
    select 1 from public.processes p
    where p.id = process_versions.process_id and p.user_id = auth.uid()
  ));

create policy "Users can insert versions for their own processes"
  on public.process_versions for insert
  with check (exists (
    select 1 from public.processes p
    where p.id = process_versions.process_id and p.user_id = auth.uid()
  ));

create policy "Users can delete versions of their own processes"
  on public.process_versions for delete
  using (exists (
    select 1 from public.processes p
    where p.id = process_versions.process_id and p.user_id = auth.uid()
  ));
