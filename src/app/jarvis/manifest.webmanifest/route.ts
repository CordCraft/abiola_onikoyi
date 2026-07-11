import { NextResponse } from "next/server";

export const dynamic = "force-static";

// The PWA manifest is linked only from Jarvis pages (see jarvis/layout.tsx),
// so installing from the public portfolio does not adopt the Jarvis identity.
export function GET() {
  return NextResponse.json(
    {
      name: "Jarvis — Abiola Onikoyi",
      short_name: "Jarvis",
      description:
        "Abiola Onikoyi's personal second brain: ventures, projects, documents, and an AI chief of staff.",
      id: "/jarvis",
      start_url: "/jarvis",
      scope: "/",
      display: "standalone",
      background_color: "#f6f6f9",
      theme_color: "#18181b",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
      // Android: share text/links from any app straight into the Jarvis inbox
      share_target: {
        action: "/jarvis/capture",
        method: "GET",
        params: { title: "title", text: "text", url: "url" },
      },
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
}
