// Gera BPMN 2.0 XML (com pool/lanes e layout automático) a partir de um JSON estruturado.
// Sem dependências externas para rodar em Deno (Supabase Edge Functions).

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

export interface BpmnGraph {
  processName: string;
  lanes: BpmnLane[];
  elements: BpmnElement[];
  flows: BpmnFlow[];
}

const NODE_SIZE: Record<BpmnElementType, { width: number; height: number }> = {
  startEvent: { width: 36, height: 36 },
  endEvent: { width: 36, height: 36 },
  task: { width: 100, height: 80 },
  userTask: { width: 100, height: 80 },
  serviceTask: { width: 100, height: 80 },
  exclusiveGateway: { width: 50, height: 50 },
  parallelGateway: { width: 50, height: 50 },
};

const TAG: Record<BpmnElementType, string> = {
  startEvent: "bpmn:startEvent",
  endEvent: "bpmn:endEvent",
  task: "bpmn:task",
  userTask: "bpmn:userTask",
  serviceTask: "bpmn:serviceTask",
  exclusiveGateway: "bpmn:exclusiveGateway",
  parallelGateway: "bpmn:parallelGateway",
};

function escapeXml(value: string | undefined | null): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function computeLevels(elements: BpmnElement[], flows: BpmnFlow[]): Map<string, number> {
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const el of elements) {
    incoming.set(el.id, []);
    outgoing.set(el.id, []);
  }
  for (const f of flows) {
    outgoing.get(f.source)?.push(f.target);
    incoming.get(f.target)?.push(f.source);
  }

  const levels = new Map<string, number>();
  const starts = elements.filter((e) => (incoming.get(e.id)?.length ?? 0) === 0);
  const queue: string[] = starts.length > 0 ? starts.map((s) => s.id) : elements.slice(0, 1).map((e) => e.id);
  for (const id of queue) levels.set(id, 0);

  let head = 0;
  const visitedEdgesCount = new Map<string, number>();
  while (head < queue.length) {
    const id = queue[head++];
    const level = levels.get(id) ?? 0;
    for (const next of outgoing.get(id) ?? []) {
      const proposed = level + 1;
      const current = levels.get(next);
      if (current === undefined || proposed > current) {
        levels.set(next, proposed);
      }
      const seen = (visitedEdgesCount.get(next) ?? 0) + 1;
      visitedEdgesCount.set(next, seen);
      const totalIncoming = incoming.get(next)?.length ?? 0;
      if (seen >= totalIncoming && !queue.includes(next)) {
        queue.push(next);
      }
    }
  }

  for (const el of elements) {
    if (!levels.has(el.id)) levels.set(el.id, 0);
  }
  return levels;
}

