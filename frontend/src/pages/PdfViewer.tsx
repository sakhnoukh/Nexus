import { useState, useEffect } from "react";
import { FileText } from "lucide-react";
import NavRail from "../components/NavRail";
import { fetchPdfs, getPdfUrl, type PdfInfo } from "../api/client";

export default function PdfViewer() {
  const [pdfs, setPdfs] = useState<Record<string, PdfInfo>>({});
  const [selectedPdf, setSelectedPdf] = useState<string | null>(null);

  useEffect(() => {
    fetchPdfs().then((data) => {
      setPdfs(data);
      const first = Object.keys(data)[0];
      if (first && !selectedPdf) setSelectedPdf(first);
    });
  }, []);

  return (
    <div className="flex h-screen w-screen bg-zinc-950">
      {/* Nav Rail */}
      <div className="w-14 flex-shrink-0 bg-zinc-900 border-r border-zinc-800">
        <NavRail />
      </div>

      {/* Left Sidebar — PDF selector */}
      <div className="w-64 flex-shrink-0 bg-zinc-900 border-r border-zinc-800 flex flex-col">
        <div className="px-4 py-3 border-b border-zinc-800">
          <span className="text-sm font-semibold text-zinc-200">PDF Viewer</span>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mono px-2">
            Documents
          </span>
          <div className="space-y-1 mt-1.5">
            {Object.entries(pdfs).map(([name, info]) => (
              <button
                key={name}
                onClick={() => setSelectedPdf(name)}
                className={`card w-full p-2 text-left hover:border-zinc-600 transition-colors ${
                  selectedPdf === name ? "border-cyan-700" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <FileText size={12} className="text-zinc-500 flex-shrink-0" />
                  <span
                    className={`text-xs truncate ${
                      selectedPdf === name ? "text-cyan-400" : "text-zinc-300"
                    }`}
                    title={name}
                  >
                    {name}
                  </span>
                </div>
                <span className="text-[10px] mono text-zinc-600 ml-5">
                  {info.element_count} elements
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* PDF Display */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedPdf ? (
          <>
            <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-900 flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-200 truncate">
                {selectedPdf}
              </span>
              <span className="text-[10px] mono text-zinc-600">
                <a
                  href={getPdfUrl(selectedPdf)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-500 hover:text-cyan-400"
                >
                  Open in new tab →
                </a>
              </span>
            </div>
            <div className="flex-1 overflow-auto bg-zinc-950 flex justify-center p-4">
              <iframe
                src={getPdfUrl(selectedPdf)}
                title={selectedPdf}
                className="w-full h-full rounded border border-zinc-800"
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <FileText size={32} className="text-zinc-700" />
            <p className="text-sm text-zinc-600">Select a PDF to view.</p>
          </div>
        )}
      </div>
    </div>
  );
}
