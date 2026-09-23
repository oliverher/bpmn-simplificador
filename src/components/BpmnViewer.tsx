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
  resized: () => void;
  getSize: () => { width: number; height: number };
  viewbox: (box?: { x: number; y: number; width: number; height: number }) => {
    inner: { x: number; y: number; width: number; height: number };
  };
}

// Abaixo desta escala o texto fica ilegível; em vez de encolher mais, mostra o início do diagrama e permite arrastar.
const MIN_READABLE_SCALE = 0.7;

export function BpmnViewer({ xml }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<InstanceType<typeof NavigatedViewer> | null>(null);

  const canvas = () => viewerRef.current?.get("canvas") as CanvasApi | undefined;

  function fitReadable() {
    const c = canvas();
    if (!c) return;
    const fitScale = c.zoom("fit-viewport", "auto");
    if (fitScale >= MIN_READABLE_SCALE) return;
    const { inner } = c.viewbox();
    const size = c.getSize();
    c.viewbox({
      x: inner.x - 20,
      y: inner.y - 20,
      width: size.width / MIN_READABLE_SCALE,
      height: size.height / MIN_READABLE_SCALE,
    });
  }

  useEffect(() => {
    if (!containerRef.current) return;
    const viewer = new NavigatedViewer({ container: containerRef.current });
    viewerRef.current = viewer;
    viewer
      .importXML(xml)
      .then(fitReadable)
      .catch((err: Error) => console.error("Erro ao renderizar BPMN:", err));

    const onFullscreenChange = () => {
      canvas()?.resized();
      fitReadable();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      viewer.destroy();
    };
  }, [xml]);

  function zoomBy(factor: number) {
    const c = canvas();
    if (c) c.zoom((c.zoom() as number) * factor);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else wrapperRef.current?.requestFullscreen();
  }

  return (
    <div className="bpmn-viewer-wrapper" ref={wrapperRef}>
      <div className="bpmn-viewer-actions">
        <button type="button" onClick={() => zoomBy(1.25)} aria-label="Aumentar zoom">
          +
        </button>
        <button type="button" onClick={() => zoomBy(0.8)} aria-label="Diminuir zoom">
          −
        </button>
        <button type="button" onClick={fitReadable}>
          Ajustar à tela
        </button>
        <button type="button" onClick={toggleFullscreen}>
          Tela cheia
        </button>
        <span className="bpmn-viewer-hint">Arraste para mover · Ctrl + roda do mouse para ampliar</span>
      </div>
      <div className="bpmn-canvas" ref={containerRef} />
    </div>
  );
}
