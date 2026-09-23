import { useState } from "react";
import type { ProcessAnalysisResult } from "../../lib/types";
import { exportProcess, type DiagramKind, type ExportFormat } from "../../lib/exportDiagram";
import { BpmnViewer } from "../BpmnViewer";

interface Props {
  result: ProcessAnalysisResult;
  onBack: () => void;
  onRestart: () => void;
}

const FORMATS: { id: ExportFormat; title: string; description: string }[] = [
  { id: "bpmn", title: "BPMN 2.0 (.bpmn)", description: "Arquivo editável no Camunda Modeler, Bizagi, draw.io e similares" },
  { id: "pdf", title: "PDF", description: "Documento com os diagramas, o diagnóstico e as melhorias" },
  { id: "png", title: "Imagem PNG", description: "Para colar em slides, e-mails e documentos" },
  { id: "svg", title: "Imagem SVG", description: "Imagem vetorial, sem perda de qualidade ao ampliar" },
];

export function DeliverStep({ result, onBack, onRestart }: Props) {
  const [format, setFormat] = useState<ExportFormat>("bpmn");
  const [kinds, setKinds] = useState<Record<DiagramKind, boolean>>({ asIs: true, toBe: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const selected = (Object.keys(kinds) as DiagramKind[]).filter((k) => kinds[k]);

  async function handleDownload() {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await exportProcess(result, format, selected);
      setDone(true);
    } catch (err) {
      setError((err as Error).message || "Não foi possível gerar o arquivo. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="deliver-step">
      <h2 className="step-title">Entregar</h2>
      <p className="step-subtitle">
        Escolha o que baixar e em qual formato para o processo <strong>{result.processName}</strong>.
      </p>

      <div className="deliver-panel">
        <div className="deliver-section">
          <h3>1. O que baixar</h3>
          <div className="deliver-options">
            <label className="deliver-check">
              <input
                type="checkbox"
                checked={kinds.asIs}
                onChange={(e) => setKinds({ ...kinds, asIs: e.target.checked })}
              />
              Processo atual (as-is)
            </label>
            <label className="deliver-check">
              <input
                type="checkbox"
                checked={kinds.toBe}
                onChange={(e) => setKinds({ ...kinds, toBe: e.target.checked })}
              />
              Processo simplificado (to-be)
            </label>
          </div>
        </div>

        <div className="deliver-section">
          <h3>2. Formato</h3>
          <div className="format-grid" role="radiogroup" aria-label="Formato do arquivo">
            {FORMATS.map((f) => (
              <label key={f.id} className={`format-card ${format === f.id ? "format-card--active" : ""}`}>
                <input type="radio" name="format" checked={format === f.id} onChange={() => setFormat(f.id)} />
                <span className="format-title">{f.title}</span>
                <span className="format-description">{f.description}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="deliver-actions">
          <button
            type="button"
            className="continue-button"
            onClick={handleDownload}
            disabled={busy || selected.length === 0}
          >
            {busy ? "Gerando arquivo..." : "Baixar"}
          </button>
          {selected.length === 0 && <span className="start-error">Selecione ao menos um processo.</span>}
          {error && <span className="start-error">{error}</span>}
          {done && <span className="deliver-done">Download iniciado.</span>}
        </div>
      </div>

      <div className="diagrams-row">
        <div className="diagram-column">
          <h3>Processo atual (as-is)</h3>
          <BpmnViewer xml={result.asIs.xml} />
        </div>
        <div className="diagram-column">
          <h3>Processo simplificado (to-be)</h3>
          <BpmnViewer xml={result.toBe.xml} />
        </div>
      </div>

      <div className="step-nav">
        <button type="button" className="back-button" onClick={onBack}>
          ← Voltar
        </button>
        <button type="button" className="back-button" onClick={onRestart}>
          Analisar novo processo
        </button>
      </div>
    </div>
  );
}
