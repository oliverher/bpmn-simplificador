import type { BpmnElementType, BpmnGraphResult } from "./types";

const ELEMENT_MAP: Record<string, BpmnElementType> = {
  startEvent: "startEvent",
  endEvent: "endEvent",
  task: "task",
  manualTask: "task",
  sendTask: "task",
  receiveTask: "task",
  subProcess: "task",
  callActivity: "task",
  intermediateCatchEvent: "task",
  intermediateThrowEvent: "task",
  userTask: "userTask",
  serviceTask: "serviceTask",
  scriptTask: "serviceTask",
  businessRuleTask: "serviceTask",
  exclusiveGateway: "exclusiveGateway",
  inclusiveGateway: "exclusiveGateway",
  eventBasedGateway: "exclusiveGateway",
  complexGateway: "exclusiveGateway",
  parallelGateway: "parallelGateway",
};

const local = (el: Element) => el.localName;
const childrenOf = (el: Element, name: string) => Array.from(el.children).filter((c) => local(c) === name);

/** Converte um arquivo BPMN 2.0 no formato interno do app. Devolve null se não for um BPMN utilizável. */
export function bpmnXmlToGraph(xml: string, fallbackName: string): BpmnGraphResult | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) return null;
  const root = doc.documentElement;
  if (!root || local(root) !== "definitions") return null;

  const processes = Array.from(root.children).filter((c) => local(c) === "process");
  if (processes.length === 0) return null;
  const nodeCount = (p: Element) => Array.from(p.children).filter((c) => local(c) in ELEMENT_MAP).length;
  const process = processes.sort((a, b) => nodeCount(b) - nodeCount(a))[0];

  const participant = Array.from(root.getElementsByTagNameNS("*", "participant")).find(
    (p) => p.getAttribute("processRef") === process.getAttribute("id")
  );
  const processName =
    participant?.getAttribute("name") || process.getAttribute("name") || root.getAttribute("name") || fallbackName;

  const laneOfNode = new Map<string, string>();
  const lanes: { id: string; name: string }[] = [];
  for (const laneEl of Array.from(process.getElementsByTagNameNS("*", "lane"))) {
    const id = laneEl.getAttribute("id");
    if (!id) continue;
    lanes.push({ id, name: laneEl.getAttribute("name") || id });
    for (const ref of childrenOf(laneEl, "flowNodeRef")) laneOfNode.set((ref.textContent ?? "").trim(), id);
  }
  if (lanes.length === 0) lanes.push({ id: "lane_importada", name: processName });

  const elements: BpmnGraphResult["elements"] = [];
  for (const child of Array.from(process.children)) {
    const type = ELEMENT_MAP[local(child)];
    const id = child.getAttribute("id");
    if (!type || !id) continue;
    elements.push({ id, type, name: child.getAttribute("name") ?? "", lane: laneOfNode.get(id) ?? lanes[0].id });
  }

  const flows: BpmnGraphResult["flows"] = [];
  for (const flow of childrenOf(process, "sequenceFlow")) {
    const id = flow.getAttribute("id");
    const source = flow.getAttribute("sourceRef");
    const target = flow.getAttribute("targetRef");
    if (id && source && target) flows.push({ id, source, target, name: flow.getAttribute("name") ?? undefined });
  }

  if (elements.length < 2 || flows.length < 1) return null;
  return { process_name: processName, lanes, elements, flows };
}
