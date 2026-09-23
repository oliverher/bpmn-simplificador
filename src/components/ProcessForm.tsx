import { useState } from "react";
import type { AnalyzeProcessRequest } from "../lib/types";

interface Props {
  onSubmit: (request: AnalyzeProcessRequest) => void;
  loading: boolean;
}

export function ProcessForm({ onSubmit, loading }: Props) {
  const [inputType, setInputType] = useState<"process_name" | "activities_list">("process_name");
  const [input, setInput] = useState("");
  const [department, setDepartment] = useState("");
  const [actors, setActors] = useState("");
  const [constraintsNotes, setConstraintsNotes] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    onSubmit({
      inputType,
      input: input.trim(),
      department: department.trim() || undefined,
      actors: actors.trim() || undefined,
      constraintsNotes: constraintsNotes.trim() || undefined,
    });
  }

  return (
    <form className="process-form" onSubmit={handleSubmit}>
      <div className="input-type-toggle">
        <label>
          <input
            type="radio"
            checked={inputType === "process_name"}
            onChange={() => setInputType("process_name")}
          />
          Nome do processo
        </label>
        <label>
          <input
            type="radio"
            checked={inputType === "activities_list"}
            onChange={() => setInputType("activities_list")}
          />
          Lista de atividades
        </label>
      </div>

      {inputType === "process_name" ? (
        <label>
          Nome do processo
          <input
            type="text"
            placeholder="Ex: Emissão de Carteira de Identidade Nacional (CIN)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            required
          />
        </label>
      ) : (
        <label>
          Lista de atividades (uma por linha)
          <textarea
            rows={8}
            placeholder={"Ex:\nCidadão preenche formulário\nAtendente recebe e confere documentos\nSupervisor aprova cadastro\n..."}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            required
          />
        </label>
      )}

      <label>
        Departamento/área (opcional)
        <input type="text" value={department} onChange={(e) => setDepartment(e.target.value)} />
      </label>
      <label>
        Atores envolvidos (opcional)
        <input type="text" value={actors} onChange={(e) => setActors(e.target.value)} placeholder="Ex: Cidadão, Atendente, Supervisor" />
      </label>
      <label>
        Restrições/observações (opcional)
        <textarea rows={2} value={constraintsNotes} onChange={(e) => setConstraintsNotes(e.target.value)} />
      </label>

      <button type="submit" disabled={loading}>
        {loading ? "Analisando com IA..." : "Analisar processo"}
      </button>
    </form>
  );
}
