import { useEffect, useRef, useState, type ReactNode } from "react";
import type { MatchDetail, PlayerMatch, PlayerPassPoint, PlayerRank, PlayerShotPoint } from "../types/api";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { FullPitch, HalfPitchShots, KIND_LABEL, ShotIcon, shotKind, type Side } from "./ShotMap";
import "./PlayerPanel.css";

/* The player panel: a drawer that opens over the page when a player is clicked
   (on the Lineups pitch or bench). It loads GET /matches/{id}/players/{player_id}.
   Pitch coordinates are StatsBomb's 120 × 80, with the player's team always attacking
   towards x = 120, so every map points the same way whichever half it was. */

type View = "shots" | "passes" | "touches";
type PassFilter = "all" | "completed" | "incomplete";

/* ── small helpers ── */

/** 1 → "1st", 2 → "2nd", 11 → "11th", 22 → "22nd" */
function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th"}`;
}

/** "Joint 2nd of 17 for passes in Argentina" (empty when the player has none of that stat) */
function rankText(rank: PlayerRank | null, label: string, team: string): string {
  if (!rank) return "";
  return `${rank.joint ? "Joint " : ""}${ordinal(rank.rank)} of ${rank.of} for ${label} in ${team}`;
}

function shotText(s: PlayerShotPoint): { title: string; body: string } {
  const parts = [`${s.xg.toFixed(2)} xG`, s.body_part, s.shot_type].filter(Boolean);
  return { title: `${s.minute_label} ${KIND_LABEL[shotKind(s.outcome)]}`, body: parts.join(" · ") };
}

/* ── the three maps ── */

function ShotMap({ shots, side, name }: { shots: PlayerShotPoint[]; side: Side; name: string }) {
  // default selection: the first goal, otherwise the biggest chance
  const fallback = shots.find((s) => s.outcome === "Goal") ?? [...shots].sort((a, b) => b.xg - a.xg)[0] ?? null;
  const [selected, setSelected] = useState<PlayerShotPoint | null>(null);
  const current = selected ?? fallback;
  const totalXg = shots.reduce((sum, s) => sum + s.xg, 0);

  return (
    <>
      <HalfPitchShots
        shots={shots}
        side={side}
        selected={current}
        onSelect={setSelected}
        label={`Shot map for ${name}: ${shots.length} shots, ${totalXg.toFixed(2)} xG`}
        describe={(s) => `${shotText(s).title}, ${shotText(s).body}`}
      />
      {current && (
        <div className="pp-shot-detail" aria-live="polite">
          <strong>{shotText(current).title}</strong>
          <span>{shotText(current).body}</span>
        </div>
      )}
    </>
  );
}

function PassMap({ passes, filter, side, name }: { passes: PlayerPassPoint[]; filter: PassFilter; side: Side; name: string }) {
  const shown = passes
    .filter((p) => p.end_x !== null && p.end_y !== null)
    .filter((p) => filter === "all" || (filter === "completed" ? p.completed : !p.completed))
    .sort((a, b) => Number(a.completed) - Number(b.completed)); // completed drawn last, on top
  const completed = passes.filter((p) => p.completed).length;

  return (
    <svg className="sm-map" viewBox="-3 -3 126 86" role="img" aria-label={`Pass map for ${name}: ${passes.length} passes, ${completed} completed`}>
      <defs>
        {/* arrowheads: one in the team colour, one grey */}
        <marker id={`pp-arrow-${side}`} viewBox="0 0 4 4" refX="3.2" refY="2" markerWidth="3.2" markerHeight="3.2" markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0 0 L4 2 L0 4 z" className={`pp-arrow pp-arrow--${side}`} />
        </marker>
        <marker id="pp-arrow-miss" viewBox="0 0 4 4" refX="3.2" refY="2" markerWidth="3" markerHeight="3" markerUnits="userSpaceOnUse" orient="auto">
          <path d="M0 0 L4 2 L0 4 z" className="pp-arrow pp-arrow--miss" />
        </marker>
      </defs>
      <rect x="0" y="0" width="120" height="80" rx="1.5" className="sm-grass" />
      <FullPitch />
      {shown.map((p, i) => (
        <line
          key={i}
          x1={p.x}
          y1={p.y}
          x2={p.end_x!}
          y2={p.end_y!}
          className={p.completed ? `pp-pass pp-pass--${side}` : "pp-pass pp-pass--miss"}
          markerEnd={`url(#${p.completed ? `pp-arrow-${side}` : "pp-arrow-miss"})`}
        />
      ))}
    </svg>
  );
}

