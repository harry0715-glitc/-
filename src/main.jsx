import React from "react";
import { createRoot } from "react-dom/client";
import App from "../worker-registry-v2.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
