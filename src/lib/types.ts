export type BpmnElementType =
  | "startEvent"
  | "endEvent"
  | "task"
  | "userTask"
  | "serviceTask"
  | "exclusiveGateway"
  | "parallelGateway";

export interface BpmnLane {
  id: string;
  name: string;
}

export interface BpmnElement {
  id: string;
  type: BpmnElementType;
  name: string;
  lane: string;
}

export interface BpmnFlow {
  id: string;
  source: string;
  target: string;
  name?: string;
}

export interface BpmnGraphResult {
  process_name: string;
  lanes: BpmnLane[];
  elements: BpmnElement[];
  flows: BpmnFlow[];
}

export interface ProcessAnalysisResult {
  processName: string;
  asIs: { xml: string; graph: BpmnGraphResult };
  toBe: { xml: string; graph: BpmnGraphResult };
  analysis: {
    summary: string;
    issues_found: string[];
    recommendations: string[];
  };
  metrics: {
    steps_before: number;
    steps_after: number;
    handoffs_before: number;
    handoffs_after: number;
  };
}

export interface ImageInput {
  media_type: string;
  /** base64 sem o prefixo "data:" */
  data: string;
}

export interface AnalyzeProcessRequest {
  /** "transcribe" só lê as imagens e devolve o texto do processo; "analyze" (padrão) faz a análise completa. */
  mode?: "analyze" | "transcribe";
  inputType: "process_name" | "activities_list";
  input: string;
  images?: ImageInput[];
  /** Processo atual já modelado (vindo de um arquivo BPMN importado): dispensa a modelagem do as-is. */
  asIsGraph?: BpmnGraphResult;
  department?: string;
  actors?: string;
  constraintsNotes?: string;
}
