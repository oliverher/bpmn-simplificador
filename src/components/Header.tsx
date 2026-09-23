import { useState } from "react";
import { HelpModal } from "./HelpModal";

export function Header() {
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <>
      <header className="app-header">
        <div className="app-header-brand">
          <span className="app-header-logo" aria-hidden="true">
            🌿
          </span>
          <div>
            <div className="app-header-org">Estado de Goiás</div>
          </div>
        </div>
        <div className="app-header-title">
          <span className="app-header-product">Assistente de Melhoria de Processos</span>
          <span className="app-header-dept">SEAD / GEPROC</span>
        </div>
        <button type="button" className="help-button" onClick={() => setHelpOpen(true)}>
          <span aria-hidden="true">?</span> Ajuda
        </button>
      </header>
      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
    </>
  );
}
