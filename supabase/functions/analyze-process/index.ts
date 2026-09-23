import { buildBpmnXml, computeGraphMetrics, sanitizeGraph, type BpmnGraph } from "../_shared/bpmn-builder.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SONNET = "claude-sonnet-5";
// Os dois grafos BPMN são a parte crítica (e a que mais gasta tokens): ficam no modelo mais capaz.
const GRAPH_MODELS = [SONNET];
// Resumo, problemas e melhorias são textos curtos: Haiku 4.5 nas 2 primeiras tentativas (o Haiku não aceita
// `effort`), Sonnet 5 com esforço baixo se ele falhar.
const TEXT_MODELS = ["claude-haiku-4-5", "claude-haiku-4-5", SONNET];
const TEXT_EFFORT: Effort | undefined = "low";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const graphSchema = {
  type: "object",
  properties: {
    process_name: { type: "string" },
    lanes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
        },
        required: ["id", "name"],
      },
    },
    elements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: {
            type: "string",
            enum: ["startEvent", "endEvent", "task", "userTask", "serviceTask", "exclusiveGateway", "parallelGateway"],
          },
          name: { type: "string" },
          lane: { type: "string" },
        },
        required: ["id", "type", "name", "lane"],
      },
    },
    flows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          source: { type: "string" },
          target: { type: "string" },
          name: { type: "string" },
        },
        required: ["id", "source", "target"],
      },
    },
  },
  required: ["process_name", "lanes", "elements", "flows"],
};

const MODELING_RULES = `Boas práticas de modelagem BPMN 2.0 (siga TODAS):
- IDs únicos, curtos, sem espaços/acentos (ex: "start1", "task_analise", "gw_aprovado"). Todo elemento pertence a uma lane existente; todo flow referencia ids existentes.
- Exatamente UM evento de início (nome = gatilho, ex: "Solicitação recebida") e um evento de fim para CADA desfecho distinto (nome = resultado, ex: "Férias autorizadas", "Solicitação negada").
- Atividades: nome no formato verbo no infinitivo + objeto, até 5 palavras (ex: "Analisar solicitação"). Use "userTask" para trabalho humano em sistema, "serviceTask" para etapas automáticas/sistêmicas e "task" nos demais casos.
- Cada atividade tem EXATAMENTE 1 fluxo de entrada e 1 de saída. Divisões e junções de fluxo SÓ podem ser feitas com gateways (nunca duas saídas saindo de uma atividade).
- Gateway exclusivo (decisão): nome em forma de pergunta (ex: "Documentos completos?"), 2+ saídas, TODAS com rótulo da resposta ("Sim"/"Não", "Aprovado"/"Reprovado"). Gateway paralelo apenas para atividades realmente simultâneas, sempre fechado por outro gateway paralelo.
- Retrabalho (voltar a etapa anterior) só através de um gateway exclusivo com saída rotulada. Sem ciclos infinitos.
- Todo elemento deve estar no caminho entre o início e algum fim: sem elementos soltos, sem fluxos sem destino.
- Cada raia representa um ator/setor responsável (nome curto, ex: "Servidor", "Gerente", "Sistema"); não crie raias sem atividades.
- Mantenha o diagrama legível: no máximo ~20 elementos no as-is; nomes curtos.
- Todos os textos em português.
- Em qualquer texto explicativo (resumo, problemas, melhorias), refira-se às etapas pelo NOME em linguagem natural (ex: "a coleta biométrica"), NUNCA por ids técnicos como "task_x" ou "gw_y".`;

interface RequestBody {
  /** "transcribe": só lê as imagens e devolve o texto; padrão: análise completa. */
  mode?: "analyze" | "transcribe";
  inputType: "process_name" | "activities_list";
  input: string;
  department?: string;
  actors?: string;
  constraintsNotes?: string;
  images?: { media_type: string; data: string }[];
  /** Processo atual já modelado (BPMN importado): dispensa a modelagem do as-is. */
  asIsGraph?: unknown;
}

type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

