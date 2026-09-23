export interface WizardStepDef {
  id: number;
  key: string;
  label: string;
}

export const WIZARD_STEPS: WizardStepDef[] = [
  { id: 1, key: "comecar", label: "Começar" },
  { id: 2, key: "conferir", label: "Conferir" },
  { id: 3, key: "diagnostico", label: "Diagnóstico" },
  { id: 4, key: "simplificar", label: "Simplificar" },
  { id: 5, key: "revisar", label: "Revisar" },
  { id: 6, key: "entregar", label: "Entregar" },
];

export function progressPercent(currentStep: number): number {
  return Math.round((currentStep / WIZARD_STEPS.length) * 100);
}
