import { buildBpmnXml, computeGraphMetrics, sanitizeGraph, type BpmnGraph } from "../_shared/bpmn-builder.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL = "claude-sonnet-5";

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
  inputType: "process_name" | "activities_list";
  input: string;
  department?: string;
  actors?: string;
  constraintsNotes?: string;
}

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

function isValidRawGraph(graph: unknown): graph is RawGraph {
  const g = graph as RawGraph | undefined;
  return !!g && typeof g.process_name === "string" && Array.isArray(g.lanes) && Array.isArray(g.elements) && Array.isArray(g.flows);
}

function graphSummaryText(graph: RawGraph): string {
  const lanesText = graph.lanes.map((l) => `${l.id} (${l.name})`).join(", ");
  const elementsText = graph.elements.map((e) => `${e.id} [${e.type}] "${e.name}" (lane: ${e.lane})`).join("\n");
  const flowsText = graph.flows.map((f) => `${f.source} -> ${f.target}${f.name ? ` (${f.name})` : ""}`).join("\n");
  return `Processo: ${graph.process_name}\n\nRaias: ${lanesText}\n\nElementos:\n${elementsText}\n\nFluxos:\n${flowsText}`;
}

class AiFieldError extends Error {
  constructor(message: string, public debugKeys: string[], public stopReason: string) {
    super(message);
  }
}

/** Chama a Claude API forçando uma tool call com EXATAMENTE uma propriedade obrigatória no topo
 *  (pedir múltiplos campos numa única chamada mostrou-se pouco confiável), e repete até 3 vezes
 *  quando a IA omite o campo ou devolve uma estrutura incompleta — uma falha intermitente e não
 *  determinística do modelo, não algo que reformular o prompt sozinho elimina. */
async function callClaudeSingleField<T>(
  system: string,
  userContent: string,
  toolName: string,
  fieldName: string,
  fieldSchema: Record<string, unknown>,
  isValid: (value: T) => boolean = () => true
): Promise<T> {
  let lastError: AiFieldError | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const value = await callClaudeSingleFieldOnce<T>(system, userContent, toolName, fieldName, fieldSchema);
      if (!isValid(value)) {
        lastError = new AiFieldError(`A IA retornou o campo '${fieldName}' com estrutura incompleta.`, [fieldName], "invalid_structure");
        continue;
      }
      return value;
    } catch (err) {
      if (!(err instanceof AiFieldError)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

async function callClaudeSingleFieldOnce<T>(
  system: string,
  userContent: string,
  toolName: string,
  fieldName: string,
  fieldSchema: Record<string, unknown>
): Promise<T> {
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
      model: ANTHROPIC_MODEL,
      max_tokens: 8000,
      system,
      tools: [tool],
      tool_choice: { type: "tool", name: toolName },
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Falha na chamada à Claude API: ${errText}`);
  }

  const data = await response.json();
  const toolUse = data.content?.find((c: { type: string }) => c.type === "tool_use");
  if (!toolUse || toolUse.input?.[fieldName] === undefined) {
    throw new AiFieldError(
      `A IA não retornou o campo '${fieldName}'.`,
      Object.keys(toolUse?.input ?? {}),
      data.stop_reason
    );
  }
  return toolUse.input[fieldName] as T;
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

  try {
    const body: RequestBody = await req.json();

    if (!body.input || !body.inputType) {
      return new Response(JSON.stringify({ error: "Campos 'input' e 'inputType' são obrigatórios." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
    const asIsRaw = await callClaudeSingleField<RawGraph>(
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
      isValidRawGraph
    );

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
      `${baseSystem}\n\nEscreva um resumo executivo (2-4 frases, em português) do processo e do seu principal problema, com base na modelagem as-is fornecida. Responda SOMENTE chamando a ferramenta com o campo solicitado.`,
      diagnosisUserContent,
      "submit_summary",
      "summary",
      { type: "string" },
      (v) => typeof v === "string" && v.trim().length > 0
    );
    const issuesFound = await callClaudeSingleField<string[]>(
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
      `${baseSystem}

Proponha a versão "to-be" (simplificada) do processo cuja modelagem as-is e diagnóstico você recebeu, aplicando os princípios ECRS (Eliminar, Combinar, Reorganizar, Simplificar), SEM remover controles/aprovações obrigatórios por lei ou compliance.
O to-be DEVE ter MENOS atividades (task/userTask/serviceTask) do que o as-is e, sempre que possível, menos trocas de raia (handoffs): elimine etapas redundantes, combine etapas do mesmo ator, automatize verificações com serviceTask e remova retrabalho evitável. Mantenha o mesmo nome de processo e, quando fizer sentido, as mesmas raias.

${MODELING_RULES}

Responda SOMENTE chamando a ferramenta com o campo solicitado.`,
      toBeUserContent,
      "submit_to_be_graph",
      "to_be",
      graphSchema,
      isValidRawGraph
    );

    if (!isValidRawGraph(toBeRaw)) {
      return new Response(JSON.stringify({ error: "A IA retornou uma modelagem to-be incompleta." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4) Recomendações do to-be
    const recommendations = await callClaudeSingleField<string[]>(
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
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    if (error instanceof AiFieldError) {
      return new Response(
        JSON.stringify({ error: error.message, debug_keys: error.debugKeys, debug_stop_reason: error.stopReason }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ error: `Erro inesperado: ${(error as Error).message}` }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