const MAX_IMAGES = 8;
const MAX_IMAGES_CHARS = 4_500_000;
const MAX_INPUT_CHARS = 120_000;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/** Valida as imagens recebidas (tipo, base64, quantidade e tamanho). Devolve a mensagem de erro, se houver. */
function imagesProblem(images: RequestBody["images"]): string | null {
  if (!Array.isArray(images) || images.length === 0) return "Nenhuma imagem enviada.";
  if (images.length > MAX_IMAGES) return `No máximo ${MAX_IMAGES} imagens por análise.`;
  let total = 0;
  for (const img of images) {
    if (!img || !ALLOWED_IMAGE_TYPES.includes(img.media_type)) return "Tipo de imagem não suportado.";
    if (typeof img.data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(img.data)) return "Imagem inválida.";
    total += img.data.length;
  }
  return total > MAX_IMAGES_CHARS ? "As imagens são grandes demais." : null;
}

const TRANSCRIBE_SYSTEM = `Você lê imagens de documentos e diagramas que descrevem um processo de trabalho (fluxogramas, quadros brancos, formulários, páginas escaneadas de procedimentos) e transcreve o que está mostrado.

Regras:
- Transcreva fielmente: o título do processo, os responsáveis/setores, cada atividade na ordem do fluxo, as decisões (com a pergunta e o destino de cada resposta), os retornos/retrabalhos, prazos e observações escritas.
- Escreva em português, em texto simples: uma linha "Processo: <título>", uma linha "Responsáveis: ...", e depois as etapas numeradas, uma por linha, dizendo quem executa. Decisões e desvios no formato "Se <condição>: vai para o passo N".
- NÃO invente etapas, responsáveis ou informações que não estejam visíveis. Trechos ilegíveis: escreva [ilegível].
- Se as imagens não mostrarem um processo, diga isso em uma frase.
- Responda SOMENTE chamando a ferramenta com o campo solicitado.`;

interface RawGraph {
  process_name: string;
  lanes: { id: string; name: string }[];
  elements: { id: string; type: string; name: string; lane: string }[];
  flows: { id: string; source: string; target: string; name?: string }[];
}

function toBpmnGraph(raw: RawGraph): BpmnGraph {
  return {
    processName: raw.process_name,
    lanes: raw.lanes,
    elements: raw.elements.map((e) => ({
      id: e.id,
      type: e.type as BpmnGraph["elements"][number]["type"],
      name: e.name,
      lane: e.lane,
    })),
    flows: raw.flows,
  };
}

/** Corrige desvios comuns do modelo: listas devolvidas como texto JSON e nome do processo omitido. */
function normalizeRawGraph(fallbackName: string) {
  return (graph: RawGraph): RawGraph => {
    if (!graph || typeof graph !== "object") return graph;
    const g = graph as unknown as Record<string, unknown>;
    for (const key of ["lanes", "elements", "flows"]) {
      if (typeof g[key] === "string") {
        try {
          g[key] = JSON.parse(g[key] as string);
        } catch {
          /* mantém como está; a validação vai rejeitar */
        }
      }
    }
    if (typeof g.process_name !== "string" || !g.process_name) g.process_name = fallbackName;
    return graph;
  };
}

function isValidRawGraph(graph: unknown): graph is RawGraph {
  const g = graph as RawGraph | undefined;
  return !!g && typeof g.process_name === "string" && Array.isArray(g.lanes) && Array.isArray(g.elements) && Array.isArray(g.flows);
}

/** Descreve o processo só com nomes (sem ids técnicos), para alimentar as chamadas seguintes:
 *  evita que o modelo cite "task_x" nos textos e gasta menos tokens. */
