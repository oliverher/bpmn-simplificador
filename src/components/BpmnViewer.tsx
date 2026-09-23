import { useEffect, useRef } from "react";
import NavigatedViewer from "bpmn-js/lib/NavigatedViewer";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css";

interface Props {
  xml: string;
}

interface CanvasApi {
  zoom: (level?: number | "fit-viewport", center?: "auto") => number;
}

export function BpmnViewer({ xml }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<InstanceType<typeof NavigatedViewer> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const viewer = new NavigatedViewer({ container: containerRef.current });
    viewerRef.current = viewer;

    viewer
      .importXML(xml)
      .then(() => (viewer.get("canvas") as CanvasApi).zoom("fit-viewport", "auto"))
      .catch((err: Error) => console.error("Erro ao renderizar BPMN:", err));

    return () => viewer.destroy();
  }, [xml]);

  function zoomBy(factor: number) {
    const canvas = viewerRef.current?.get("canvas") as CanvasApi | undefined;
    if (canvas) canvas.zoom((canvas.zoom() as number) * factor);
  }

  function fit() {
    (viewerRef.current?.get("canvas") as CanvasApi | undefined)?.zoom("fit-viewport", "auto");
  }

  return (
    <div className="bpmn-viewer-wrapper">
      <div className="bpmn-viewer-actions">
        <button type="button" onClick={() => zoomBy(1.25)} aria-label="Aumentar zoom">
          +
        </button>
        <button type="button" onClick={() => zoomBy(0.8)} aria-label="Diminuir zoom">
          −
        </button>
        <button type="button" onClick={fit}>
          Ajustar à tela
        </button>
        <span className="bpmn-viewer-hint">Arraste para mover · Ctrl + roda do mouse para ampliar</span>
      </div>
      <div className="bpmn-canvas" ref={containerRef} />
    </div>
  );
}
