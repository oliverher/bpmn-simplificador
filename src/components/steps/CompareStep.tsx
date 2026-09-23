import type { ProcessAnalysisResult } from "../../lib/types";
import { BpmnViewer } from "../BpmnViewer";

interface Props {
  result: ProcessAnalysisResult;
  onBack: () => void;
  onContinue: () => void;
}

export function CompareStep({ result, onBack, onContinue }: Props) {
  const { metrics } = result;
  const stepsReduction = metrics.steps_before - metrics.steps_after;
  const handoffsReduction = metrics.handoffs_before - metrics.handoffs_after;

  return (
    <div className="compare-step">
      <h2 className="step-title">Revisão: antes e depois</h2>

      <div className="metrics-row">
        <MetricCard label="Etapas" before={metrics.steps_before} after={metrics.steps_after} reduction={stepsReduction} />
        <MetricCard
          label="Handoffs entre atores"
          before={metrics.handoffs_before}
          after={metrics.handoffs_after}
          reduction={handoffsReduction}
        />
      </div>

      <div className="diagrams-row">
        <div className="diagram-column">
          <h3>As-Is (atual)</h3>
          <BpmnViewer xml={result.asIs.xml} />
        </div>
        <div className="diagram-column">
          <h3>To-Be (simplificado)</h3>
          <BpmnViewer xml={result.toBe.xml} />
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

function MetricCard({ label, before, after, reduction }: { label: string; before: number; after: number; reduction: number }) {
  return (
    <div className="metric-card">
      <span className="metric-label">{label}</span>
      <span className="metric-values">
        {before} → {after}
      </span>
      {reduction > 0 && <span className="metric-reduction">-{reduction}</span>}
    </div>
  );
}
