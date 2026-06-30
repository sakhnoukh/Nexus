import { Routes, Route, Navigate } from "react-router-dom";
import Chatbot from "./pages/Chatbot";
import Summaries from "./pages/Summaries";
import PdfViewer from "./pages/PdfViewer";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Chatbot />} />
      <Route path="/summaries" element={<Summaries />} />
      <Route path="/viewer" element={<PdfViewer />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
