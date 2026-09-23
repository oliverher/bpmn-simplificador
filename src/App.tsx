import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabaseClient";
import { Auth } from "./components/Auth";
import { ProcessForm } from "./components/ProcessForm";
import { ProcessResult } from "./components/ProcessResult";
import type { AnalyzeProcessRequest, ProcessAnalysisResult } from "./lib/types";
import "./App.css";

interface HistoryItem {
  id: string;
  name: string;
  created_at: string;
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [result, setResult] = useState<ProcessAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCheckingSession(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) loadHistory();
  }, [session]);

  async function loadHistory() {
    const { data, error: fetchError } = await supabase
      .from("processes")
      .select("id, name, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (!fetchError && data) setHistory(data);
  }

  async function handleAnalyze(request: AnalyzeProcessRequest) {
    setLoading(true);
    setError(null);
    setResult(null);

    const { data, error: invokeError } = await supabase.functions.invoke<ProcessAnalysisResult>("analyze-process", {
      body: request,
    });

    if (invokeError || !data) {
      setError(invokeError?.message ?? "Falha ao analisar o processo.");
      setLoading(false);
      return;
    }

    setResult(data);
    await saveProcess(request, data);
    await loadHistory();
    setLoading(false);
  }

  async function saveProcess(request: AnalyzeProcessRequest, analysis: ProcessAnalysisResult) {
    const userId = session?.user.id;
    if (!userId) return;

    const { data: process, error: insertError } = await supabase
      .from("processes")
      .insert({
        user_id: userId,
        name: analysis.processName,
        input_type: request.inputType,
        raw_input: request.input,
        department: request.department,
        actors: request.actors,
        constraints_notes: request.constraintsNotes,
      })
      .select()
      .single();

    if (insertError || !process) return;

    await supabase.from("process_versions").insert([
      {
        process_id: process.id,
        version_type: "as_is",
        bpmn_xml: analysis.asIs.xml,
        analysis: analysis.analysis,
        metrics: analysis.metrics,
      },
      {
        process_id: process.id,
        version_type: "to_be",
        bpmn_xml: analysis.toBe.xml,
        analysis: analysis.analysis,
        metrics: analysis.metrics,
      },
    ]);
  }

  async function loadFromHistory(processId: string) {
    const { data: versions, error: fetchError } = await supabase
      .from("process_versions")
      .select("*")
      .eq("process_id", processId);

    const { data: process } = await supabase.from("processes").select("name").eq("id", processId).single();

    if (fetchError || !versions || !process) return;

    const asIs = versions.find((v) => v.version_type === "as_is");
    const toBe = versions.find((v) => v.version_type === "to_be");
    if (!asIs || !toBe) return;

    setResult({
      processName: process.name,
      asIs: { xml: asIs.bpmn_xml, graph: asIs.analysis },
      toBe: { xml: toBe.bpmn_xml, graph: toBe.analysis },
      analysis: asIs.analysis,
      metrics: asIs.metrics,
    });
  }

  if (checkingSession) return <div className="loading-screen">Carregando...</div>;
  if (!session) return <Auth />;

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <h3>Meus processos</h3>
        <ul className="history-list">
          {history.map((item) => (
            <li key={item.id}>
              <button className="link-button" onClick={() => loadFromHistory(item.id)}>
                {item.name}
              </button>
            </li>
          ))}
        </ul>
        <button className="link-button logout" onClick={() => supabase.auth.signOut()}>
          Sair
        </button>
      </aside>

      <main className="main-content">
        <h1>Simplificador de Processos (BPMN + IA)</h1>
        <ProcessForm onSubmit={handleAnalyze} loading={loading} />
        {error && <p className="error-message">{error}</p>}
        {result && <ProcessResult result={result} />}
      </main>
    </div>
  );
}

export default App;
