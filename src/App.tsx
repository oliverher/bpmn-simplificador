import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import { Header } from "./components/Header";
import { Stepper } from "./components/Stepper";
import { StartStep, type StartTab } from "./components/steps/StartStep";
import { ReviewStep } from "./components/steps/ReviewStep";
import { DiagnosisStep } from "./components/steps/DiagnosisStep";
import { SimplifyStep } from "./components/steps/SimplifyStep";
import { CompareStep } from "./components/steps/CompareStep";
import { DeliverStep } from "./components/steps/DeliverStep";
import type { AnalyzeProcessRequest, ProcessAnalysisResult } from "./lib/types";
import "./App.css";

interface StartData {
  tab: StartTab;
  processName: string;
  extractedText: string;
}

function App() {
  const [sessionReady, setSessionReady] = useState(false);
  const [step, setStep] = useState(1);
  const [startData, setStartData] = useState<StartData | null>(null);
  const [result, setResult] = useState<ProcessAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function ensureSession() {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        const { error: signInError } = await supabase.auth.signInAnonymously();
        if (signInError) {
          console.error("Falha ao iniciar sessão anônima:", signInError.message);
        }
      }
      setSessionReady(true);
    }
    ensureSession();
  }, []);

  function handleStartContinue(data: StartData) {
    setStartData(data);
    setStep(2);
  }

  async function handleReviewContinue(data: {
    processName: string;
    text: string;
    department: string;
    actors: string;
    constraintsNotes: string;
  }) {
    if (!startData) return;
    setLoading(true);
    setError(null);

    const request: AnalyzeProcessRequest = {
      inputType: startData.tab === "process_name" ? "process_name" : "activities_list",
      input: startData.tab === "process_name" ? data.processName : data.text,
      department: data.department.trim() || undefined,
      actors: data.actors.trim() || undefined,
      constraintsNotes: data.constraintsNotes.trim() || undefined,
    };

    const { data: response, error: invokeError } = await supabase.functions.invoke<ProcessAnalysisResult>(
      "analyze-process",
      { body: request }
    );

    setLoading(false);

    if (invokeError || !response) {
      setError(invokeError?.message ?? "Falha ao analisar o processo. Tente novamente.");
      return;
    }

    setResult(response);
    setStep(3);
  }

  function handleRestart() {
    setStep(1);
    setStartData(null);
    setResult(null);
    setError(null);
  }

  if (!sessionReady) {
    return <div className="loading-screen">Carregando...</div>;
  }

  return (
    <div className="app-shell">
      <Header />
      <Stepper currentStep={step} />

      <main className="wizard-main">
        {step === 1 && <StartStep onContinue={handleStartContinue} />}

        {step === 2 && startData && (
          <ReviewStep
            tab={startData.tab}
            initialProcessName={startData.processName}
            initialText={startData.extractedText}
            loading={loading}
            error={error}
            onBack={() => setStep(1)}
            onContinue={handleReviewContinue}
          />
        )}

        {step === 3 && result && (
          <DiagnosisStep result={result} onBack={() => setStep(2)} onContinue={() => setStep(4)} />
        )}

        {step === 4 && result && (
          <SimplifyStep result={result} onBack={() => setStep(3)} onContinue={() => setStep(5)} />
        )}

        {step === 5 && result && (
          <CompareStep result={result} onBack={() => setStep(4)} onContinue={() => setStep(6)} />
        )}

        {step === 6 && result && (
          <DeliverStep result={result} onBack={() => setStep(5)} onRestart={handleRestart} />
        )}
      </main>
    </div>
  );
}

export default App;
