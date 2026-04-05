/**
 * Vercel Serverless Function — Met Museum artifact detail proxy.
 * Called by the Artifact Investigation Studio plugin via API_PROXY_REQUEST.
 *
 * Endpoint: GET /api/artifacts-detail?id=<objectID>
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

const MET_BASE = "https://collectionapi.metmuseum.org/public/collection/v1";

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const id = String(req.query.id || "").trim();
  if (!id) {
    return res.status(400).json({ error: "Missing query parameter: id" });
  }

  const objectID = parseInt(id, 10);
  if (isNaN(objectID)) {
    return res.status(400).json({ error: "Invalid object ID" });
  }

  try {
    const metRes = await fetch(`${MET_BASE}/objects/${objectID}`);
    if (!metRes.ok) {
      return res.status(404).json({ error: "Object not found" });
    }

    const obj = (await metRes.json()) as MetObject;

    const descParts: string[] = [];
    if (obj.artistDisplayName) descParts.push(`Created by ${obj.artistDisplayName}.`);
    if (obj.period) descParts.push(`Period: ${obj.period}.`);
    if (obj.classification) descParts.push(`Classification: ${obj.classification}.`);
    if (obj.culture) descParts.push(`Culture: ${obj.culture}.`);

    let description: string | null = descParts.length > 0 ? descParts.join(" ") : null;
    if (description && !isK12Safe(description)) {
      description = "[Content filtered]";
    }

    return res.status(200).json({
      id: String(obj.objectID),
      title: obj.title || "Untitled",
      date: obj.objectDate || "Unknown",
      medium: obj.medium || null,
      dimensions: obj.dimensions || null,
      provenance: obj.creditLine || null,
      description,
      imageUrl: obj.primaryImage || obj.primaryImageSmall || null,
      source: "met",
      metadata: {
        department: obj.department,
        culture: obj.culture,
        period: obj.period,
        country: obj.country,
        classification: obj.classification,
        artistDisplayName: obj.artistDisplayName,
        objectURL: obj.objectURL,
      },
    });
  } catch (err) {
    console.error("[artifacts-detail] Error:", err);
    return res.status(502).json({
      error: "Met Museum API temporarily unavailable. Please try again.",
      id,
    });
  }
}
