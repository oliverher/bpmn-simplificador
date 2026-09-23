interface Props {
  onClose: () => void;
}

export function HelpModal({ onClose }: Props) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Como funciona o Assistente</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">
            ×
          </button>
        </div>
        <ol className="help-steps">
          <li>
            <strong>Começar:</strong> informe o nome do processo, ou envie a descrição em PDF, planilha (XLSX) ou
            texto colado.
          </li>
          <li>
            <strong>Conferir:</strong> revise o que foi entendido antes de seguir para a análise da IA.
          </li>
          <li>
            <strong>Diagnóstico:</strong> veja o processo atual (as-is) modelado em BPMN e os problemas
            identificados.
          </li>
          <li>
            <strong>Simplificar:</strong> veja a proposta de processo simplificado (to-be), com as melhorias
            aplicadas.
          </li>
          <li>
            <strong>Revisar:</strong> compare as duas versões lado a lado, com as métricas de melhoria.
          </li>
          <li>
            <strong>Entregar:</strong> exporte os diagramas em BPMN (.bpmn) ou imagem (.svg).
          </li>
        </ol>
        <p className="help-footer">Dúvidas ou sugestões? Fale com a equipe SEAD / GEPROC.</p>
      </div>
    </div>
  );
}
