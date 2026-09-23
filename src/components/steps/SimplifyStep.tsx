import type { ProcessAnalysisResult } from "../../lib/types";
import { BpmnViewer } from "../BpmnViewer";

interface Props {
  result: ProcessAnalysisResult;
  onBack: () => void;
  onContinue: () => void;
}

export function SimplifyStep({ result, onBack, onContinue }: Props) {
  return (
    <div className="diagnosis-step">
      <h2 className="step-title">Proposta simplificada (to-be)</h2>
      <p className="step-subtitle">
        Melhorias aplicadas com base nos princípios ECRS (Eliminar, Combinar, Reorganizar, Simplificar).
      </p>

      <div className="diagnosis-layout">
        <div className="diagram-column">
          <h3>Processo simplificado (to-be)</h3>
          <BpmnViewer xml={result.toBe.xml} />
        </div>
        <div className="issues-column">
          <h3>Melhorias aplicadas</h3>
          <ul className="issue-list">
            {result.analysis.recommendations.map((rec, i) => (
              <li key={i}>{rec}</li>
            ))}
          </ul>
          <div className="issues-metrics">
            <div className="metric-card">
              <span className="metric-label">Etapas no processo simplificado</span>
              <span className="metric-values">{result.metrics.steps_after}</span>
            </div>
            <div className="metric-card">
              <span className="metric-label">Handoffs entre atores</span>
              <span className="metric-values">{result.metrics.handoffs_after}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="step-nav">
        <button type="button" className="back-button" onClick={onBack}>
          ← Voltar
        </button>
        <button type="button" className="continue-button" onClick={onContinue}>
          Continuar →
        </button>
      </div>
    </div>
  );
}
