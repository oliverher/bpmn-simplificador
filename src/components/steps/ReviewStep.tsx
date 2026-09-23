import { useState } from "react";
import type { StartTab } from "./StartStep";
import type { BpmnGraphResult, ImageInput } from "../../lib/types";

interface Props {
  tab: StartTab;
  initialProcessName: string;
  initialText: string;
  images?: ImageInput[];
  bpmnGraph?: BpmnGraphResult;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onContinue: (data: {
    processName: string;
    text: string;
    department: string;
    actors: string;
    constraintsNotes: string;
  }) => void;
}

export function ReviewStep({
  tab,
  initialProcessName,
  initialText,
  images = [],
  bpmnGraph,
  loading,
  error,
  onBack,
  onContinue,
}: Props) {
  const [processName, setProcessName] = useState(initialProcessName);
  const [text, setText] = useState(initialText);
  const [department, setDepartment] = useState("");
  const [actors, setActors] = useState("");
  const [constraintsNotes, setConstraintsNotes] = useState("");

  const canContinue = bpmnGraph
    ? true
    : tab === "process_name"
      ? processName.trim().length > 0
      : text.trim().length > 0;
  const stepCount = bpmnGraph?.elements.filter((e) => ["task", "userTask", "serviceTask"].includes(e.type)).length ?? 0;

  return (
    <div className="review-step">
      <h2 className="step-title">Confira as informações antes da análise</h2>
      <p className="step-subtitle">
        Revise o que foi entendido. Você pode editar o texto e adicionar contexto para deixar a análise da IA mais
        precisa.
      </p>

      <div className="review-card">
        {bpmnGraph ? (
          <div className="review-bpmn">
            <strong>{bpmnGraph.process_name}</strong>
            <span>
              Diagrama BPMN importado: {stepCount} atividades, {bpmnGraph.lanes.length} raias e{" "}
              {bpmnGraph.flows.length} fluxos. Ele será usado como o processo atual (as-is), e a IA vai diagnosticar e
              propor a versão simplificada.
            </span>
          </div>
        ) : tab === "process_name" ? (
          <label className="review-field">
            Nome do processo
            <input type="text" value={processName} onChange={(e) => setProcessName(e.target.value)} />
          </label>
        ) : (
          <>
            {images.length > 0 && (
              <div className="review-images">
                {images.map((img, i) => (
                  <img key={i} src={`data:${img.media_type};base64,${img.data}`} alt={`Imagem ${i + 1} enviada`} />
                ))}
              </div>
            )}
            <label className="review-field">
              {tab === "file"
                ? "Texto do processo lido dos arquivos (confira e corrija se preciso)"
                : "Texto informado"}
              <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} />
            </label>
          </>
        )}

        <div className="review-context-grid">
          <label className="review-field">
            Departamento/área (opcional)
            <input type="text" value={department} onChange={(e) => setDepartment(e.target.value)} />
          </label>
          <label className="review-field">
            Atores envolvidos (opcional)
            <input
              type="text"
              placeholder="Ex: Cidadão, Atendente, Supervisor"
              value={actors}
              onChange={(e) => setActors(e.target.value)}
            />
          </label>
        </div>
        <label className="review-field">
          Restrições/observações (opcional)
          <textarea rows={2} value={constraintsNotes} onChange={(e) => setConstraintsNotes(e.target.value)} />
        </label>
      </div>

      {loading && <p className="loading-hint">A IA está modelando e analisando o processo. Isso pode levar até 1 minuto.</p>}
      {error && <p className="start-error">{error}</p>}

      <div className="step-nav">
        <button type="button" className="back-button" onClick={onBack} disabled={loading}>
          ← Voltar
        </button>
        <button
          type="button"
          className="continue-button"
          disabled={!canContinue || loading}
          onClick={() => onContinue({ processName, text, department, actors, constraintsNotes })}
        >
          {loading ? "Analisando com IA..." : "Continuar →"}
        </button>
      </div>
    </div>
  );
}
