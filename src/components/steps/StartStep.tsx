import { useRef, useState } from "react";
import { extractTextFromPdf, extractTextFromXlsx } from "../../lib/fileExtract";

export type StartTab = "process_name" | "pdf" | "xlsx" | "paste";

interface Props {
  onContinue: (data: { tab: StartTab; processName: string; extractedText: string }) => void;
}

const DEMO_PROCESS_NAME = "Emissão de Carteira de Identidade Nacional (CIN)";

export function StartStep({ onContinue }: Props) {
  const [tab, setTab] = useState<StartTab>("process_name");
  const [processName, setProcessName] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tabs: { id: StartTab; label: string }[] = [
    { id: "process_name", label: "Nome do processo" },
    { id: "pdf", label: "Enviar PDF" },
    { id: "xlsx", label: "Enviar XLSX" },
    { id: "paste", label: "Colar texto" },
  ];

  async function handleFile(file: File) {
    setError(null);
    setFileName(file.name);
    setExtracting(true);
    try {
      const text = tab === "pdf" ? await extractTextFromPdf(file) : await extractTextFromXlsx(file);
      if (!text) {
        setError("Não consegui extrair texto desse arquivo. Tente outro arquivo ou cole o texto manualmente.");
      }
      setExtractedText(text);
    } catch {
      setError("Falha ao ler o arquivo. Verifique se ele não está corrompido ou protegido por senha.");
    } finally {
      setExtracting(false);
    }
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  function canContinue() {
    if (tab === "process_name") return processName.trim().length > 0;
    if (tab === "paste") return pastedText.trim().length > 0;
    return extractedText.trim().length > 0 && !extracting;
  }

  function handleContinue() {
    if (tab === "process_name") {
      onContinue({ tab, processName: processName.trim(), extractedText: "" });
    } else if (tab === "paste") {
      onContinue({ tab, processName: "", extractedText: pastedText.trim() });
    } else {
      onContinue({ tab, processName: "", extractedText: extractedText.trim() });
    }
  }

  function useDemo() {
    setTab("process_name");
    setProcessName(DEMO_PROCESS_NAME);
  }

  return (
    <div className="start-step">
      <h1 className="start-headline">Vamos redesenhar o Processo em uma experiência mais simples.</h1>
      <p className="start-subtext">
        Informe o nome do processo, ou envie a descrição atual em PDF, planilha ou texto colado. Você poderá
        conferir cada informação antes de qualquer análise.
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

            {(tab === "pdf" || tab === "xlsx") && (
              <div
                className="dropzone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  hidden
                  accept={tab === "pdf" ? "application/pdf" : ".xlsx,.xls"}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                  }}
                />
                <span className="dropzone-icon" aria-hidden="true">
                  ⬆
                </span>
                {extracting ? (
                  <p className="dropzone-title">Lendo {fileName}...</p>
                ) : fileName && extractedText ? (
                  <>
                    <p className="dropzone-title">{fileName}</p>
                    <p className="dropzone-hint">Arquivo lido com sucesso. Clique para trocar.</p>
                  </>
                ) : (
                  <>
                    <p className="dropzone-title">
                      Escolha ou arraste o {tab === "pdf" ? "PDF" : "XLSX"} do processo
                    </p>
                    <p className="dropzone-hint">{tab === "pdf" ? "PDF com até 15 MB" : "XLSX ou XLS"}</p>
                  </>
                )}
              </div>
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
