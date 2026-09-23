import type { ProcessAnalysisResult } from "../lib/types";
import { BpmnViewer } from "./BpmnViewer";

interface Props {
  result: ProcessAnalysisResult;
}

export function ProcessResult({ result }: Props) {
  const { metrics } = result;
  const stepsReduction = metrics.steps_before - metrics.steps_after;
  const handoffsReduction = metrics.handoffs_before - metrics.handoffs_after;

  return (
    <div className="process-result">
      <h2>{result.processName}</h2>

      <div className="metrics-row">
        <MetricCard label="Etapas" before={metrics.steps_before} after={metrics.steps_after} reduction={stepsReduction} />
        <MetricCard
          label="Handoffs entre atores"
          before={metrics.handoffs_before}
          after={metrics.handoffs_after}
          reduction={handoffsReduction}
        />
      </div>

      <div className="analysis-block">
        <h3>Resumo da análise</h3>
        <p>{result.analysis.summary}</p>

        <div className="analysis-columns">
          <div>
            <h4>Problemas identificados (as-is)</h4>
            <ul>
              {result.analysis.issues_found.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4>Melhorias aplicadas (to-be)</h4>
            <ul>
              {result.analysis.recommendations.map((rec, i) => (
                <li key={i}>{rec}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>

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
