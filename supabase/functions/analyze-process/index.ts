import { buildBpmnXml, computeGraphMetrics, type BpmnGraph } from "../_shared/bpmn-builder.ts";

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

const asIsToolSchema = {
  name: "submit_as_is",
  description: "Envia a modelagem BPMN do processo 'as-is' (como está hoje) e o diagnóstico dos problemas encontrados.",
  input_schema: {
    type: "object",
    properties: {
      as_is: graphSchema,
      summary: { type: "string", description: "Resumo executivo do processo e do diagnóstico, em português." },
      issues_found: {
        type: "array",
        items: { type: "string" },
        description: "Problemas identificados no as-is (redundâncias, retrabalho, handoffs desnecessários, gargalos, aprovações redundantes).",
      },
    },
    required: ["as_is", "summary", "issues_found"],
  },
};

const toBeToolSchema = {
  name: "submit_to_be",
  description: "Envia a modelagem BPMN do processo 'to-be' (simplificado) e as melhorias aplicadas.",
  input_schema: {
    type: "object",
    properties: {
      to_be: graphSchema,
      recommendations: {
        type: "array",
        items: { type: "string" },
        description: "Melhorias aplicadas no to-be, cada uma citando o princípio ECRS usado (Eliminar/Combinar/Reorganizar/Simplificar).",
      },
    },
    required: ["to_be", "recommendations"],
  },
};

const MODELING_RULES = `Regras de modelagem BPMN:
- IDs devem ser únicos, curtos, sem espaços/acentos (ex: "start1", "task_analise", "gw_aprovado").
- Todo elemento deve pertencer a uma lane existente.
- Todo flow deve referenciar ids de elementos existentes.
- Gateways exclusivos com múltiplas saídas devem nomear cada flow de saída (ex: "Sim"/"Não", "Aprovado"/"Reprovado").
- Nomes de elementos e raias em português, claros e curtos.`;

const AS_IS_SYSTEM_PROMPT = `Você é um especialista sênior em BPM (Business Process Management) e gestão de processos de negócio, com décadas de experiência mapeando processos organizacionais (inclusive de órgãos públicos).

Sua tarefa: a partir do que o usuário fornecer (nome de um processo, OU uma lista de atividades), modele o processo "as-is" (como está hoje) e diagnostique seus problemas.

- Se o usuário deu uma LISTA DE ATIVIDADES, organize-as na sequência lógica mais provável, identificando atores/raias, decisões (gateways) e o fluxo completo.
- Se o usuário deu apenas um NOME DE PROCESSO, proponha um fluxo "as-is" realista e comum para esse tipo de processo, baseado em boas práticas e no contexto informado (departamento, atores, restrições).
- Sempre inclua ao menos um evento de início e um de fim, atores em raias (lanes) coerentes, e gateways explícitos para decisões.
- Identifique redundâncias, retrabalho, handoffs desnecessários entre atores, gargalos, aprovações redundantes e etapas que não agregam valor.

${MODELING_RULES}

Responda SOMENTE chamando a ferramenta "submit_as_is" com os dados estruturados. Não escreva texto fora da chamada de ferramenta.`;

const TO_BE_SYSTEM_PROMPT = `Você é um especialista sênior em BPM (Business Process Management), com décadas de experiência simplificando processos organizacionais (inclusive de órgãos públicos).

Você receberá a modelagem BPMN "as-is" (como está hoje) de um processo e o diagnóstico dos problemas encontrados. Sua tarefa é propor a versão "to-be": uma versão simplificada aplicando os princípios ECRS (Eliminar, Combinar, Reorganizar, Simplificar), reduzindo etapas e handoffs sempre que possível, SEM remover controles/aprovações que sejam obrigatórios por lei ou compliance (quando aplicável, mantenha-os mas explique a decisão na recomendação).

${MODELING_RULES}

Responda SOMENTE chamando a ferramenta "submit_to_be" com os dados estruturados. Não escreva texto fora da chamada de ferramenta.`;

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

async function callClaudeTool(system: string, userContent: string, tool: Record<string, unknown>) {
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
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Falha na chamada à Claude API: ${errText}`);
  }

  const data = await response.json();
  const toolUse = data.content?.find((c: { type: string }) => c.type === "tool_use");
  if (!toolUse) {
    throw new Error("A IA não retornou dados estruturados válidos.");
  }
  return toolUse.input;
}

function graphSummaryText(graph: RawGraph): string {
  const lanesText = graph.lanes.map((l) => `${l.id} (${l.name})`).join(", ");
  const elementsText = graph.elements.map((e) => `${e.id} [${e.type}] "${e.name}" (lane: ${e.lane})`).join("\n");
  const flowsText = graph.flows.map((f) => `${f.source} -> ${f.target}${f.name ? ` (${f.name})` : ""}`).join("\n");
  return `Processo: ${graph.process_name}\n\nRaias: ${lanesText}\n\nElementos:\n${elementsText}\n\nFluxos:\n${flowsText}`;
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

    let asIsResult: { as_is: RawGraph; summary: string; issues_found: string[] };
    try {
      asIsResult = await callClaudeTool(AS_IS_SYSTEM_PROMPT, contextLines, asIsToolSchema);
    } catch (err) {
      return new Response(JSON.stringify({ error: (err as Error).message }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!asIsResult?.as_is) {
      return new Response(
        JSON.stringify({ error: "A IA não retornou a modelagem as-is.", debug_keys: Object.keys(asIsResult ?? {}) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const toBeUserContent = `Contexto original informado pelo usuário:\n${contextLines}\n\nModelagem as-is já feita:\n${graphSummaryText(
      asIsResult.as_is
    )}\n\nProblemas já identificados no as-is:\n${asIsResult.issues_found.map((i) => `- ${i}`).join("\n")}`;

    let toBeResult: { to_be: RawGraph; recommendations: string[] };
    try {
      toBeResult = await callClaudeTool(TO_BE_SYSTEM_PROMPT, toBeUserContent, toBeToolSchema);
    } catch (err) {
      return new Response(JSON.stringify({ error: (err as Error).message }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!toBeResult?.to_be) {
      return new Response(
        JSON.stringify({ error: "A IA não retornou a modelagem to-be.", debug_keys: Object.keys(toBeResult ?? {}) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const asIsGraph = toBpmnGraph(asIsResult.as_is);
    const toBeGraph = toBpmnGraph(toBeResult.to_be);
    const asIsXml = buildBpmnXml(asIsGraph);
    const toBeXml = buildBpmnXml(toBeGraph);
    const asIsMetrics = computeGraphMetrics(asIsGraph);
    const toBeMetrics = computeGraphMetrics(toBeGraph);

    return new Response(
      JSON.stringify({
        processName: asIsResult.as_is.process_name,
        asIs: { xml: asIsXml, graph: asIsResult.as_is },
        toBe: { xml: toBeXml, graph: toBeResult.to_be },
        analysis: {
          summary: asIsResult.summary,
          issues_found: asIsResult.issues_found,
          recommendations: toBeResult.recommendations,
        },
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
    return new Response(JSON.stringify({ error: `Erro inesperado: ${(error as Error).message}` }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
