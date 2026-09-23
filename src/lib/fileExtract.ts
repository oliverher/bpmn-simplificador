import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";
import * as XLSX from "xlsx";
import { strFromU8, unzipSync } from "fflate";
import { bpmnXmlToGraph } from "./bpmnImport";
import type { BpmnGraphResult, ImageInput } from "./types";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const MAX_TEXT_CHARS = 60_000;
export const MAX_IMAGES = 8;

const IMAGE_EXT = ["png", "jpg", "jpeg", "webp", "gif"];
const TEXT_EXT = ["txt", "md", "csv"];
const SHEET_EXT = ["xlsx", "xls", "ods"];

export const ACCEPT_ATTRIBUTE = [
  "pdf", "docx", "pptx", ...SHEET_EXT, ...TEXT_EXT, "html", "htm", "bpmn", "xml", ...IMAGE_EXT,
]
  .map((e) => `.${e}`)
  .join(",");

export const FORMATS_HINT =
  "PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx/.xls), CSV, TXT, HTML, BPMN e imagens (PNG, JPG, WEBP, GIF)";

export type ExtractedFile =
  | { kind: "text"; text: string; note?: string }
  | { kind: "images"; canvases: HTMLCanvasElement[]; note?: string }
  | { kind: "bpmn"; graph: BpmnGraphResult };

const extensionOf = (file: File) => file.name.toLowerCase().split(".").pop() ?? "";

function limitText(text: string): { text: string; note?: string } {
  const clean = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= MAX_TEXT_CHARS) return { text: clean };
  return {
    text: clean.slice(0, MAX_TEXT_CHARS),
    note: `Arquivo muito longo: usei só os primeiros ${MAX_TEXT_CHARS.toLocaleString("pt-BR")} caracteres.`,
  };
}

export async function extractFromFile(file: File): Promise<ExtractedFile> {
  if (file.size > MAX_FILE_BYTES) throw new Error("Arquivo maior que 15 MB.");
  const ext = extensionOf(file);

  if (IMAGE_EXT.includes(ext)) return { kind: "images", canvases: [await imageFileToCanvas(file)] };
  if (ext === "pdf") return extractPdf(file);
  if (ext === "docx") return { kind: "text", ...limitText(await extractDocx(file)) };
  if (ext === "pptx") return { kind: "text", ...limitText(await extractPptx(file)) };
  if (SHEET_EXT.includes(ext)) return { kind: "text", ...limitText(await extractSheet(file)) };
  if (TEXT_EXT.includes(ext)) return { kind: "text", ...limitText(await file.text()) };
  if (ext === "html" || ext === "htm") return { kind: "text", ...limitText(htmlToText(await file.text())) };

  if (ext === "bpmn" || ext === "xml") {
    const graph = bpmnXmlToGraph(await file.text(), file.name.replace(/\.[^.]+$/, ""));
    if (!graph) throw new Error("Não consegui interpretar este arquivo como um processo BPMN 2.0.");
    return { kind: "bpmn", graph };
  }

  if (["doc", "ppt", "rtf", "vsd", "vsdx", "bpm"].includes(ext)) {
    throw new Error(`Formato .${ext} não é suportado. Salve o arquivo como .docx, .pptx, PDF ou .bpmn e envie de novo.`);
  }
  throw new Error(`Formato .${ext || "desconhecido"} não é suportado. Aceitos: ${FORMATS_HINT}.`);
}

/* ------------------------------ PDF ------------------------------ */

async function extractPdf(file: File): Promise<ExtractedFile> {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  const text = pages.join("\n").trim();

  // PDF escaneado: quase sem texto selecionável, então as páginas viram imagens para a IA ler.
  if (text.length >= 40 * pdf.numPages) return { kind: "text", ...limitText(text) };

  const canvases: HTMLCanvasElement[] = [];
  const pagesToRender = Math.min(pdf.numPages, MAX_IMAGES);
  for (let n = 1; n <= pagesToRender; n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 1568 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, canvas, viewport }).promise;
    canvases.push(canvas);
  }
  return {
    kind: "images",
    canvases,
    note:
      pdf.numPages > pagesToRender
        ? `PDF sem texto (escaneado): a IA vai ler as primeiras ${pagesToRender} de ${pdf.numPages} páginas.`
        : "PDF sem texto (escaneado): a IA vai ler as páginas como imagem.",
  };
}

/* --------------------------- Office / HTML --------------------------- */

