import { useState } from "react";
import Wireframes from "./pages/Wireframes";
import F7ComponentShowcase from "./pages/F7ComponentShowcase";

export default function App() {
  const [view, setView] = useState("wireframes");

  return (
    <div className="min-h-screen">
      {/* View Toggle */}
      <div className="fixed top-4 right-4 z-50 flex gap-2 bg-white rounded-lg shadow-lg p-1 border">
        <button
          onClick={() => setView("wireframes")}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            view === "wireframes"
              ? "bg-gray-900 text-white"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          Wireframes
        </button>
        <button
          onClick={() => setView("f7-showcase")}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            view === "f7-showcase"
              ? "bg-gray-900 text-white"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          F7 Components
        </button>
      </div>

      {view === "wireframes" ? <Wireframes /> : <F7ComponentShowcase />}
    </div>
  );
}
