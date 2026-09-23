import { WIZARD_STEPS, progressPercent } from "../lib/wizard";

interface Props {
  currentStep: number;
}

export function Stepper({ currentStep }: Props) {
  const currentLabel = WIZARD_STEPS.find((s) => s.id === currentStep)?.label ?? "";

  return (
    <div className="stepper">
      <div className="stepper-top-row">
        <span className="stepper-current">
          Etapa {currentStep} de {WIZARD_STEPS.length} <strong>{currentLabel}</strong>
        </span>
        <span className="stepper-percent">{progressPercent(currentStep)}% concluído</span>
      </div>
      <div className="stepper-bar-track">
        <div className="stepper-bar-fill" style={{ width: `${progressPercent(currentStep)}%` }} />
      </div>
      <div className="stepper-nodes">
        {WIZARD_STEPS.map((step) => {
          const state = step.id < currentStep ? "done" : step.id === currentStep ? "active" : "pending";
          return (
            <div key={step.id} className={`stepper-node stepper-node--${state}`}>
              <span className="stepper-node-circle">{step.id < currentStep ? "✓" : step.id}</span>
              <span className="stepper-node-label">{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
