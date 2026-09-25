import React from "react";
import ReactDOM from "react-dom/client";
import {
  RouterProvider,
} from "react-router-dom";

import { router } from "./app/routes";
// Served with the app, one variable file per face. Each subset is fetched only
// when a page contains its characters, and text renders in the fallback face
// until it arrives rather than waiting blank.
import "@fontsource-variable/geist/wght.css";
import "@fontsource-variable/geist-mono/wght.css";
import "./index.css";
import "./App.css";

ReactDOM.createRoot(
  document.getElementById("root")!,
).render(
  <React.StrictMode>
    <RouterProvider
      router={router}
    />
  </React.StrictMode>,
);