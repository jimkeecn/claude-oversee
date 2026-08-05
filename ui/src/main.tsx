import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyThemePref, getThemePref } from "./theme";
import "./styles.css";

applyThemePref(getThemePref());

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
