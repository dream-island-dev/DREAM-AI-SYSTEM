import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import CleaningPage from "./components/CleaningPage";

const rootElement = document.getElementById("root");
const root = createRoot(rootElement);

const cleanMatch = window.location.pathname.match(/^\/clean\/([^/]+)/);

root.render(
  <StrictMode>
    {cleanMatch ? <CleaningPage roomId={cleanMatch[1]} /> : <App />}
  </StrictMode>
);
