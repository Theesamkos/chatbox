/**
 * Vercel Serverless Function — Met Museum artifact search proxy.
 * Called by the Artifact Investigation Studio plugin via API_PROXY_REQUEST.
 *
 * Endpoint: GET /api/artifacts-search?q=...&page=0&culturalContext=...
 *
 * No API key required — Met Museum Open Access API is fully public.
 * https://metmuseum.github.io/
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

const MET_BASE = "https://collectionapi.metmuseum.org/public/collection/v1";
const PAGE_SIZE = 12;

const K12_PROHIBITED = [
  "nude",
  "naked",
  "explicit",
  "sexual",
  "pornograph",
  "gore",
  "graphic violence",
  "erotic",
];

function isK12Safe(text: string): boolean {
  const lower = text.toLowerCase();
  return !K12_PROHIBITED.some((term) => lower.includes(term));
}

interface MetObject {
  objectID: number;
  title: string;
  objectDate: string;
  medium: string;
  dimensions: string;
  culture: string;
  period: string;
  department: string;
  primaryImage: string;
  primaryImageSmall: string;
  artistDisplayName: string;
  country: string;
  classification: string;
  isPublicDomain: boolean;
  creditLine: string;
  objectURL: string;
}

async function metSearch(query: string, page: number): Promise<number[]> {
  const url = new URL(`${MET_BASE}/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("hasImages", "true");
  url.searchParams.set("isPublicDomain", "true");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Met search responded ${res.status}`);

  const json = (await res.json()) as {
    total: number;
    objectIDs: number[] | null;
  };
  const ids = json.objectIDs ?? [];
  return ids.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
}

async function metGetObject(objectID: number): Promise<MetObject | null> {
  const res = await fetch(`${MET_BASE}/objects/${objectID}`);
  if (!res.ok) return null;

  const obj = (await res.json()) as MetObject;
  if (!obj.primaryImageSmall && !obj.primaryImage) return null;
  return obj;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS — allow the Vercel app itself and any origin (plugin iframe)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const query = String(req.query.q || "").trim();
  const page = Math.max(0, parseInt(String(req.query.page || "0"), 10) || 0);
  const culturalContext = String(req.query.culturalContext || "").trim();

  if (!query) {
    return res.status(400).json({ error: "Missing query parameter: q" });
  }

  try {
    const fullQuery = culturalContext ? `${query} ${culturalContext}` : query;
    const objectIDs = await metSearch(fullQuery, page);

    const settled = await Promise.allSettled(objectIDs.map((id) => metGetObject(id)));

    const artifacts: Array<{
      id: string;
      title: string;
      date: string;
      thumbnailUrl: string | null;
      source: "met";
      culturalContext?: string;
      department?: string;
    }> = [];

    for (const r of settled) {
      if (r.status !== "fulfilled" || !r.value) continue;
      const obj = r.value;
      if (!isK12Safe(obj.title) || !isK12Safe(obj.medium ?? "")) continue;
      artifacts.push({
        id: String(obj.objectID),
        title: obj.title || "Untitled",
        date: obj.objectDate || "Unknown",
        thumbnailUrl: obj.primaryImageSmall || obj.primaryImage || null,
        source: "met",
        culturalContext: obj.culture || obj.country || undefined,
        department: obj.department || undefined,
      });
    }

    return res.status(200).json({
      artifacts,
      totalCount: artifacts.length,
      source: "met",
      page,
    });
  } catch (err) {
    console.error("[artifacts-search] Error:", err);
    // Return 502 so the plugin can distinguish API failure from empty results
    return res.status(502).json({
      artifacts: [],
      totalCount: 0,
      source: "unavailable",
      page,
      error: "Met Museum API temporarily unavailable. Please try again.",
    });
  }
}
