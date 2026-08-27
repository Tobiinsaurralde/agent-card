import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Tokenomics } from "./Tokenomics.js";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource-variable/bricolage-grotesque";
import "../styles.css";

const container = document.getElementById("root");
if (container === null) throw new Error("Falta #root en tokenomics.html");

createRoot(container).render(
  <StrictMode>
    <Tokenomics />
  </StrictMode>,
);