function paragraphsOf(xml: string, runTag: string): string[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(doc.getElementsByTagNameNS("*", "p")).map((p) => {
    let line = "";
    for (const el of Array.from(p.getElementsByTagNameNS("*", "*"))) {
      if (el.localName === runTag) line += el.textContent ?? "";
      else if (el.localName === "tab") line += "\t";
      else if (el.localName === "br") line += "\n";
    }
    return line;
  });
}

async function unzip(file: File, wanted: (name: string) => boolean) {
  try {
    return unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (f) => wanted(f.name) });
  } catch {
    throw new Error("Não consegui abrir o arquivo. Ele pode estar corrompido ou protegido por senha.");
  }
}

async function extractDocx(file: File): Promise<string> {
  const files = await unzip(file, (n) => n === "word/document.xml");
  const xml = files["word/document.xml"];
  if (!xml) throw new Error("Este arquivo não parece um documento Word (.docx) válido.");
  return paragraphsOf(strFromU8(xml), "t").join("\n");
}

async function extractPptx(file: File): Promise<string> {
  const files = await unzip(file, (n) => /^ppt\/(slides|notesSlides)\/[^/]+\.xml$/.test(n));
  const order = (name: string) => Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);
  const names = Object.keys(files);
  if (names.length === 0) throw new Error("Este arquivo não parece uma apresentação (.pptx) válida.");
  const parts: string[] = [];
  const slides = names.filter((n) => n.includes("/slides/")).sort((a, b) => order(a) - order(b));
  for (const name of slides) {
    parts.push(`--- Slide ${order(name)} ---`, ...paragraphsOf(strFromU8(files[name]), "t"));
    const notes = files[`ppt/notesSlides/notesSlide${order(name)}.xml`];
    const noteText = notes ? paragraphsOf(strFromU8(notes), "t").join(" ").trim() : "";
    if (noteText) parts.push(`(Notas do slide ${order(name)}: ${noteText})`);
  }
  return parts.join("\n");
}

async function extractSheet(file: File): Promise<string> {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
  } catch {
    throw new Error("Não consegui ler a planilha. Ela pode estar corrompida ou protegida por senha.");
  }
  const lines: string[] = [];
  for (const name of workbook.SheetNames) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, blankrows: false });
    const sheetLines = rows
      .map((row) => row.map((c) => (c === null || c === undefined ? "" : String(c).trim())).filter(Boolean).join(" - "))
      .filter(Boolean);
    if (sheetLines.length === 0) continue;
    if (workbook.SheetNames.length > 1) lines.push(`# Planilha: ${name}`);
    lines.push(...sheetLines);
  }
  return lines.join("\n");
}

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, noscript, template, svg, iframe, head").forEach((el) => el.remove());
  doc.querySelectorAll("br").forEach((el) => el.replaceWith("\n"));
  doc.querySelectorAll("td, th").forEach((el) => el.append(" | "));
  doc
    .querySelectorAll("p, div, li, tr, h1, h2, h3, h4, h5, h6, section, article, table, ul, ol, pre, blockquote")
    .forEach((el) => el.append("\n"));
  const title = new DOMParser().parseFromString(html, "text/html").title.trim();
  return `${title ? `${title}\n\n` : ""}${doc.body?.textContent ?? ""}`.replace(/[ \t]*\|[ \t]*\n/g, "\n");
}

/* ------------------------------ Imagens ------------------------------ */

async function imageFileToCanvas(file: File): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Não consegui abrir a imagem. Verifique se o arquivo não está corrompido.");
  }
  const scale = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

const IMAGE_BUDGET_CHARS = 3_500_000;

/** Codifica as imagens em JPEG, reduzindo tamanho/qualidade até caberem no limite do envio. */
export function canvasesToImages(canvases: HTMLCanvasElement[]): ImageInput[] {
  const presets = [
    { edge: 1568, quality: 0.85 },
    { edge: 1200, quality: 0.75 },
    { edge: 900, quality: 0.7 },
  ];
  for (const { edge, quality } of presets) {
    const images = canvases.map((src) => {
      const scale = Math.min(1, edge / Math.max(src.width, src.height));
      const out = document.createElement("canvas");
      out.width = Math.max(1, Math.round(src.width * scale));
      out.height = Math.max(1, Math.round(src.height * scale));
      out.getContext("2d")!.drawImage(src, 0, 0, out.width, out.height);
      return { media_type: "image/jpeg", data: out.toDataURL("image/jpeg", quality).split(",")[1] };
    });
    if (images.reduce((sum, i) => sum + i.data.length, 0) <= IMAGE_BUDGET_CHARS) return images;
  }
  throw new Error("As imagens são grandes demais para enviar. Use menos imagens ou imagens menores.");
}