export function buildBpmnXml(graph: BpmnGraph): string {
  const processId = "Process_1";
  const collaborationId = "Collaboration_1";
  const participantId = "Participant_1";

  const laneIndex = new Map(graph.lanes.map((l, i) => [l.id, i]));
  const levels = computeLevels(graph.elements, graph.flows);

  const laneHeight = 150;
  const colWidth = 170;
  const marginLeft = 220;
  const marginTop = 40;
  const laneLabelWidth = 30;

  const maxLevel = Math.max(0, ...Array.from(levels.values()));
  const poolWidth = marginLeft + (maxLevel + 1) * colWidth + 60;
  const poolHeight = graph.lanes.length * laneHeight;

  const nodeBounds = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const el of graph.elements) {
    const size = NODE_SIZE[el.type] ?? NODE_SIZE.task;
    const lIdx = laneIndex.get(el.lane) ?? 0;
    const level = levels.get(el.id) ?? 0;
    const x = marginLeft + level * colWidth;
    const laneCenterY = lIdx * laneHeight + laneHeight / 2;
    const y = laneCenterY - size.height / 2;
    nodeBounds.set(el.id, { x, y, width: size.width, height: size.height });
  }

  const flowNodesByLane = new Map<string, string[]>();
  for (const lane of graph.lanes) flowNodesByLane.set(lane.id, []);
  for (const el of graph.elements) {
    flowNodesByLane.get(el.lane)?.push(el.id);
  }

  const laneXml = graph.lanes
    .map(
      (lane) => `      <bpmn:lane id="${lane.id}" name="${escapeXml(lane.name)}">
${(flowNodesByLane.get(lane.id) ?? [])
  .map((id) => `        <bpmn:flowNodeRef>${id}</bpmn:flowNodeRef>`)
  .join("\n")}
      </bpmn:lane>`
    )
    .join("\n");

  const flowsBySource = new Map<string, string[]>();
  const flowsByTarget = new Map<string, string[]>();
  for (const f of graph.flows) {
    if (!flowsBySource.has(f.source)) flowsBySource.set(f.source, []);
    flowsBySource.get(f.source)!.push(f.id);
    if (!flowsByTarget.has(f.target)) flowsByTarget.set(f.target, []);
    flowsByTarget.get(f.target)!.push(f.id);
  }

  const elementsXml = graph.elements
    .map((el) => {
      const tag = TAG[el.type] ?? "bpmn:task";
      const incomingIds = flowsByTarget.get(el.id) ?? [];
      const outgoingIds = flowsBySource.get(el.id) ?? [];
      const incomingXml = incomingIds.map((id) => `      <bpmn:incoming>${id}</bpmn:incoming>`).join("\n");
      const outgoingXml = outgoingIds.map((id) => `      <bpmn:outgoing>${id}</bpmn:outgoing>`).join("\n");
      return `    <${tag} id="${el.id}" name="${escapeXml(el.name)}">
${incomingXml}${incomingXml ? "\n" : ""}${outgoingXml}
    </${tag}>`;
    })
    .join("\n");

  const sequenceFlowsXml = graph.flows
    .map(
      (f) =>
        `    <bpmn:sequenceFlow id="${f.id}" name="${escapeXml(f.name ?? "")}" sourceRef="${f.source}" targetRef="${f.target}" />`
    )
    .join("\n");

  const laneShapesXml = graph.lanes
    .map((lane, idx) => {
      const y = marginTop + idx * laneHeight;
      return `      <bpmndi:BPMNShape id="${lane.id}_di" bpmnElement="${lane.id}" isHorizontal="true">
        <dc:Bounds x="${marginLeft - laneLabelWidth}" y="${y}" width="${poolWidth - (marginLeft - laneLabelWidth)}" height="${laneHeight}" />
      </bpmndi:BPMNShape>`;
    })
    .join("\n");

  const nodeShapesXml = graph.elements
    .map((el) => {
      const b = nodeBounds.get(el.id)!;
      const isLabelBelow = el.type.includes("Gateway") || el.type.includes("Event");
      const labelXml = isLabelBelow
        ? `\n        <bpmndi:BPMNLabel>\n          <dc:Bounds x="${b.x - 20}" y="${b.y + b.height + 5}" width="${b.width + 40}" height="27" />\n        </bpmndi:BPMNLabel>`
        : "";
      return `      <bpmndi:BPMNShape id="${el.id}_di" bpmnElement="${el.id}">
        <dc:Bounds x="${b.x}" y="${b.y + marginTop}" width="${b.width}" height="${b.height}" />${labelXml}
      </bpmndi:BPMNShape>`;
    })
    .join("\n");

  const edgesXml = graph.flows
    .map((f) => {
      const s = nodeBounds.get(f.source)!;
      const t = nodeBounds.get(f.target)!;
      const sx = s.x + s.width;
      const sy = s.y + marginTop + s.height / 2;
      const tx = t.x;
      const ty = t.y + marginTop + t.height / 2;
      return `      <bpmndi:BPMNEdge id="${f.id}_di" bpmnElement="${f.id}">
        <di:waypoint x="${sx}" y="${sy}" />
        <di:waypoint x="${tx}" y="${ty}" />
      </bpmndi:BPMNEdge>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="${collaborationId}">
    <bpmn:participant id="${participantId}" name="${escapeXml(graph.processName)}" processRef="${processId}" />
  </bpmn:collaboration>
  <bpmn:process id="${processId}" isExecutable="false">
    <bpmn:laneSet id="LaneSet_1">
${laneXml}
    </bpmn:laneSet>
${elementsXml}
${sequenceFlowsXml}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="${collaborationId}">
      <bpmndi:BPMNShape id="${participantId}_di" bpmnElement="${participantId}" isHorizontal="true">
        <dc:Bounds x="${marginLeft - laneLabelWidth}" y="${marginTop}" width="${poolWidth - (marginLeft - laneLabelWidth)}" height="${poolHeight}" />
      </bpmndi:BPMNShape>
${laneShapesXml}
${nodeShapesXml}
${edgesXml}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}
