import React from "react";
import ReactDOM from "react-dom/client";
import Framework7 from "framework7/lite";
import Framework7React from "framework7-react";
import "framework7/css/bundle";
import App from "./App";
import "./index.css";

// Initialize Framework7 React plugin
Framework7.use(Framework7React);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
