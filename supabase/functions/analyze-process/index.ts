import { buildBpmnXml, type BpmnGraph } from "../_shared/bpmn-builder.ts";

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

const toolSchema = {
  name: "submit_process_analysis",
  description:
    "Envia a modelagem BPMN do processo 'as-is' (como está) e 'to-be' (simplificado), junto da análise e das métricas de melhoria.",
  input_schema: {
    type: "object",
    properties: {
      as_is: graphSchema,
      to_be: graphSchema,
      analysis: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Resumo executivo da análise, em português." },
          issues_found: {
            type: "array",
            items: { type: "string" },
            description: "Problemas identificados no processo as-is (redundâncias, retrabalho, handoffs desnecessários, gargalos).",
          },
          recommendations: {
            type: "array",
            items: { type: "string" },
            description: "Recomendações aplicadas no to-be, cada uma citando o princípio ECRS usado (Eliminar/Combinar/Reorganizar/Simplificar).",
          },
        },
        required: ["summary", "issues_found", "recommendations"],
      },
      metrics: {
        type: "object",
        properties: {
          steps_before: { type: "integer" },
          steps_after: { type: "integer" },
          handoffs_before: { type: "integer" },
          handoffs_after: { type: "integer" },
        },
        required: ["steps_before", "steps_after", "handoffs_before", "handoffs_after"],
      },
    },
    required: ["as_is", "to_be", "analysis", "metrics"],
  },
};

const SYSTEM_PROMPT = `Você é um especialista sênior em BPM (Business Process Management) e gestão de processos de negócio, com décadas de experiência mapeando e simplificando processos organizacionais (inclusive de órgãos públicos).

Sua tarefa: a partir do que o usuário fornecer (nome de um processo, OU uma lista de atividades), você deve:

1. Modelar o processo "as-is":
   - Se o usuário deu uma LISTA DE ATIVIDADES, organize-as na sequência lógica mais provável, identificando atores/raias, decisões (gateways) e o fluxo completo.
   - Se o usuário deu apenas um NOME DE PROCESSO, proponha um fluxo "as-is" realista e comum para esse tipo de processo, baseado em boas práticas e no contexto informado (departamento, atores, restrições).
   - Sempre inclua ao menos um evento de início e um de fim, atores em raias (lanes) coerentes, e gateways explícitos para decisões.

2. Analisar criticamente o as-is: identifique redundâncias, retrabalho, handoffs desnecessários entre atores, gargalos, aprovações redundantes e etapas que não agregam valor.

3. Propor o "to-be": uma versão simplificada aplicando os princípios ECRS (Eliminar, Combinar, Reorganizar, Simplificar), reduzindo etapas e handoffs sempre que possível, SEM remover controles/aprovações que sejam obrigatórios por lei ou compliance (quando aplicável, mantenha-os mas explique a decisão).

4. Calcular métricas simples: número de etapas (elements do tipo task/userTask/serviceTask) e número de handoffs (transições de raia) antes e depois.

Regras de modelagem BPMN:
- IDs devem ser únicos, curtos, sem espaços/acentos (ex: "start1", "task_analise", "gw_aprovado").
- Todo elemento deve pertencer a uma lane existente.
- Todo flow deve referenciar ids de elementos existentes.
- Gateways exclusivos com múltiplas saídas devem nomear cada flow de saída (ex: "Sim"/"Não", "Aprovado"/"Reprovado").
- Nomes de elementos e raias em português, claros e curtos.

Responda SOMENTE chamando a ferramenta "submit_process_analysis" com os dados estruturados. Não escreva texto fora da chamada de ferramenta.`;

interface RequestBody {
  inputType: "process_name" | "activities_list";
  input: string;
  department?: string;
  actors?: string;
  constraintsNotes?: string;
}

function toBpmnGraph(raw: {
  process_name: string;
  lanes: { id: string; name: string }[];
  elements: { id: string; type: string; name: string; lane: string }[];
  flows: { id: string; source: string; target: string; name?: string }[];
}): BpmnGraph {
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

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        tools: [toolSchema],
        tool_choice: { type: "tool", name: "submit_process_analysis" },
        messages: [{ role: "user", content: contextLines }],
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      return new Response(JSON.stringify({ error: `Falha na chamada à Claude API: ${errText}` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anthropicData = await anthropicResponse.json();
    const toolUse = anthropicData.content?.find((c: { type: string }) => c.type === "tool_use");

    if (!toolUse) {
      return new Response(JSON.stringify({ error: "A IA não retornou dados estruturados válidos." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = toolUse.input as {
      as_is: Parameters<typeof toBpmnGraph>[0];
      to_be: Parameters<typeof toBpmnGraph>[0];
      analysis: { summary: string; issues_found: string[]; recommendations: string[] };
      metrics: { steps_before: number; steps_after: number; handoffs_before: number; handoffs_after: number };
    };

    if (!result?.as_is || !result?.to_be) {
      return new Response(
        JSON.stringify({
          error: "Formato inesperado retornado pela IA.",
          debug_tool_input_keys: Object.keys(toolUse.input ?? {}),
          debug_stop_reason: anthropicData.stop_reason,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const asIsXml = buildBpmnXml(toBpmnGraph(result.as_is));
    const toBeXml = buildBpmnXml(toBpmnGraph(result.to_be));

    return new Response(
      JSON.stringify({
        processName: result.as_is.process_name,
        asIs: { xml: asIsXml, graph: result.as_is },
        toBe: { xml: toBeXml, graph: result.to_be },
        analysis: result.analysis,
        metrics: result.metrics,
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
