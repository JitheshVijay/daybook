import React from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "next-themes"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { App } from "./App.jsx"
import "./index.css"

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="daybook.theme">
      <TooltipProvider delayDuration={300}>
        <App />
        <Toaster position="bottom-center" />
      </TooltipProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
