import { useEffect, useRef } from "react";
import NavigatedViewer from "bpmn-js/lib/NavigatedViewer";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css";

interface Props {
  xml: string;
  title: string;
}

export function BpmnViewer({ xml, title }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<InstanceType<typeof NavigatedViewer> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const viewer = new NavigatedViewer({ container: containerRef.current });
    viewerRef.current = viewer;

    viewer
      .importXML(xml)
      .then(() => {
        const canvas = viewer.get("canvas") as { zoom: (mode: string) => void };
        canvas.zoom("fit-viewport");
      })
      .catch((err: Error) => {
        console.error("Erro ao renderizar BPMN:", err);
      });

    return () => {
      viewer.destroy();
    };
  }, [xml]);

  async function handleExportXml() {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const { xml: exportedXml } = await viewer.saveXML({ format: true });
    downloadFile(`${title}.bpmn`, exportedXml ?? "", "application/xml");
  }

  async function handleExportSvg() {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const { svg } = await viewer.saveSVG();
    downloadFile(`${title}.svg`, svg, "image/svg+xml");
  }

  return (
    <div className="bpmn-viewer-wrapper">
      <div className="bpmn-viewer-actions">
        <button type="button" onClick={handleExportXml}>
          Exportar .bpmn
        </button>
        <button type="button" onClick={handleExportSvg}>
          Exportar .svg
        </button>
      </div>
      <div className="bpmn-canvas" ref={containerRef} />
    </div>
  );
}

function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
