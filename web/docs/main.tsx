import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Docs } from "./Docs.js";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/bricolage-grotesque";
import "../styles.css";

const container = document.getElementById("root");
if (container === null) throw new Error("Falta #root en docs.html");

createRoot(container).render(
  <StrictMode>
    <Docs />
  </StrictMode>,
);
