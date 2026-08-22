import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Landing } from "./Landing.js";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/syne/600.css";
import "@fontsource/syne/700.css";
import "@fontsource/syne/800.css";
import "../styles.css";

const container = document.getElementById("root");
if (container === null) throw new Error("Falta #root en index.html");

createRoot(container).render(
  <StrictMode>
    <Landing />
  </StrictMode>,
);
