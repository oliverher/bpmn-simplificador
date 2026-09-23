import type { ProcessAnalysisResult } from "../../lib/types";
import { BpmnViewer } from "../BpmnViewer";

interface Props {
  result: ProcessAnalysisResult;
  onBack: () => void;
  onRestart: () => void;
}

export function DeliverStep({ result, onBack, onRestart }: Props) {
  return (
    <div className="deliver-step">
      <h2 className="step-title">Entregar</h2>
      <p className="step-subtitle">
        Exporte os diagramas do processo <strong>{result.processName}</strong> em BPMN (.bpmn) ou imagem (.svg).
      </p>

      <div className="diagrams-row">
        <div className="diagram-column">
          <h3>As-Is (atual)</h3>
          <BpmnViewer xml={result.asIs.xml} title={`${result.processName}-as-is`} />
        </div>
        <div className="diagram-column">
          <h3>To-Be (simplificado)</h3>
          <BpmnViewer xml={result.toBe.xml} title={`${result.processName}-to-be`} />
        </div>
      </div>

      <div className="step-nav">
        <button type="button" className="back-button" onClick={onBack}>
          ← Voltar
        </button>
        <button type="button" className="continue-button" onClick={onRestart}>
          Analisar novo processo
        </button>
      </div>
    </div>
  );
}