function TouchMap({ touches, side, name }: { touches: { x: number; y: number }[]; side: Side; name: string }) {
  // count touches in a 12 × 8 grid of 10 × 10 cells, then shade each cell by its share of the busiest one
  const bins = Array.from({ length: 8 }, () => Array<number>(12).fill(0));
  for (const t of touches) bins[Math.min(7, Math.floor(t.y / 10))][Math.min(11, Math.floor(t.x / 10))]++;
  const busiest = Math.max(1, ...bins.flat());

  return (
    <svg className="sm-map" viewBox="-3 -3 126 86" role="img" aria-label={`Touch heatmap for ${name}: ${touches.length} touches`}>
      <defs>
        <filter id="pp-blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="4.5" />
        </filter>
        <clipPath id="pp-clip">
          <rect x="0" y="0" width="120" height="80" rx="1.5" />
        </clipPath>
      </defs>
      <rect x="0" y="0" width="120" height="80" rx="1.5" className="sm-grass" />
      {/* the blur turns the grid of squares into a smooth heatmap; the clip keeps it on the pitch */}
      <g clipPath="url(#pp-clip)">
        <g filter="url(#pp-blur)">
          {bins.flatMap((row, j) =>
            row.map((count, i) =>
              count ? (
                <rect
                  key={`${i}-${j}`}
                  x={i * 10}
                  y={j * 10}
                  width="10"
                  height="10"
                  className={`pp-heat pp-heat--${side}`}
                  opacity={Math.pow(count / busiest, 0.75) * 0.9}
                />
              ) : null,
            ),
          )}
        </g>
      </g>
      <FullPitch />
    </svg>
  );
}

/* ── the panel ── */

type Props = {
  match: MatchDetail;
  playerId: number;
  onClose: () => void;
};

