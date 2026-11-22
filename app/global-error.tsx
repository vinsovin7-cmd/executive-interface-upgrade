"use client";

import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";

export default function GlobalError({
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
    <html lang="en" className="h-full">
      <body className="h-full w-full bg-[#0a0a0f]">
        <div
          style={{
            minHeight: "100vh",
            width: "100vw",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "16px",
            padding: "32px 16px",
            textAlign: "center",
            fontFamily:
              'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial',
            color: "#e8e8e8",
          }}
        >
          <AlertCircle size={56} style={{ color: "#f59e0b" }} />
          <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>
            Application error
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
            }}
          >
            <span>Refresh page</span>
          </button>
        </div>
      </body>
    </html>
  );
}