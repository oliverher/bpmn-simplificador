# BPMN Simplificador

Aplicativo que recebe o **nome de um processo** ou uma **lista de atividades** e usa a Claude API para:

1. Modelar o processo **"as-is"** (como está) em BPMN 2.0
2. Analisar criticamente (redundâncias, retrabalho, handoffs desnecessários)
3. Propor uma versão **"to-be"** simplificada (princípios ECRS: Eliminar, Combinar, Reorganizar, Simplificar)
4. Exibir os diagramas lado a lado, com métricas de melhoria, exportáveis em `.bpmn` e `.svg`

## Stack

- **Frontend**: React + TypeScript + Vite, `bpmn-js` para renderização/edição do diagrama
- **Backend**: Supabase Edge Function (Deno) que chama a Claude API — a chave fica só no backend, nunca no frontend
- **Banco**: Supabase Postgres (tabelas `processes` e `process_versions`, com RLS por usuário)
- **Auth**: Supabase Auth (email/senha)

## Rodando localmente

```bash
npm install
npm run dev
```

Crie um `.env.local` (não versionado) com:

```
VITE_SUPABASE_URL=https://<seu-projeto>.supabase.co
VITE_SUPABASE_ANON_KEY=<sua-chave-publica>
```

## Configurando o backend (Supabase)

```bash
npx supabase login
npx supabase link --project-ref <seu-projeto-ref>
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-sua-chave-aqui
npx supabase functions deploy analyze-process
```

## Estrutura

```
src/                        # Frontend React
supabase/functions/         # Edge Functions (Deno)
  analyze-process/          # Chama a Claude API e monta o BPMN
  _shared/bpmn-builder.ts   # Gerador de BPMN 2.0 XML a partir de JSON estruturado
supabase/migrations/        # Schema do banco (processes, process_versions)
```
