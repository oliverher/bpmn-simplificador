import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import { Header } from "./components/Header";
import { Stepper } from "./components/Stepper";
import { StartStep, type StartData } from "./components/steps/StartStep";
import { ReviewStep } from "./components/steps/ReviewStep";
import { DiagnosisStep } from "./components/steps/DiagnosisStep";
import { SimplifyStep } from "./components/steps/SimplifyStep";
import { CompareStep } from "./components/steps/CompareStep";
import { DeliverStep } from "./components/steps/DeliverStep";
import type { AnalyzeProcessRequest, ProcessAnalysisResult } from "./lib/types";
import "./App.css";

/** Mostra a mensagem real devolvida pela função, em vez do texto genérico do supabase-js. */
async function functionErrorMessage(error: unknown): Promise<string> {
  const context = (error as { context?: Response })?.context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.json();
      if (body?.error) return String(body.error);
    } catch {
      /* usa a mensagem padrão abaixo */
    }
  }
  return (error as Error)?.message ?? "Falha ao analisar o processo. Tente novamente.";
}

function App() {
  const [sessionReady, setSessionReady] = useState(false);
  const [step, setStep] = useState(1);
  const [startData, setStartData] = useState<StartData | null>(null);
  const [result, setResult] = useState<ProcessAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  async function handleStartContinue(data: StartData) {
    setStartData(data);
    setError(null);
    setNotice(null);
    setStep(2);
    if (data.images.length === 0) return;

    // Imagens e PDFs escaneados: a IA transcreve o processo antes da conferência.
    setTranscribing(true);
    const { data: response, error: invokeError } = await supabase.functions.invoke<{ text: string }>("analyze-process", {
      body: { mode: "transcribe", inputType: "activities_list", input: "imagem", images: data.images },
    });
    setTranscribing(false);
    if (invokeError || !response?.text) {
      setNotice(
        `Não consegui ler as imagens automaticamente: ${await functionErrorMessage(invokeError ?? new Error("resposta vazia"))}. Você pode descrever o processo no campo de texto abaixo.`
      );
      return;
    }
    setStartData({
      ...data,
      extractedText: [data.extractedText, response.text].filter(Boolean).join("\n\n"),
    });
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
      input: startData.bpmnGraph
        ? startData.bpmnGraph.process_name
        : startData.tab === "process_name"
          ? data.processName
          : data.text,
      asIsGraph: startData.bpmnGraph,
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
      setError(await functionErrorMessage(invokeError ?? new Error("Falha ao analisar o processo. Tente novamente.")));
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
    setNotice(null);
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

        {step === 2 && startData && transcribing && (
          <div className="transcribing">
            <h2 className="step-title">Lendo o arquivo com IA...</h2>
            <p className="step-subtitle">A IA está transcrevendo o processo da imagem. Isso leva alguns segundos.</p>
          </div>
        )}

        {step === 2 && startData && !transcribing && (
          <ReviewStep
            key={startData.extractedText.length}
            tab={startData.tab}
            initialProcessName={startData.processName}
            initialText={startData.extractedText}
            images={startData.images}
            bpmnGraph={startData.bpmnGraph}
            loading={loading}
            error={error ?? notice}
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
