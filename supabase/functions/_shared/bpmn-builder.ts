// Gera BPMN 2.0 XML (pool, raias, layout automático em camadas e conexões ortogonais)
// a partir de um JSON estruturado. Sem dependências externas (roda em Deno).

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

const TASK_W = 120;
const TASK_H = 80;

const NODE_SIZE: Record<BpmnElementType, { w: number; h: number }> = {
  startEvent: { w: 36, h: 36 },
  endEvent: { w: 36, h: 36 },
  task: { w: TASK_W, h: TASK_H },
  userTask: { w: TASK_W, h: TASK_H },
  serviceTask: { w: TASK_W, h: TASK_H },
  exclusiveGateway: { w: 50, h: 50 },
  parallelGateway: { w: 50, h: 50 },
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

const STEP_TYPES: BpmnElementType[] = ["task", "userTask", "serviceTask"];
const GATEWAY_TYPES: BpmnElementType[] = ["exclusiveGateway", "parallelGateway"];

const POOL_X = 30;
const POOL_Y = 30;
const POOL_LABEL_W = 30;
const LANE_LABEL_W = 30;
const PAD_LEFT = 40;
const PAD_RIGHT = 40;
const COL_W = 190;
const ROW_PITCH = 120;
const CHANNEL_OFFSET = 50;

function escapeXml(value: string | undefined | null): string {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Garante ids XML válidos e únicos, referências consistentes e remove itens órfãos. */
export function sanitizeGraph(input: BpmnGraph): BpmnGraph {
  const used = new Set<string>([
    "Definitions_1",
    "Collaboration_1",
    "Participant_1",
    "Process_1",
    "LaneSet_1",
    "Diagram_1",
    "Plane_1",
  ]);
  const uniqueId = (raw: unknown, prefix: string, index: number): string => {
    let id = String(raw ?? "").replace(/[^A-Za-z0-9_.-]/g, "_");
    if (!id || !/^[A-Za-z_]/.test(id)) id = `${prefix}_${id || index + 1}`;
    let candidate = id;
    let n = 2;
    while (used.has(candidate)) candidate = `${id}_${n++}`;
    used.add(candidate);
    return candidate;
  };

  const laneIdMap = new Map<string, string>();
  const lanes: BpmnLane[] = [];
  (input.lanes ?? []).forEach((l, i) => {
    const id = uniqueId(l.id, "lane", i);
    if (!laneIdMap.has(String(l.id))) laneIdMap.set(String(l.id), id);
    lanes.push({ id, name: l.name || id });
  });
  if (lanes.length === 0) {
    lanes.push({ id: uniqueId("lane", "lane", 0), name: "Processo" });
  }

  const elementIdMap = new Map<string, string>();
  const elements: BpmnElement[] = [];
  (input.elements ?? []).forEach((e, i) => {
    const id = uniqueId(e.id, "el", i);
    if (!elementIdMap.has(String(e.id))) elementIdMap.set(String(e.id), id);
    const type = (e.type in NODE_SIZE ? e.type : "task") as BpmnElementType;
    elements.push({ id, type, name: e.name ?? "", lane: laneIdMap.get(String(e.lane)) ?? lanes[0].id });
  });

  const flows: BpmnFlow[] = [];
  const seenPairs = new Set<string>();
  (input.flows ?? []).forEach((f, i) => {
    const source = elementIdMap.get(String(f.source));
    const target = elementIdMap.get(String(f.target));
    if (!source || !target || source === target) return;
    const pair = `${source}->${target}`;
    if (seenPairs.has(pair)) return;
    seenPairs.add(pair);
    flows.push({ id: uniqueId(f.id, "flow", i), source, target, name: f.name });
  });

  const usedLaneIds = new Set(elements.map((e) => e.lane));
  const nonEmptyLanes = lanes.filter((l) => usedLaneIds.has(l.id));

  return {
    processName: input.processName || "Processo",
    lanes: nonEmptyLanes.length > 0 ? nonEmptyLanes : lanes,
    elements,
    flows,
  };
}

export function computeGraphMetrics(graph: BpmnGraph): { steps: number; handoffs: number } {
  const steps = graph.elements.filter((el) => STEP_TYPES.includes(el.type)).length;
  const laneOf = new Map(graph.elements.map((el) => [el.id, el.lane]));
  const handoffs = graph.flows.filter((f) => {
    const sourceLane = laneOf.get(f.source);
    const targetLane = laneOf.get(f.target);
    return sourceLane !== undefined && targetLane !== undefined && sourceLane !== targetLane;
  }).length;
  return { steps, handoffs };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Pt {
  x: number;
  y: number;
}

interface Layout {
  rects: Map<string, Rect>;
  lanes: { id: string; rect: Rect }[];
  pool: Rect;
  routes: Map<string, Pt[]>;
}

function layoutGraph(g: BpmnGraph): Layout {
  const els = g.elements;
  const byId = new Map(els.map((e) => [e.id, e]));
  const outs = new Map<string, BpmnFlow[]>(els.map((e) => [e.id, []]));
  const ins = new Map<string, BpmnFlow[]>(els.map((e) => [e.id, []]));
  for (const f of g.flows) {
    outs.get(f.source)!.push(f);
    ins.get(f.target)!.push(f);
  }

  // 1) Identifica laços de retrabalho (arestas de retorno) por DFS a partir dos inícios.
  const state = new Map<string, number>();
  const back = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const f of outs.get(id)!) {
      const st = state.get(f.target) ?? 0;
      if (st === 1) back.add(f.id);
      else if (st === 0) visit(f.target);
    }
    state.set(id, 2);
  };
  const roots = [
    ...els.filter((e) => e.type === "startEvent"),
    ...els.filter((e) => ins.get(e.id)!.length === 0),
    ...els,
  ];
  for (const r of roots) if (!state.has(r.id)) visit(r.id);

  // 2) Camadas (colunas) por caminho mais longo no grafo sem as arestas de retorno.
  const fwdOuts = new Map<string, BpmnFlow[]>(els.map((e) => [e.id, []]));
  const fwdIns = new Map<string, BpmnFlow[]>(els.map((e) => [e.id, []]));
  const indeg = new Map<string, number>(els.map((e) => [e.id, 0]));
  for (const f of g.flows) {
    if (back.has(f.id)) continue;
    fwdOuts.get(f.source)!.push(f);
    fwdIns.get(f.target)!.push(f);
    indeg.set(f.target, (indeg.get(f.target) ?? 0) + 1);
  }
  const layer = new Map<string, number>(els.map((e) => [e.id, 0]));
  const queue = els.filter((e) => indeg.get(e.id) === 0).map((e) => e.id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const f of fwdOuts.get(id)!) {
      layer.set(f.target, Math.max(layer.get(f.target)!, layer.get(id)! + 1));
      indeg.set(f.target, indeg.get(f.target)! - 1);
      if (indeg.get(f.target) === 0) queue.push(f.target);
    }
  }
  const maxLayer = Math.max(0, ...Array.from(layer.values()));

  // 3) Linha dentro da raia: alinha com o predecessor da mesma raia; ramos paralelos empilham.
  const laneIndex = new Map(g.lanes.map((l, i) => [l.id, i]));
  const row = new Map<string, number>();
  for (let L = 0; L <= maxLayer; L++) {
    for (let li = 0; li < g.lanes.length; li++) {
      const group = els.filter((e) => layer.get(e.id) === L && laneIndex.get(e.lane) === li);
      if (group.length === 0) continue;
      const preferred = (e: BpmnElement) => {
        const rows = fwdIns
          .get(e.id)!
          .map((f) => byId.get(f.source)!)
          .filter((p) => p.lane === e.lane && row.has(p.id))
          .map((p) => row.get(p.id)!);
        return rows.length > 0 ? Math.round(rows.reduce((a, b) => a + b, 0) / rows.length) : 0;
      };
      const ordered = group.map((e, i) => ({ e, i, p: preferred(e) })).sort((a, b) => a.p - b.p || a.i - b.i);
      const taken = new Set<number>();
      for (const { e, p } of ordered) {
        let r = p;
        while (taken.has(r)) r++;
        taken.add(r);
        row.set(e.id, r);
      }
    }
  }

  // 4) Geometria: altura de cada raia depende de quantas linhas ela precisa.
  const laneRows = g.lanes.map((l) => {
    const rows = els.filter((e) => e.lane === l.id).map((e) => row.get(e.id)!);
    return Math.max(1, ...rows.map((r) => r + 1));
  });
  const laneTops: number[] = [];
  let cursor = POOL_Y;
  for (const r of laneRows) {
    laneTops.push(cursor);
    cursor += r * ROW_PITCH;
  }
  const totalH = cursor - POOL_Y;
  const laneX = POOL_X + POOL_LABEL_W;
  const contentX0 = laneX + LANE_LABEL_W + PAD_LEFT;
  const laneW = LANE_LABEL_W + PAD_LEFT + maxLayer * COL_W + TASK_W + PAD_RIGHT;

  const rects = new Map<string, Rect>();
  for (const e of els) {
    const size = NODE_SIZE[e.type];
    const cx = contentX0 + TASK_W / 2 + layer.get(e.id)! * COL_W;
    const cy = laneTops[laneIndex.get(e.lane)!] + (row.get(e.id)! + 0.5) * ROW_PITCH;
    rects.set(e.id, { x: Math.round(cx - size.w / 2), y: Math.round(cy - size.h / 2), w: size.w, h: size.h });
  }

  // 5) Roteamento ortogonal, evitando atravessar outros elementos.
  const PAD = 6;
  const segmentHits = (a: Pt, b: Pt, ignore: Set<string>) => {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    for (const [id, r] of rects) {
      if (ignore.has(id)) continue;
      if (r.x - PAD < maxX && r.x + r.w + PAD > minX && r.y - PAD < maxY && r.y + r.h + PAD > minY) return true;
    }
    return false;
  };
  const routeClear = (pts: Pt[], ignore: Set<string>) => {
    for (let i = 0; i < pts.length - 1; i++) if (segmentHits(pts[i], pts[i + 1], ignore)) return false;
    return true;
  };

  const routes = new Map<string, Pt[]>();
  const backChannelUse = new Map<number, number>();
  for (const f of g.flows) {
    const s = rects.get(f.source)!;
    const t = rects.get(f.target)!;
    const ignore = new Set([f.source, f.target]);
    const sourceEl = byId.get(f.source)!;
    const isFork = GATEWAY_TYPES.includes(sourceEl.type) && outs.get(f.source)!.length > 1;

    if (back.has(f.id) || layer.get(f.target)! <= layer.get(f.source)!) {
      const scx = s.x + s.w / 2;
      const tcx = t.x + t.w / 2;
      const rowCenter = Math.max(s.y + s.h / 2, t.y + t.h / 2);
      const key = Math.round(rowCenter);
      const k = backChannelUse.get(key) ?? 0;
      backChannelUse.set(key, k + 1);
      // Fica abaixo do rótulo de gateways/eventos (≈ +51) e acima da borda da raia (+60).
      const ch = rowCenter + 56 - Math.min(k, 3) * 4;
      routes.set(f.id, [
        { x: scx, y: s.y + s.h },
        { x: scx, y: ch },
        { x: tcx, y: ch },
        { x: tcx, y: t.y + t.h },
      ]);
      continue;
    }

    const sx = s.x + s.w;
    const sy = s.y + s.h / 2;
    const tx = t.x;
    const ty = t.y + t.h / 2;
    const clampX = (x: number) => Math.min(Math.max(x, sx + 10), tx - 10);

    const candidates: Pt[][] = [];
    if (Math.abs(sy - ty) < 1) {
      candidates.push([{ x: sx, y: sy }, { x: tx, y: ty }]);
    } else {
      const nearMerge = clampX(tx - 30);
      const nearFork = clampX(sx + 30);
      const first = isFork ? nearFork : nearMerge;
      const second = isFork ? nearMerge : nearFork;
      for (const m of [first, second]) {
        candidates.push([{ x: sx, y: sy }, { x: m, y: sy }, { x: m, y: ty }, { x: tx, y: ty }]);
      }
    }
    const chY = ty >= sy ? sy + CHANNEL_OFFSET : sy - CHANNEL_OFFSET;
    const f1 = clampX(sx + 25);
    const f2 = Math.max(f1 + 4, clampX(tx - 25));
    candidates.push([
      { x: sx, y: sy },
      { x: f1, y: sy },
      { x: f1, y: chY },
      { x: f2, y: chY },
      { x: f2, y: ty },
      { x: tx, y: ty },
    ]);
    routes.set(f.id, candidates.find((c) => routeClear(c, ignore)) ?? candidates[candidates.length - 1]);
  }

  return {
    rects,
    lanes: g.lanes.map((l, i) => ({
      id: l.id,
      rect: { x: laneX, y: laneTops[i], w: laneW, h: laneRows[i] * ROW_PITCH },
    })),
    pool: { x: POOL_X, y: POOL_Y, w: POOL_LABEL_W + laneW, h: totalH },
    routes,
  };
}

