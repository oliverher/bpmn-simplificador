import { useRef, useState } from "react";
import {
  ACCEPT_ATTRIBUTE,
  FORMATS_HINT,
  MAX_IMAGES,
  canvasesToImages,
  extractFromFile,
  type ExtractedFile,
} from "../../lib/fileExtract";
import type { BpmnGraphResult, ImageInput } from "../../lib/types";

export type StartTab = "process_name" | "file" | "paste";

export interface StartData {
  tab: StartTab;
  processName: string;
  extractedText: string;
  images: ImageInput[];
  bpmnGraph?: BpmnGraphResult;
  fileNames: string[];
}

interface Props {
  onContinue: (data: StartData) => void;
}

interface FileEntry {
  id: number;
  name: string;
  size: number;
  status: "reading" | "ok" | "error";
  result?: ExtractedFile;
  message?: string;
}

const DEMO_PROCESS_NAME = "Emissão de Carteira de Identidade Nacional (CIN)";
let nextFileId = 1;

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const KIND_LABEL: Record<ExtractedFile["kind"], string> = {
  text: "Texto",
  images: "Imagem (lida por IA)",
  bpmn: "Diagrama BPMN",
};

export function StartStep({ onContinue }: Props) {
  const [tab, setTab] = useState<StartTab>("process_name");
  const [processName, setProcessName] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tabs: { id: StartTab; label: string }[] = [
    { id: "process_name", label: "Nome do processo" },
    { id: "file", label: "Enviar arquivo" },
    { id: "paste", label: "Colar texto" },
  ];

  async function addFiles(list: FileList | File[]) {
    setError(null);
    for (const file of Array.from(list)) {
      const id = nextFileId++;
      setFiles((prev) => [...prev, { id, name: file.name, size: file.size, status: "reading" }]);
      try {
        const result = await extractFromFile(file);
        setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status: "ok", result } : f)));
      } catch (err) {
        setFiles((prev) =>
          prev.map((f) =>
            f.id === id ? { ...f, status: "error", message: (err as Error).message || "Falha ao ler o arquivo." } : f
          )
        );
      }
    }
  }

  const okFiles = files.filter((f) => f.status === "ok" && f.result);
  const reading = files.some((f) => f.status === "reading");
  const bpmnFiles = okFiles.filter((f) => f.result!.kind === "bpmn");
  const imageCount = okFiles.reduce((n, f) => n + (f.result!.kind === "images" ? f.result!.canvases.length : 0), 0);

  function fileProblem(): string | null {
    if (bpmnFiles.length > 1) return "Envie um arquivo BPMN por vez.";
    if (bpmnFiles.length === 1 && okFiles.length > 1) {
      return "O arquivo BPMN já é o processo modelado; remova os outros arquivos ou envie-o sozinho.";
    }
    if (imageCount > MAX_IMAGES) return `Há imagens demais (${imageCount}). O limite é ${MAX_IMAGES} por análise.`;
    return null;
  }

  function canContinue() {
    if (tab === "process_name") return processName.trim().length > 0;
    if (tab === "paste") return pastedText.trim().length > 0;
    return okFiles.length > 0 && !reading && !fileProblem();
  }

  function handleContinue() {
    if (tab === "process_name") {
      onContinue({ tab, processName: processName.trim(), extractedText: "", images: [], fileNames: [] });
      return;
    }
    if (tab === "paste") {
      onContinue({ tab, processName: "", extractedText: pastedText.trim(), images: [], fileNames: [] });
      return;
    }

    const problem = fileProblem();
    if (problem) {
      setError(problem);
      return;
    }
    const bpmn = bpmnFiles[0]?.result;
    if (bpmn?.kind === "bpmn") {
      onContinue({
        tab,
        processName: bpmn.graph.process_name,
        extractedText: "",
        images: [],
        bpmnGraph: bpmn.graph,
        fileNames: okFiles.map((f) => f.name),
      });
      return;
    }

    const texts = okFiles.filter((f) => f.result!.kind === "text");
    const text = texts
      .map((f) => {
        const body = (f.result as { text: string }).text;
        return texts.length > 1 ? `=== Arquivo: ${f.name} ===\n${body}` : body;
      })
      .join("\n\n");
    const canvases = okFiles.flatMap((f) => (f.result!.kind === "images" ? f.result!.canvases : []));
    try {
      onContinue({
        tab,
        processName: "",
        extractedText: text,
        images: canvases.length > 0 ? canvasesToImages(canvases) : [],
        fileNames: okFiles.map((f) => f.name),
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function useDemo() {
    setTab("process_name");
    setProcessName(DEMO_PROCESS_NAME);
  }

  const problem = fileProblem();

  return (
    <div className="start-step">
      <h1 className="start-headline">Vamos redesenhar o Processo em uma experiência mais simples.</h1>
      <p className="start-subtext">
        Informe o nome do processo ou envie um arquivo com a descrição atual, em texto, planilha, documento, imagem e
        outros formatos. Você poderá conferir cada informação antes de qualquer análise.
      </p>

      <div className="start-layout">
        <div className="start-card">
          <div className="start-tabs">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`start-tab ${tab === t.id ? "start-tab--active" : ""}`}
                onClick={() => {
                  setTab(t.id);
                  setError(null);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="start-tab-content">
            {tab === "process_name" && (
              <div className="start-name-input">
                <label htmlFor="process-name">Nome do processo</label>
                <input
                  id="process-name"
                  type="text"
                  placeholder="Ex: Emissão de Carteira de Identidade Nacional (CIN)"
                  value={processName}
                  onChange={(e) => setProcessName(e.target.value)}
                />
              </div>
            )}

            {tab === "file" && (
              <>
                <div
                  className={`dropzone ${dragging ? "dropzone--active" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    hidden
                    multiple
                    accept={ACCEPT_ATTRIBUTE}
                    onChange={(e) => {
                      if (e.target.files) addFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <span className="dropzone-icon" aria-hidden="true">
                    ⬆
                  </span>
                  <p className="dropzone-title">Arraste os arquivos aqui ou clique para buscar no computador</p>
                  <p className="dropzone-hint">{FORMATS_HINT}. Até 15 MB por arquivo.</p>
                </div>

                {files.length > 0 && (
                  <ul className="file-list">
                    {files.map((f) => (
                      <li key={f.id} className={`file-item file-item--${f.status}`}>
                        <div className="file-item-main">
                          <span className="file-item-name">{f.name}</span>
                          <span className="file-item-meta">
                            {formatSize(f.size)} ·{" "}
                            {f.status === "reading" && "Lendo..."}
                            {f.status === "ok" && f.result && KIND_LABEL[f.result.kind]}
                            {f.status === "error" && (f.message ?? "Erro")}
                          </span>
                          {f.status === "ok" && f.result && "note" in f.result && f.result.note && (
                            <span className="file-item-note">{f.result.note}</span>
                          )}
                        </div>
                        <button
                          type="button"
                          className="file-item-remove"
                          aria-label={`Remover ${f.name}`}
                          onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {imageCount > 0 && !problem && (
                  <p className="file-privacy">
                    Imagens e PDFs escaneados são lidos por IA e enviados ao serviço da Anthropic. Não envie
                    documentos sigilosos.
                  </p>
                )}
                {problem && <p className="start-error">{problem}</p>}
              </>
            )}

            {tab === "paste" && (
              <div className="start-paste-input">
                <label htmlFor="paste-text">Cole a descrição do processo ou a lista de atividades</label>
                <textarea
                  id="paste-text"
                  rows={8}
                  placeholder={"Ex:\nCidadão preenche formulário\nAtendente confere documentos\nSupervisor aprova cadastro"}
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                />
              </div>
            )}

            {error && <p className="start-error">{error}</p>}
          </div>

          <button type="button" className="link-button demo-link" onClick={useDemo}>
            ⤴ Usar processo real de demonstração
          </button>
          <p className="start-privacy-note">O protótipo usa os dados apenas durante esta navegação.</p>
        </div>

        <button type="button" className="continue-button" disabled={!canContinue()} onClick={handleContinue}>
          Continuar →
        </button>
      </div>
    </div>
  );
}
