import "./ShotMap.css";

/* Shared shot-map pieces, used by the player panel and the Shots tab.
   Shots are drawn on the attacking half, turned so the goal is at the top (80 wide × 60 deep, in
   StatsBomb units). StatsBomb records every team attacking towards x = 120, so every team's shots
   land on the same goal and each team gets its own half-pitch. */

export type Side = "home" | "away";
export type ShotKind = "goal" | "saved" | "off" | "blocked";

/** The fields a marker needs (both the player panel's shots and /xg's shots have them). */
export interface ShotPoint {
  x: number | null;
  y: number | null;
  xg: number;
  outcome: string | null;
}

/** StatsBomb's shot outcomes, grouped into the four the map shows. */
export function shotKind(outcome: string | null): ShotKind {
  if (outcome === "Goal") return "goal";
  if (outcome === "Saved" || outcome === "Saved to Post") return "saved";
  if (outcome === "Blocked") return "blocked";
  return "off"; // "Off T", "Wayward", "Post", "Saved Off Target"
}

export const KIND_LABEL: Record<ShotKind, string> = { goal: "Goal", saved: "Saved", off: "Off target", blocked: "Blocked" };

/** Pitch markings for the whole pitch (120 × 80), used by the pass and touch maps. */
export function FullPitch() {
  return (
    <g className="sm-lines">
      <rect x="0" y="0" width="120" height="80" rx="1.5" />
      <line x1="60" y1="0" x2="60" y2="80" />
      <circle cx="60" cy="40" r="10" />
      <circle cx="60" cy="40" r="0.7" className="sm-lines__spot" />
      <rect x="0" y="18" width="18" height="44" />
      <rect x="0" y="30" width="6" height="20" />
      <rect x="102" y="18" width="18" height="44" />
      <rect x="114" y="30" width="6" height="20" />
      <circle cx="12" cy="40" r="0.7" className="sm-lines__spot" />
      <circle cx="108" cy="40" r="0.7" className="sm-lines__spot" />
      <path d="M18 32 A10 10 0 0 1 18 48" />
      <path d="M102 32 A10 10 0 0 0 102 48" />
      <rect x="-1.6" y="36" width="1.6" height="8" />
      <rect x="120" y="36" width="1.6" height="8" />
    </g>
  );
}

/** Pitch markings for the attacking half. */
export function HalfPitch() {
  return (
    <g className="sm-lines">
      <rect x="0" y="0" width="80" height="60" />
      <rect x="18" y="0" width="44" height="18" />
      <rect x="30" y="0" width="20" height="6" />
      <circle cx="40" cy="12" r="0.7" className="sm-lines__spot" />
      <path d="M32 18 A10 10 0 0 0 48 18" />
      <path d="M30 60 A10 10 0 0 1 50 60" />
      <rect x="36" y="-1.6" width="8" height="1.6" />
    </g>
  );
}

type HalfPitchShotsProps<T extends ShotPoint> = {
  shots: T[];
  side: Side;
  selected: T | null;
  onSelect: (shot: T) => void;
  label: string; // what a screen reader hears for the whole map
  describe: (shot: T) => string; // ...and for one marker
};

/** A half-pitch with one marker per shot: filled = goal, outlined = saved, dashed = off target,
 *  diamond = blocked. Bigger marker = higher xG. Hover, click, tab or Enter selects a shot. */
export function HalfPitchShots<T extends ShotPoint>({ shots, side, selected, onSelect, label, describe }: HalfPitchShotsProps<T>) {
  // biggest chances first, so the small ones are drawn on top and stay clickable
  const drawn = shots.filter((s) => s.x !== null && s.y !== null).sort((a, b) => b.xg - a.xg);
  return (
    <svg className="sm-map" viewBox="-3 -3 86 66" role="img" aria-label={label}>
      <rect x="0" y="0" width="80" height="60" rx="1.5" className="sm-grass" />
      <HalfPitch />
      {drawn.map((s, i) => {
        const cx = s.y!; // across the pitch
        const cy = 120 - s.x!; // distance from goal (goal line at the top)
        const r = 1.3 + Math.sqrt(s.xg) * 4.2;
        const kind = shotKind(s.outcome);
        const pick = () => onSelect(s);
        return (
          <g
            key={i}
            className={`sm-shot sm-shot--${kind} sm-team--${side}`}
            tabIndex={0}
            role="button"
            aria-label={describe(s)}
            aria-pressed={selected === s}
            onClick={pick}
            onMouseEnter={pick}
            onFocus={pick}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                pick();
              }
            }}
          >
            {selected === s && <circle cx={cx} cy={cy} r={r + 1.4} className="sm-shot__ring" />}
            {kind === "blocked" ? (
              <rect x={cx - r * 0.75} y={cy - r * 0.75} width={r * 1.5} height={r * 1.5} transform={`rotate(45 ${cx} ${cy})`} />
            ) : (
              <circle cx={cx} cy={cy} r={r} />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** The small legend icon for an outcome, in the team colour (or the text colour without a side). */
export function ShotIcon({ kind, side }: { kind: ShotKind; side?: Side }) {
  return <span className={`sm-icon sm-icon--${kind}${side ? ` sm-team--${side}` : ""}`} aria-hidden="true" />;
}
