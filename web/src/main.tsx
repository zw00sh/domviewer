import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

// Apply dark mode based on OS preference, and update when it changes
const darkMq = window.matchMedia("(prefers-color-scheme: dark)");
document.documentElement.classList.toggle("dark", darkMq.matches);
darkMq.addEventListener("change", (e) =>
  document.documentElement.classList.toggle("dark", e.matches)
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
      <Toaster richColors closeButton />
    </TooltipProvider>
  </StrictMode>
);
