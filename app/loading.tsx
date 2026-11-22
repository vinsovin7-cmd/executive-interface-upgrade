"use client";

import { Loader2 } from "lucide-react";

export default function Loading() {
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
      <Loader2
        size={32}
        style={{
          color: "#a98bea",
          animation: "spin 1s linear infinite",
        }}
      />
      <style jsx>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
      <p style={{ margin: 0, fontSize: "0.875rem", color: "#9ca3af" }}>Loading CyberNode…</p>
    </div>
  );
}