import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import Dashboard from "@/pages/Dashboard";
import DomViewer from "@/pages/DomViewer";
import SpiderResults from "@/pages/SpiderResults";
import Proxy from "@/pages/Proxy";
import Keylogger from "@/pages/Keylogger";
import Logs from "@/pages/Logs";

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-center px-4">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-muted-foreground">Page not found.</p>
      <Link to="/" className="text-sm text-blue-600 hover:underline">
        Back to dashboard
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/view/:id" element={<DomViewer />} />
        <Route path="/spider/:id" element={<SpiderResults />} />
        <Route path="/proxy/:id" element={<Proxy />} />
        <Route path="/keylogger/:id" element={<Keylogger />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/logs/:clientId" element={<Logs />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
