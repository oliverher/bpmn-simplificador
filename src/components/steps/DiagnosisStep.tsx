import type { ProcessAnalysisResult } from "../../lib/types";
import { BpmnViewer } from "../BpmnViewer";

interface Props {
  result: ProcessAnalysisResult;
  onBack: () => void;
  onContinue: () => void;
}

export function DiagnosisStep({ result, onBack, onContinue }: Props) {
  return (
    <div className="diagnosis-step">
      <h2 className="step-title">Diagnóstico: {result.processName}</h2>
      <p className="step-subtitle">{result.analysis.summary}</p>

      <div className="diagnosis-layout">
        <div className="diagram-column">
          <h3>Processo atual (as-is)</h3>
          <BpmnViewer xml={result.asIs.xml} title={`${result.processName}-as-is`} />
        </div>
        <div className="issues-column">
          <h3>Problemas identificados</h3>
          <ul className="issue-list">
            {result.analysis.issues_found.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
          <div className="metric-card">
            <span className="metric-label">Etapas no processo atual</span>
            <span className="metric-values">{result.metrics.steps_before}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Handoffs entre atores</span>
            <span className="metric-values">{result.metrics.handoffs_before}</span>
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
