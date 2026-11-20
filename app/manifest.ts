import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "CyberNode — Compute & Rewards Console",
    short_name: "CyberNode",
    description: "CyberNode console with verified TON telemetry and account tools.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#090d16",
    theme_color: "#090d16",
    categories: ["business", "productivity"],
    icons: [
      { src: "/pwa-icon-1024.png", sizes: "1024x1024", type: "image/png", purpose: "any" },
      { src: "/pwa-icon-1024.png", sizes: "1024x1024", type: "image/png", purpose: "maskable" },
      { src: "/pwa-icon-1024.png", sizes: "1024x1024", type: "image/png", purpose: "any" },
      { src: "/pwa-icon-1024.png", sizes: "1024x1024", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
    shortcuts: [
      { name: "Rewards", short_name: "Rewards", url: "/?tab=rewards", icons: [{ src: "/pwa-icon-1024.png", sizes: "1024x1024", type: "image/png" }] },
      { name: "Wallet", short_name: "Wallet", url: "/?tab=wallet", icons: [{ src: "/pwa-icon-1024.png", sizes: "1024x1024", type: "image/png" }] },
    ],
  }
}
