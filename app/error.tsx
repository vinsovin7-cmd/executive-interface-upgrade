"use client";

import { useEffect, useState } from "react";
import { RefreshCw, AlertCircle } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  if (!hydrated) {
    return null;
  }

  return (
    <div
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "16px",
        padding: "24px",
        textAlign: "center",
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial',
        color: "#e8e8e8",
        background: "linear-gradient(180deg, #0a0a0f 0%, #12121a 100%)",
      }}
    >
      <AlertCircle size={48} style={{ color: "#f59e0b" }} />
      <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>
        Something went wrong
      </h2>
      <p style={{ margin: 0, fontSize: "0.875rem", color: "#9ca3af", maxWidth: "420px" }}>
        {error?.message ?? "An unexpected error occurred."}
        {error?.digest && (
          <span style={{ display: "block", marginTop: "8px", fontSize: "0.75rem", color: "#6b7280" }}>
            Digest: {error.digest}
          </span>
        )}
      </p>
      <button
        onClick={reset}
        style={{
          marginTop: "16px",
          padding: "10px 20px",
          border: "1px solid #374151",
          borderRadius: "8px",
          background: "rgba(31, 41, 55, 0.8)",
          color: "#e8e8e8",
          fontSize: "0.875rem",
          fontWeight: 500,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          transition: "background 0.15s, border-color 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(55, 65, 81, 0.9)";
          e.currentTarget.style.borderColor = "#4b5563";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(31, 41, 55, 0.8)";
          e.currentTarget.style.borderColor = "#374151";
        }}
      >
        <RefreshCw size={16} /> Try again
      </button>
      <p style={{ marginTop: "24px", fontSize: "0.75rem", color: "#6b7280" }}>
        If this persists, please refresh the page or clear your browser cache.
      </p>
    </div>
  );
}