function graphSummaryText(graph: RawGraph): string {
  const kind: Record<string, string> = {
    startEvent: "Início",
    endEvent: "Fim",
    task: "Atividade",
    userTask: "Atividade do usuário",
    serviceTask: "Atividade automática",
    exclusiveGateway: "Decisão",
    parallelGateway: "Paralelismo",
  };
  const nameOf = new Map(graph.elements.map((e) => [e.id, e.name || e.id]));
  const perLane = graph.lanes
    .map(
      (l) =>
        `${l.name}:\n` +
        graph.elements
          .filter((e) => e.lane === l.id)
          .map((e) => `  - [${kind[e.type] ?? e.type}] ${e.name}`)
          .join("\n")
    )
    .join("\n");
  const flows = graph.flows
    .map((f) => `${nameOf.get(f.source) ?? f.source} -> ${nameOf.get(f.target) ?? f.target}${f.name ? ` (${f.name})` : ""}`)
    .join("\n");
  return `Processo: ${graph.process_name}\n\nAtividades por responsável:\n${perLane}\n\nSequência:\n${flows}`;
}

/** JSON.parse tolerante: o modelo às vezes fecha o objeto com chaves/colchetes a mais no final. */
function parseLooseJson(text: string): unknown {
  let t = text.trim();
  let lastError: unknown;
  for (let i = 0; i < 4; i++) {
    try {
      return JSON.parse(t);
    } catch (e) {
      lastError = e;
      if (!/[}\]]$/.test(t)) break;
      t = t.slice(0, -1).trimEnd();
    }
  }
  throw lastError;
}

class AiFieldError extends Error {
  constructor(message: string, public debugKeys: string[], public stopReason: string) {
    super(message);
  }
}

type Effort = "low" | "medium" | "high";

interface UsageEntry {
  step: string;
  model: string;
  attempt: number;
  input_tokens: number;
  output_tokens: number;
  ok: boolean;
  note?: string;
}

/** Como uma chamada deve ser feita: qual modelo em cada tentativa (o último se repete) e, para os
 *  modelos que suportam, o esforço de raciocínio (o Haiku 4.5 rejeita `effort`). */
interface CallOptions {
  step: string;
  models: string[];
  effort?: Effort;
  usage: UsageEntry[];
}

// US$ por milhão de tokens (tabela de referência da Anthropic, 2026-06-24). Usado só para estimar custo.
const PRICE_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

function summarizeUsage(entries: UsageEntry[]) {
  const cost = (e: UsageEntry) => {
    const p = PRICE_PER_MTOK[e.model] ?? PRICE_PER_MTOK["claude-sonnet-5"];
    return (e.input_tokens * p.input + e.output_tokens * p.output) / 1_000_000;
  };
  const byStep: Record<
    string,
    { model: string; attempts: number; input_tokens: number; output_tokens: number; cost_usd: number; retry_notes: string[] }
  > = {};
  for (const e of entries) {
    const s = (byStep[e.step] ??= { model: e.model, attempts: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0, retry_notes: [] });
    if (e.note) s.retry_notes.push(`tentativa ${e.attempt}: ${e.note}`);
    s.attempts += 1;
    s.input_tokens += e.input_tokens;
    s.output_tokens += e.output_tokens;
    s.cost_usd += cost(e);
    s.model = e.model;
  }
  for (const s of Object.values(byStep)) s.cost_usd = Math.round(s.cost_usd * 1e5) / 1e5;
  return {
    calls: entries.length,
    input_tokens: entries.reduce((a, e) => a + e.input_tokens, 0),
    output_tokens: entries.reduce((a, e) => a + e.output_tokens, 0),
    estimated_cost_usd: Math.round(entries.reduce((a, e) => a + cost(e), 0) * 1e5) / 1e5,
    by_step: byStep,
  };
}

/** Chama a Claude API forçando uma tool call com EXATAMENTE uma propriedade obrigatória no topo
 *  (pedir múltiplos campos numa única chamada mostrou-se pouco confiável), e repete até 3 vezes
 *  quando a IA omite o campo ou devolve uma estrutura incompleta — uma falha intermitente e não
 *  determinística do modelo, não algo que reformular o prompt sozinho elimina. */
