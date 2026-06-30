const API_BASE = "";

export interface PdfInfo {
  active: boolean;
  element_count: number;
  has_summary?: boolean;
  summary_path?: string;
}

export interface RetrievedItem {
  uuid: string;
  type: "text" | "image";
  content: string;
  page: number;
  source_pdf: string;
  distance: number;
  image_url?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  retrievedItems?: RetrievedItem[];
}

export interface HealthStatus {
  status: string;
  chroma_db: boolean;
  document_store: boolean;
  pdf_count: number;
}

export async function fetchHealth(): Promise<HealthStatus> {
  const res = await fetch(`${API_BASE}/api/health`);
  return res.json();
}

export async function fetchPdfs(): Promise<Record<string, PdfInfo>> {
  const res = await fetch(`${API_BASE}/api/pdfs`);
  return res.json();
}

export async function uploadPdfs(files: File[]): Promise<any> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  const res = await fetch(`${API_BASE}/api/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Upload failed");
  }
  return res.json();
}

export async function deletePdf(name: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/pdfs/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Delete failed");
  return res.json();
}

export async function togglePdfActive(name: string, active: boolean): Promise<any> {
  const res = await fetch(`${API_BASE}/api/pdfs/${encodeURIComponent(name)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active }),
  });
  if (!res.ok) throw new Error("Toggle failed");
  return res.json();
}

export async function rebuildIndex(): Promise<any> {
  const res = await fetch(`${API_BASE}/api/rebuild`, { method: "POST" });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Rebuild failed");
  }
  return res.json();
}

export async function fetchSummaries(): Promise<{ summaries: string[] }> {
  const res = await fetch(`${API_BASE}/api/summaries`);
  return res.json();
}

export async function fetchSummary(name: string): Promise<{ pdf_name: string; summary: string }> {
  const res = await fetch(`${API_BASE}/api/summaries/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error("Summary not found");
  return res.json();
}

export async function generateSummary(
  pdfName: string,
  focusAreas: string[] | null,
  customInstructions: string
): Promise<any> {
  const res = await fetch(`${API_BASE}/api/summaries/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pdf_name: pdfName,
      focus_areas: focusAreas,
      custom_instructions: customInstructions,
    }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || "Summary generation failed");
  }
  return res.json();
}

export async function deleteSummary(name: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/summaries/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Delete summary failed");
  return res.json();
}

interface SSECallbacks {
  onRetrievedItems?: (items: RetrievedItem[]) => void;
  onToken?: (token: string) => void;
  onDone?: () => void;
  onError?: (error: string) => void;
}

export async function streamChat(
  query: string,
  activePdfs: string[] | null,
  topK: number | null,
  callbacks: SSECallbacks
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, active_pdfs: activePdfs, top_k: topK }),
  });

  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({ detail: "Chat request failed" }));
    callbacks.onError?.(err.detail || "Chat request failed");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "retrieved_items" && data.items) {
            callbacks.onRetrievedItems?.(data.items);
          } else if (data.type === "token" && data.content) {
            callbacks.onToken?.(data.content);
          } else if (data.type === "done") {
            callbacks.onDone?.();
          }
        } catch {
          // ignore malformed lines
        }
      }
    }
  }
  callbacks.onDone?.();
}

export async function streamSummaryChat(
  pdfName: string,
  question: string,
  history: { role: string; content: string }[] | null,
  callbacks: {
    onToken?: (token: string) => void;
    onDone?: () => void;
    onError?: (error: string) => void;
  }
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/summaries/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pdf_name: pdfName, question, history }),
  });

  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({ detail: "Summary chat failed" }));
    callbacks.onError?.(err.detail || "Summary chat failed");
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "token" && data.content) {
            callbacks.onToken?.(data.content);
          } else if (data.type === "done") {
            callbacks.onDone?.();
          }
        } catch {
          // ignore
        }
      }
    }
  }
  callbacks.onDone?.();
}

export function getPdfUrl(name: string): string {
  return `${API_BASE}/api/pdf-file/${encodeURIComponent(name)}`;
}

export function getImageUrl(filename: string): string {
  return `${API_BASE}/api/images/${encodeURIComponent(filename)}`;
}