export function PlayerPanel({ match, playerId, onClose }: Props) {
  const [data, setData] = useState<PlayerMatch | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>("shots");
  const [passFilter, setPassFilter] = useState<PassFilter>("all");
  const closeRef = useRef<HTMLButtonElement>(null);
  const mobile = useMediaQuery("(max-width: 759px)");

  // load this player's match
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setFailed(false);
    fetch(`/api/matches/${match.id}/players/${playerId}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Failed to load player (${response.status})`);
        setData(await response.json());
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [match.id, playerId]);

  // while open: Escape closes, the page behind doesn't scroll, and focus moves into the panel
  // (it returns to the clicked player when the panel closes)
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previousFocus?.focus?.();
    };
  }, [onClose]);

  const isHome = data?.player.team_id === match.home_team.id;
  const side: Side = isHome ? "home" : "away";
  const teamName = isHome ? match.home_team.name : match.away_team.name;

  let content: ReactNode;
  if (failed) {
    content = <p className="pp-message">Couldn't load this player.</p>;
  } else if (!data) {
    content = (
      <div className="pp-loading" aria-busy="true" aria-label="Loading player">
        <span className="skeleton-bar" style={{ width: "60%", height: 24 }} />
        <span className="skeleton-bar" style={{ width: "100%", height: 80 }} />
        <span className="skeleton-bar" style={{ width: "100%", height: 260 }} />
      </div>
    );
  } else {
    const { player, summary, maps, ranks } = data;

    // the facts list, in the prototype's order
    const facts: { k: string; v: string }[] = [];
    if (player.starter) {
      facts.push({ k: "Started", v: player.subbed_off ? "Starting XI" : "Played the whole match" });
    }
    if (player.subbed_off) {
      facts.push({ k: "Subbed off", v: `${player.subbed_off.minute_label}, replaced by ${player.subbed_off.replaced_by}` });
    }
    if (player.subbed_on) {
      facts.push({ k: "Came on", v: `${player.subbed_on.minute_label}, for ${player.subbed_on.replaced}` });
    }
    if (!player.starter && !player.subbed_on) facts.push({ k: "Unused substitute", v: "Did not play" });
    if (player.goals.length) {
      facts.push({
        k: player.goals.length > 1 ? "Goals" : "Goal",
        v: player.goals.map((g) => g.minute_label + (g.penalty ? " (pen)" : "")).join(", "),
      });
    }
    for (const c of player.cards) {
      const label = c.card === "Second Yellow" ? "Second yellow (sent off)" : c.card === "Red Card" ? "Red card" : "Yellow card";
      facts.push({ k: label, v: c.period === 5 ? "Penalty shootout" : c.minute_label });
    }

    // the stats and rank above each map
    const viewInfo = {
      shots: {
        stats: [
          { k: "Shots", v: String(summary.shots) },
          { k: "On target", v: String(summary.shots_on_target) },
          { k: "xG", v: summary.xg.toFixed(2) },
          { k: "Goals", v: String(summary.goals) },
        ],
        rank: rankText(ranks.xg, "xG", teamName),
        direction: "Attacking ↑",
        empty: maps.shots.length ? "" : "No shots in this match",
      },
      passes: {
        stats: [
          { k: "Passes", v: String(summary.passes) },
          { k: "Completed", v: summary.passes ? `${Math.round(summary.pass_accuracy)}%` : "–" },
          { k: "Into final third", v: String(summary.passes_into_final_third) },
        ],
        rank: rankText(ranks.passes, "passes", teamName),
        direction: "Attacking →",
        empty: maps.passes.some((p) => passFilter === "all" || (passFilter === "completed" ? p.completed : !p.completed))
          ? ""
          : "No passes to show",
      },
      touches: {
        stats: [
          { k: "Touches", v: String(summary.touches) },
          { k: "In attacking third", v: summary.touches ? `${summary.touches_in_attacking_third_pct}%` : "–" },
        ],
        rank: rankText(ranks.touches, "touches", teamName),
        direction: "Attacking →",
        empty: "",
      },
    }[view];

    content = (
      <>
        <div className="pp-identity">
          <span className={`pp-number pp-number--${side}`}>{player.jersey_number}</span>
          <div className="pp-identity__text">
            <h3>{player.player_name}</h3>
            <span>{player.position ?? "Substitute"}</span>
          </div>
        </div>

        <div className="pp-tiles">
          <div className="pp-tile">
            <span>Minutes</span>
            <strong>{player.minutes_played}</strong>
          </div>
          <div className="pp-tile">
            <span>Goals</span>
            <strong>{summary.goals}</strong>
          </div>
        </div>

        <div className="pp-facts">
          {facts.map((f, i) => (
            <div key={i} className="pp-fact">
              <span className="pp-fact__k">{f.k}</span>
              <span className="pp-fact__v">{f.v}</span>
            </div>
          ))}
        </div>

        <section className="pp-maps" aria-label="Player maps">
          <div className="pp-maps__head">
            <h4>On the pitch</h4>
            <div className="seg" role="radiogroup" aria-label="Choose map">
              {(["shots", "passes", "touches"] as View[]).map((v) => (
                <label key={v} className="seg-opt">
                  <input type="radio" name="pp-view" checked={view === v} onChange={() => setView(v)} />
                  {v[0].toUpperCase() + v.slice(1)}
                </label>
              ))}
            </div>
          </div>

          {player.minutes_played > 0 ? (
            <div className="pp-viz">
              <div className="pp-viz__stats">
                {viewInfo.stats.map((s) => (
                  <div key={s.k}>
                    <span>{s.k}</span>
                    <strong>{s.v}</strong>
                  </div>
                ))}
              </div>

              {(viewInfo.rank || view === "passes") && (
                <div className="pp-viz__bar">
                  {viewInfo.rank && <span className="tag tag-neutral pp-rank">{viewInfo.rank}</span>}
                  {view === "passes" && (
                    <div className="seg pp-pass-filter" role="radiogroup" aria-label="Filter passes">
                      {(
                        [
                          ["all", "All"],
                          ["completed", "Completed"],
                          ["incomplete", "Incomplete"],
                        ] as const
                      ).map(([value, label]) => (
                        <label key={value} className="seg-opt">
                          <input type="radio" name="pp-pass" checked={passFilter === value} onChange={() => setPassFilter(value)} />
                          {label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="pp-viz__map">
                <span className="pp-direction">{viewInfo.direction}</span>
                <div className="pp-viz__frame">
                  {view === "shots" && <ShotMap key={player.player_id} shots={maps.shots} side={side} name={player.player_name} />}
                  {view === "passes" && <PassMap passes={maps.passes} filter={passFilter} side={side} name={player.player_name} />}
                  {view === "touches" && <TouchMap touches={maps.touches} side={side} name={player.player_name} />}
                  {viewInfo.empty && (
                    <div className="pp-empty">
                      <span>{viewInfo.empty}</span>
                    </div>
                  )}
                </div>
              </div>

              {view === "shots" && (
                <div className="pp-legend">
                  {(["goal", "saved", "off", "blocked"] as const).map((k) => (
                    <span key={k}>
                      <ShotIcon kind={k} side={side} />
                      {KIND_LABEL[k]}
                    </span>
                  ))}
                  <span>Bigger = higher xG · tap a shot</span>
                </div>
              )}
              {view === "passes" && (
                <div className="pp-legend">
                  <span><span className={`pp-key-line pp-key-line--${side}`} />Completed</span>
                  <span><span className="pp-key-line pp-key-line--miss" />Incomplete</span>
                </div>
              )}
              {view === "touches" && (
                <div className="pp-legend">
                  <span>Fewer</span>
                  <span className={`pp-gradient pp-gradient--${side}`} />
                  <span>More touches</span>
                </div>
              )}
            </div>
          ) : (
            <div className="pp-did-not-play">
              <h5>Didn't play</h5>
              <p>Unused substitutes have no shots, passes or touches to map.</p>
            </div>
          )}
        </section>
      </>
    );
  }

  return (
    <div className="pp-backdrop" onClick={onClose}>
      <aside
        className={`pp-drawer${mobile ? " pp-drawer--mobile" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={data?.player.player_name ?? "Player"}
        onClick={(e) => e.stopPropagation()} // clicks inside the panel don't close it
      >
        <div className="pp-top">
          {data ? <span className={`tag ${isHome ? "tag-accent" : "tag-accent-2"} pp-team`}>{teamName}</span> : <span />}
          <button ref={closeRef} type="button" className="btn btn-ghost btn-icon" aria-label="Close player panel" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        {content}
      </aside>
    </div>
  );
}

export default PlayerPanel;
