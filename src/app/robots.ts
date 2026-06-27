import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/api"],
    },
    sitemap: "https://abiolaonikoyi.com/sitemap.xml",
    host: "https://abiolaonikoyi.com",
  };
}