export function buildBpmnXml(input: BpmnGraph): string {
  const graph = sanitizeGraph(input);
  const layout = layoutGraph(graph);

  const processId = "Process_1";
  const collaborationId = "Collaboration_1";
  const participantId = "Participant_1";

  const nodesByLane = new Map<string, string[]>(graph.lanes.map((l) => [l.id, []]));
  for (const el of graph.elements) nodesByLane.get(el.lane)?.push(el.id);

  const laneXml = graph.lanes
    .map(
      (lane) => `      <bpmn:lane id="${lane.id}" name="${escapeXml(lane.name)}">
${(nodesByLane.get(lane.id) ?? []).map((id) => `        <bpmn:flowNodeRef>${id}</bpmn:flowNodeRef>`).join("\n")}
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
      const tag = TAG[el.type];
      const incoming = (flowsByTarget.get(el.id) ?? []).map((id) => `      <bpmn:incoming>${id}</bpmn:incoming>`);
      const outgoing = (flowsBySource.get(el.id) ?? []).map((id) => `      <bpmn:outgoing>${id}</bpmn:outgoing>`);
      const children = [...incoming, ...outgoing].join("\n");
      return `    <${tag} id="${el.id}" name="${escapeXml(el.name)}">${children ? `\n${children}\n    ` : ""}</${tag}>`;
    })
    .join("\n");

  const sequenceFlowsXml = graph.flows
    .map((f) => {
      const nameAttr = f.name ? ` name="${escapeXml(f.name)}"` : "";
      return `    <bpmn:sequenceFlow id="${f.id}"${nameAttr} sourceRef="${f.source}" targetRef="${f.target}" />`;
    })
    .join("\n");

  const laneShapesXml = layout.lanes
    .map(
      ({ id, rect }) => `      <bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}" isHorizontal="true">
        <dc:Bounds x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" />
      </bpmndi:BPMNShape>`
    )
    .join("\n");

  const nodeShapesXml = graph.elements
    .map((el) => {
      const r = layout.rects.get(el.id)!;
      const marker = el.type === "exclusiveGateway" ? ` isMarkerVisible="true"` : "";
      return `      <bpmndi:BPMNShape id="${el.id}_di" bpmnElement="${el.id}"${marker}>
        <dc:Bounds x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" />
      </bpmndi:BPMNShape>`;
    })
    .join("\n");

  const edgesXml = graph.flows
    .map((f) => {
      const pts = layout.routes.get(f.id)!;
      const waypoints = pts.map((p) => `        <di:waypoint x="${Math.round(p.x)}" y="${Math.round(p.y)}" />`).join("\n");
      return `      <bpmndi:BPMNEdge id="${f.id}_di" bpmnElement="${f.id}">
${waypoints}
      </bpmndi:BPMNEdge>`;
    })
    .join("\n");

  const { pool } = layout;
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
        <dc:Bounds x="${pool.x}" y="${pool.y}" width="${pool.w}" height="${pool.h}" />
      </bpmndi:BPMNShape>
${laneShapesXml}
${nodeShapesXml}
${edgesXml}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
}
