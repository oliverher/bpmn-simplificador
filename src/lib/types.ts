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

export interface AnalyzeProcessRequest {
  inputType: "process_name" | "activities_list";
  input: string;
  department?: string;
  actors?: string;
  constraintsNotes?: string;
}
