import React from "react";
import { createRoot } from "react-dom/client";
import { ReviewPage } from "./routes/review";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ReviewPage />
  </React.StrictMode>,
);
