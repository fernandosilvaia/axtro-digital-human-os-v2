import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{
    url: absoluteUrl("/"),
    lastModified: new Date("2026-07-24T00:00:00.000Z"),
    changeFrequency: "weekly",
    priority: 1,
  }];
}
