import Viewer from "bpmn-js/lib/Viewer";
import { jsPDF } from "jspdf";
import type { ProcessAnalysisResult } from "./types";

export type ExportFormat = "bpmn" | "pdf" | "png" | "svg";
export type DiagramKind = "asIs" | "toBe";

const KIND_LABEL: Record<DiagramKind, string> = {
  asIs: "Processo atual (as-is)",
  toBe: "Processo simplificado (to-be)",
};
const KIND_SUFFIX: Record<DiagramKind, string> = { asIs: "as-is", toBe: "to-be" };

async function xmlToSvg(xml: string): Promise<string> {
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-10000px;top:0;width:1600px;height:900px";
  document.body.appendChild(container);
  const viewer = new Viewer({ container });
  try {
    await viewer.importXML(xml);
    const { svg } = await viewer.saveSVG();
    return svg;
  } finally {
    viewer.destroy();
    container.remove();
  }
}

function svgSize(svg: string): { width: number; height: number } {
  const el = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  const viewBox = el.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
  return {
    width: Number(el.getAttribute("width")) || viewBox?.[2] || 1200,
    height: Number(el.getAttribute("height")) || viewBox?.[3] || 700,
  };
}

interface RasterImage {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
}

async function svgToPng(svg: string, scale = 2): Promise<RasterImage> {
  const { width, height } = svgSize(svg);
  const factor = Math.min(scale, 7000 / width, 7000 / height);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Não foi possível renderizar o diagrama como imagem."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * factor);
    canvas.height = Math.round(height * factor);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao gerar a imagem PNG."))), "image/png")
    );
    return { blob, dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 80) || "processo";
}

async function buildPdf(result: ProcessAnalysisResult, kinds: DiagramKind[]): Promise<Blob> {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 40;
  const textW = pageW - margin * 2;
  let y = margin;

  const ensure = (needed: number) => {
    if (y + needed > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };
  const write = (text: string, size: number, bold = false, gap = 6) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    for (const line of doc.splitTextToSize(text, textW) as string[]) {
      ensure(size * 1.3);
      doc.text(line, margin, y + size);
      y += size * 1.3;
    }
    y += gap;
  };
  const writeList = (title: string, items: string[]) => {
    write(title, 13, true, 4);
    items.forEach((item) => write(`- ${item}`, 10.5, false, 3));
    y += 6;
  };

  write(result.processName, 22, true, 4);
  write("Assistente de Melhoria de Processos - SEAD / GEPROC", 10, false, 14);
  write(result.analysis.summary, 11, false, 10);

  const m = result.metrics;
  write(
    `Etapas: ${m.steps_before} -> ${m.steps_after}     Trocas de responsável (handoffs): ${m.handoffs_before} -> ${m.handoffs_after}`,
    11,
    true,
    12
  );

  if (kinds.includes("asIs")) writeList("Problemas identificados (as-is)", result.analysis.issues_found);
  if (kinds.includes("toBe")) writeList("Melhorias aplicadas (to-be)", result.analysis.recommendations);

  for (const kind of kinds) {
    const png = await svgToPng(await xmlToSvg(result[kind].xml), 2);
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(KIND_LABEL[kind], margin, margin + 10);
    const maxW = pageW - margin * 2;
    const maxH = pageH - margin * 2 - 30;
    const ratio = Math.min(maxW / png.width, maxH / png.height);
    doc.addImage(png.dataUrl, "PNG", margin, margin + 30, png.width * ratio, png.height * ratio, undefined, "MEDIUM");
  }

  return doc.output("blob");
}

export async function exportProcess(result: ProcessAnalysisResult, format: ExportFormat, kinds: DiagramKind[]) {
  const base = safeName(result.processName);

  if (format === "pdf") {
    download(await buildPdf(result, kinds), `${base}.pdf`);
    return;
  }

  for (const kind of kinds) {
    const name = `${base}-${KIND_SUFFIX[kind]}`;
    const xml = result[kind].xml;
    if (format === "bpmn") {
      download(new Blob([xml], { type: "application/xml" }), `${name}.bpmn`);
    } else if (format === "svg") {
      download(new Blob([await xmlToSvg(xml)], { type: "image/svg+xml" }), `${name}.svg`);
    } else {
      download((await svgToPng(await xmlToSvg(xml), 2)).blob, `${name}.png`);
    }
    await pause(400);
  }
}
