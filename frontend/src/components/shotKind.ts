/* Shot outcome groups shared by the shot maps (kept out of ShotMap.tsx so that file only exports
   components, which React fast refresh needs). */

export type ShotKind = "goal" | "saved" | "off" | "blocked";

/** StatsBomb's shot outcomes, grouped into the four the map shows. */
export function shotKind(outcome: string | null): ShotKind {
  if (outcome === "Goal") return "goal";
  if (outcome === "Saved" || outcome === "Saved to Post") return "saved";
  if (outcome === "Blocked") return "blocked";
  return "off"; // "Off T", "Wayward", "Post", "Saved Off Target"
}

export const KIND_LABEL: Record<ShotKind, string> = { goal: "Goal", saved: "Saved", off: "Off target", blocked: "Blocked" };
