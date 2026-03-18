import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import Dashboard from "@/pages/Dashboard";
import DomViewer from "@/pages/DomViewer";
import SpiderResults from "@/pages/SpiderResults";
import Proxy from "@/pages/Proxy";
import Keylogger from "@/pages/Keylogger";
import Cookies from "@/pages/Cookies";
import Logs from "@/pages/Logs";

function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-6 text-center px-4">
      <pre className="text-hacker-green glow-green-strong text-lg leading-tight select-none">
{`
 ██╗  ██╗ ██████╗ ██╗  ██╗
 ██║  ██║██╔═══██╗██║  ██║
 ███████║██║   ██║███████║
 ╚════██║██║   ██║╚════██║
      ██║╚██████╔╝     ██║
      ╚═╝ ╚═════╝      ╚═╝
`}
      </pre>
      <p className="text-muted-foreground text-sm">
        <span className="text-hacker-red glow-red">ERROR</span> // segment not found
      </p>
      <Link to="/" className="text-sm text-hacker-green/70 hover:text-hacker-green glow-green transition-all">
        &gt; return to dashboard_
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <div className="crt-scanlines noise-bg min-h-screen">
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/view/:id" element={<DomViewer />} />
          <Route path="/spider/:id" element={<SpiderResults />} />
          <Route path="/proxy/:id" element={<Proxy />} />
          <Route path="/keylogger/:id" element={<Keylogger />} />
          <Route path="/cookies/:id" element={<Cookies />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/logs/:clientId" element={<Logs />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </div>
  );
}