async function callClaudeSingleField<T>(
  opts: CallOptions,
  system: string,
  userContent: string | ContentBlock[],
  toolName: string,
  fieldName: string,
  fieldSchema: Record<string, unknown>,
  isValid: (value: T) => boolean = () => true,
  normalize: (value: T) => T = (v) => v
): Promise<T> {
  let lastError: AiFieldError | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const model = opts.models[Math.min(attempt, opts.models.length) - 1];
    try {
      const { value: raw, entry } = await callClaudeSingleFieldOnce<T>(opts, model, attempt, system, userContent, toolName, fieldName, fieldSchema);
      const value = normalize(raw);
      if (!isValid(value)) {
        const shape =
          value && typeof value === "object"
            ? Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k}:${Array.isArray(v) ? "array" : typeof v}`)
            : [typeof value];
        console.log(JSON.stringify({ event: "invalid_structure", step: opts.step, model, attempt, shape }));
        entry.note = [entry.note, `estrutura inválida (${shape.join(", ")})`].filter(Boolean).join(" | ");
        lastError = new AiFieldError(`A IA retornou o campo '${fieldName}' com estrutura incompleta.`, shape, "invalid_structure");
        continue;
      }
      entry.ok = true;
      return value;
    } catch (err) {
      if (!(err instanceof AiFieldError)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

async function callClaudeSingleFieldOnce<T>(
  opts: CallOptions,
  model: string,
  attempt: number,
  system: string,
  userContent: string | ContentBlock[],
  toolName: string,
  fieldName: string,
  fieldSchema: Record<string, unknown>
): Promise<{ value: T; entry: UsageEntry }> {
  const tool = {
    name: toolName,
    description: `Envia o campo '${fieldName}' solicitado.`,
    input_schema: {
      type: "object",
      properties: { [fieldName]: fieldSchema },
      required: [fieldName],
    },
  };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: toolName },
      messages: [{ role: "user", content: userContent }],
      ...(opts.effort && model.startsWith("claude-sonnet") ? { output_config: { effort: opts.effort } } : {}),
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Falha na chamada à Claude API: ${errText}`);
  }

  const data = await response.json();
  const entry: UsageEntry = {
    step: opts.step,
    model,
    attempt,
    input_tokens: data.usage?.input_tokens ?? 0,
    output_tokens: data.usage?.output_tokens ?? 0,
    ok: false,
  };
  opts.usage.push(entry);

  const toolUse = data.content?.find((c: { type: string }) => c.type === "tool_use");
  if (!toolUse || toolUse.input?.[fieldName] === undefined) {
    entry.note = `campo ausente (chaves: ${Object.keys(toolUse?.input ?? {}).join(", ") || "nenhuma"}; parada: ${data.stop_reason})`;
    throw new AiFieldError(
      `A IA não retornou o campo '${fieldName}'.`,
      Object.keys(toolUse?.input ?? {}),
      data.stop_reason
    );
  }
  // O modelo às vezes devolve o objeto/lista inteiro como texto JSON em vez de estruturado.
  let value: unknown = toolUse.input[fieldName];
  if (typeof value === "string" && (fieldSchema.type === "object" || fieldSchema.type === "array")) {
    try {
      value = parseLooseJson(value);
    } catch (parseError) {
      const text = value as string;
      entry.note = `texto JSON inválido (${(parseError as Error).message}; ${text.length} caracteres; início: ${text.slice(0, 100)} | fim: ${text.slice(-100)})`;
    }
  }
  return { value: value as T, entry };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY não configurada nos secrets da função." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const usage: UsageEntry[] = [];
  try {
    const body: RequestBody = await req.json();

    const badRequest = (message: string) =>
      new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    if (body.mode === "transcribe") {
      const problem = imagesProblem(body.images);
      if (problem) return badRequest(problem);
      const description = await callClaudeSingleField<string>(
        { step: "transcribe_images", models: [SONNET], usage },
        TRANSCRIBE_SYSTEM,
        [
          ...body.images!.map(
            (img): ContentBlock => ({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } })
          ),
          { type: "text", text: "Transcreva o processo mostrado nesta(s) imagem(ns)." },
        ],
        "submit_transcription",
        "description",
        { type: "string" },
        (v) => typeof v === "string" && v.trim().length > 20
      );
      const transcribeUsage = summarizeUsage(usage);
      console.log(JSON.stringify({ event: "transcribe_usage", ...transcribeUsage }));
      return new Response(JSON.stringify({ text: description, usage: transcribeUsage }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!body.input || !body.inputType) return badRequest("Campos 'input' e 'inputType' são obrigatórios.");
    if (body.input.length > MAX_INPUT_CHARS) return badRequest("O texto do processo é longo demais.");

    let importedAsIs: RawGraph | undefined;
    if (body.asIsGraph !== undefined) {
      const candidate = normalizeRawGraph(body.input)(body.asIsGraph as RawGraph);
      if (!isValidRawGraph(candidate) || candidate.elements.length < 2 || candidate.elements.length > 150) {
        return badRequest("O diagrama BPMN importado é inválido ou grande demais.");
      }
      importedAsIs = candidate;
    }

    const contextLines = [
      body.inputType === "process_name"
        ? `Nome do processo: ${body.input}`
        : `Lista de atividades informada pelo usuário:\n${body.input}`,
      body.department ? `Departamento/área: ${body.department}` : null,
      body.actors ? `Atores envolvidos: ${body.actors}` : null,
      body.constraintsNotes ? `Restrições/observações: ${body.constraintsNotes}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const baseSystem = `Você é um especialista sênior em BPM (Business Process Management) e gestão de processos de negócio, com décadas de experiência mapeando e simplificando processos organizacionais (inclusive de órgãos públicos).`;


    // 1) Modelar o as-is
    const asIsRaw: RawGraph = importedAsIs ?? (await callClaudeSingleField<RawGraph>(
      { step: "as_is_graph", models: GRAPH_MODELS, usage },
      `${baseSystem}

Modele o processo "as-is" (como está hoje) a partir do que o usuário fornecer (nome de um processo, OU uma lista de atividades).
- Se o usuário deu uma LISTA DE ATIVIDADES, organize-as na sequência lógica mais provável, identificando atores/raias, decisões (gateways) e o fluxo completo.
- Se o usuário deu apenas um NOME DE PROCESSO, proponha um fluxo "as-is" realista e comum para esse tipo de processo, baseado em boas práticas e no contexto informado.
- Sempre inclua ao menos um evento de início e um de fim, atores em raias (lanes) coerentes, e gateways explícitos para decisões.

${MODELING_RULES}

Responda SOMENTE chamando a ferramenta com o campo solicitado.`,
      contextLines,
      "submit_as_is_graph",
      "as_is",
      graphSchema,
      isValidRawGraph,
      normalizeRawGraph(body.inputType === "process_name" ? body.input : "Processo")
    ));

    if (!isValidRawGraph(asIsRaw)) {
      return new Response(JSON.stringify({ error: "A IA retornou uma modelagem as-is incompleta." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const asIsSummaryText = graphSummaryText(asIsRaw);

    // 2) Diagnosticar o as-is
    const diagnosisUserContent = `Contexto original informado pelo usuário:\n${contextLines}\n\nModelagem as-is:\n${asIsSummaryText}`;
    const summary = await callClaudeSingleField<string>(
      { step: "summary", models: TEXT_MODELS, effort: TEXT_EFFORT, usage },
      `${baseSystem}\n\nEscreva um resumo executivo (2-4 frases, em português) do processo e do seu principal problema, com base na modelagem as-is fornecida. Responda SOMENTE chamando a ferramenta com o campo solicitado.`,
      diagnosisUserContent,
      "submit_summary",
      "summary",
      { type: "string" },
      (v) => typeof v === "string" && v.trim().length > 0
    );
    const issuesFound = await callClaudeSingleField<string[]>(
      { step: "issues", models: TEXT_MODELS, effort: TEXT_EFFORT, usage },
      `${baseSystem}\n\nIdentifique, em português, os problemas do processo as-is fornecido (redundâncias, retrabalho, handoffs desnecessários entre atores, gargalos, aprovações redundantes, etapas que não agregam valor). Responda SOMENTE chamando a ferramenta com o campo solicitado.`,
      diagnosisUserContent,
      "submit_issues",
      "issues_found",
      { type: "array", items: { type: "string" } },
      (v) => Array.isArray(v) && v.length > 0
    );

    // 3) Modelar o to-be
    const toBeUserContent = `Contexto original informado pelo usuário:\n${contextLines}\n\nModelagem as-is:\n${asIsSummaryText}\n\nProblemas identificados no as-is:\n${issuesFound
      .map((i) => `- ${i}`)
      .join("\n")}`;

    const toBeRaw = await callClaudeSingleField<RawGraph>(
      { step: "to_be_graph", models: GRAPH_MODELS, usage },
      `${baseSystem}

Proponha a versão "to-be" (simplificada) do processo cuja modelagem as-is e diagnóstico você recebeu, aplicando os princípios ECRS (Eliminar, Combinar, Reorganizar, Simplificar), SEM remover controles/aprovações obrigatórios por lei ou compliance.
O to-be DEVE ter MENOS atividades (task/userTask/serviceTask) do que o as-is e, sempre que possível, menos trocas de raia (handoffs): elimine etapas redundantes, combine etapas do mesmo ator, automatize verificações com serviceTask e remova retrabalho evitável. Mantenha o mesmo nome de processo e, quando fizer sentido, as mesmas raias.

${MODELING_RULES}

Responda SOMENTE chamando a ferramenta com o campo solicitado.`,
      toBeUserContent,
      "submit_to_be_graph",
      "to_be",
      graphSchema,
      isValidRawGraph,
      normalizeRawGraph(asIsRaw.process_name)
    );

    if (!isValidRawGraph(toBeRaw)) {
      return new Response(JSON.stringify({ error: "A IA retornou uma modelagem to-be incompleta." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4) Recomendações do to-be
    const recommendations = await callClaudeSingleField<string[]>(
      { step: "recommendations", models: TEXT_MODELS, effort: TEXT_EFFORT, usage },
      `${baseSystem}\n\nListe, em português, as melhorias aplicadas na versão to-be em relação ao as-is, cada uma citando o princípio ECRS usado (Eliminar/Combinar/Reorganizar/Simplificar). Responda SOMENTE chamando a ferramenta com o campo solicitado.`,
      `Modelagem as-is:\n${asIsSummaryText}\n\nModelagem to-be:\n${graphSummaryText(toBeRaw)}`,
      "submit_recommendations",
      "recommendations",
      { type: "array", items: { type: "string" } },
      (v) => Array.isArray(v) && v.length > 0
    );

    const asIsGraph = sanitizeGraph(toBpmnGraph(asIsRaw));
    const toBeGraph = sanitizeGraph(toBpmnGraph(toBeRaw));
    const asIsXml = buildBpmnXml(asIsGraph);
    const toBeXml = buildBpmnXml(toBeGraph);
    const asIsMetrics = computeGraphMetrics(asIsGraph);
    const toBeMetrics = computeGraphMetrics(toBeGraph);

    const usageSummary = summarizeUsage(usage);
    console.log(JSON.stringify({ event: "analysis_usage", ...usageSummary }));

    return new Response(
      JSON.stringify({
        processName: asIsRaw.process_name,
        asIs: { xml: asIsXml, graph: asIsRaw },
        toBe: { xml: toBeXml, graph: toBeRaw },
        analysis: { summary, issues_found: issuesFound, recommendations },
        metrics: {
          steps_before: asIsMetrics.steps,
          steps_after: toBeMetrics.steps,
          handoffs_before: asIsMetrics.handoffs,
          handoffs_after: toBeMetrics.handoffs,
        },
        usage: usageSummary,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    // Chamadas que falharam também são cobradas: registra o consumo mesmo no erro.
    const failedUsage = summarizeUsage(usage);
    console.log(JSON.stringify({ event: "analysis_failed", error: (error as Error).message, ...failedUsage }));
    if (error instanceof AiFieldError) {
      return new Response(
        JSON.stringify({
          error: error.message,
          debug_keys: error.debugKeys,
          debug_stop_reason: error.stopReason,
          usage: failedUsage,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ error: `Erro inesperado: ${(error as Error).message}` }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
