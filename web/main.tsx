import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/instrument-serif";
import "@fontsource/instrument-serif/400-italic.css";
import "./styles.css";

const container = document.getElementById("root");
if (container === null) throw new Error("Falta #root en index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
