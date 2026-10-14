import { useCallback, useEffect, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import type { LineupPlayer, MatchDetail, MatchLineups } from "../types/api";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { PlayerPanel } from "../components/PlayerPanel";
import { shortName } from "../utils/format";
import "./Lineups.css";

type Side = "home" | "away";

/* Where each StatsBomb position stands, as if the team attacks to the right on a
   120 × 80 pitch (x: own goal → opponent goal, y: left touchline → right touchline).
   Only the team's own half is used, so both XIs fit on one pitch. */
const POSITION_SPOTS: Record<string, [number, number]> = {
  Goalkeeper: [4, 40],
  "Right Back": [30, 72],
  "Right Wing Back": [42, 74],
  "Right Center Back": [26, 54],
  "Center Back": [24, 40],
  "Left Center Back": [26, 26],
  "Left Back": [30, 8],
  "Left Wing Back": [42, 6],
  "Right Defensive Midfield": [52, 52],
  "Center Defensive Midfield": [52, 40],
  "Left Defensive Midfield": [52, 28],
  "Right Midfield": [68, 70],
  "Right Center Midfield": [64, 56],
  "Left Center Midfield": [64, 24],
  "Left Midfield": [68, 10],
  "Right Attacking Midfield": [80, 62],
  "Center Attacking Midfield": [80, 40],
  "Left Attacking Midfield": [80, 18],
  "Right Wing": [94, 66],
  "Left Wing": [94, 14],
  "Right Center Forward": [104, 52],
  "Center Forward": [106, 40],
  "Left Center Forward": [104, 28],
};

/** Percent position of a starter on the pitch. Home attacks right (or up on a vertical pitch),
 *  away is mirrored. */
function spotOnPitch(position: string | null, side: Side, vertical: boolean) {
  const [x, y] = POSITION_SPOTS[position ?? ""] ?? [60, 40]; // unknown position: centre spot
  const depth = 3 + (x / 120) * 44; // 3%..47%: each team stays in its own half
  if (!vertical) {
    const top = 6 + (y / 80) * 88;
    return side === "home" ? { left: depth, top } : { left: 100 - depth, top: 100 - top };
  }
  const across = 8 + (y / 80) * 84;
  return side === "home" ? { left: across, top: 100 - depth } : { left: 100 - across, top: depth };
}

function Pitch({ vertical }: { vertical: boolean }) {
  // pitch markings in StatsBomb's 120 × 80 units (rotated for the vertical layout)
  return vertical ? (
    <svg className="lu-pitch__svg" viewBox="0 0 80 120" aria-hidden="true">
      <rect x="0" y="0" width="80" height="120" rx="3" className="lu-pitch__grass" />
      <g className="lu-pitch__lines">
        <rect x="1" y="1" width="78" height="118" rx="1" />
        <line x1="1" y1="60" x2="79" y2="60" />
        <circle cx="40" cy="60" r="9.15" />
        <rect x="18" y="1" width="44" height="18" />
        <rect x="30" y="1" width="20" height="6" />
        <rect x="18" y="101" width="44" height="18" />
        <rect x="30" y="113" width="20" height="6" />
        <path d="M32.7 19 A9.15 9.15 0 0 0 47.3 19" />
        <path d="M32.7 101 A9.15 9.15 0 0 1 47.3 101" />
      </g>
    </svg>
  ) : (
    <svg className="lu-pitch__svg" viewBox="0 0 120 80" aria-hidden="true">
      <rect x="0" y="0" width="120" height="80" rx="3" className="lu-pitch__grass" />
      <g className="lu-pitch__lines">
        <rect x="1" y="1" width="118" height="78" rx="1" />
        <line x1="60" y1="1" x2="60" y2="79" />
        <circle cx="60" cy="40" r="9.15" />
        <rect x="1" y="18" width="18" height="44" />
        <rect x="1" y="30" width="6" height="20" />
        <rect x="101" y="18" width="18" height="44" />
        <rect x="113" y="30" width="6" height="20" />
        <path d="M19 32.7 A9.15 9.15 0 0 1 19 47.3" />
        <path d="M101 32.7 A9.15 9.15 0 0 0 101 47.3" />
      </g>
    </svg>
  );
}

/* ── Goals and cards ── */

/** "goal 23' (pen), 108'" / "own goal 70'" / "yellow card 45+7'" — for tooltips and screen readers. */
function eventsText(p: LineupPlayer): string {
  const parts: string[] = [];
  const goals = p.goals.filter((g) => !g.own_goal);
  const ownGoals = p.goals.filter((g) => g.own_goal);
  const when = (label: string, period: number) => (period === 5 ? "in the shootout" : label);
  if (goals.length) {
    parts.push(`${goals.length === 1 ? "goal" : `${goals.length} goals`} ${goals.map((g) => g.minute_label + (g.penalty ? " (pen)" : "")).join(", ")}`);
  }
  if (ownGoals.length) parts.push(`own goal ${ownGoals.map((g) => g.minute_label).join(", ")}`);
  for (const c of p.yellow_red_cards) {
    const name = c.card === "Second Yellow" ? "second yellow, sent off" : c.card.toLowerCase();
    parts.push(`${name} ${when(c.minute_label, c.period)}`);
  }
  return parts.join(", ");
}

/** The most serious card decides the icon: a red, a second yellow (yellow + red), or a yellow. */
function worstCard(p: LineupPlayer): "red" | "second-yellow" | "yellow" | null {
  const cards = p.yellow_red_cards.map((c) => c.card);
  if (cards.includes("Red Card")) return "red";
  if (cards.includes("Second Yellow")) return "second-yellow";
  return cards.length ? "yellow" : null;
}

function EventIcons({ player, compact = false }: { player: LineupPlayer; compact?: boolean }) {
  const goals = player.goals.filter((g) => !g.own_goal).length;
  const ownGoals = player.goals.filter((g) => g.own_goal).length;
  const card = worstCard(player);
  if (!goals && !ownGoals && !card) return null;
  return (
    <span className={`lu-events${compact ? " lu-events--compact" : ""}`} aria-hidden="true">
      {goals > 0 && (
        <span className="lu-ball">
          <span className="lu-ball__dot" />
          {goals > 1 && <span className="lu-ball__count">{goals}</span>}
        </span>
      )}
      {ownGoals > 0 && (
        <span className="lu-ball lu-ball--own">
          <span className="lu-ball__dot" />
          <span className="lu-ball__count">OG</span>
        </span>
      )}
      {card === "second-yellow" ? (
        <span className="lu-card-pair">
          <span className="lu-card lu-card--yellow" />
          <span className="lu-card lu-card--red" />
        </span>
      ) : (
        card && <span className={`lu-card lu-card--${card}`} />
      )}
    </span>
  );
}

type BenchProps = { side: Side; teamName: string; players: LineupPlayer[]; onOpen: (playerId: number) => void };

function Bench({ side, teamName, players, onOpen }: BenchProps) {
  const [showUnused, setShowUnused] = useState(false);
  const used = players.filter((p) => p.minutes_played !== null);
  const unused = players.filter((p) => p.minutes_played === null);
  const shown = showUnused ? [...used, ...unused] : used;

  return (
    <section className="overview-card lu-bench" aria-labelledby={`bench-${side}`}>
      <div className="lu-bench__head">
        <h3 id={`bench-${side}`}>
          <span className={`lu-dot lu-dot--${side}`} aria-hidden="true" />
          {teamName}
        </h3>
        <span className="lu-bench__sub">
          {players.length} substitutes · {used.length} used
        </span>
      </div>

      <ul className="lu-bench__list">
        {shown.map((p) => (
          <li key={p.player_id}>
            <button
              type="button"
              className={`lu-bench__row${p.minutes_played === null ? " is-unused" : ""}`}
              title={eventsText(p) || undefined}
              onClick={() => onOpen(p.player_id)}
            >
              <span className={`lu-number lu-number--${side}`}>{p.jersey_number}</span>
              <span className="lu-bench__name">
                <span className="lu-bench__name-line">
                  <span className="lu-bench__name-text">{p.player_name}</span>
                  <EventIcons player={p} compact />
                </span>
                {/* "Left Back · for Acuña" */}
                {(p.position || p.subbed_on) && (
                  <span className="lu-bench__meta">
                    {[p.position, p.subbed_on && `for ${p.subbed_on.replaced}`].filter(Boolean).join(" · ")}
                  </span>
                )}
              </span>
              {p.subbed_on ? (
                <span className="lu-bench__when">
                  <span className={`lu-sub lu-sub--on lu-sub--${side}`} aria-label={`came on ${p.subbed_on.minute_label}`}>
                    ↑ {p.subbed_on.minute_label}
                  </span>
                  <span className={`lu-minutes lu-minutes--${side}`}>{p.minutes_played}'</span>
                </span>
              ) : p.minutes_played !== null ? (
                <span className={`lu-minutes lu-minutes--${side}`}>{p.minutes_played}'</span>
              ) : (
                <span className="lu-bench__meta">Unused</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {unused.length > 0 && (
        <button type="button" className="btn btn-ghost lu-bench__toggle" onClick={() => setShowUnused((v) => !v)} aria-expanded={showUnused}>
          {showUnused ? "Hide unused" : `+${unused.length} unused`}
        </button>
      )}
    </section>
  );
}

export function Lineups() {
  const { match } = useOutletContext<{ match: MatchDetail }>();
  const [lineups, setLineups] = useState<MatchLineups | null>(null);
  const [failed, setFailed] = useState(false);
  // narrower screens: turn the pitch upright so the names have room
  const vertical = useMediaQuery("(max-width: 1099px)");
  // the open player lives in the URL (?player=5503), so the panel survives a refresh
  // and the browser's back button closes it
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = Number(searchParams.get("player")) || null;
  const openPlayer = (playerId: number) => setSearchParams({ player: String(playerId) });
  const closePlayer = useCallback(() => setSearchParams({}), [setSearchParams]);

  useEffect(() => {
    const controller = new AbortController();
    setLineups(null);
    setFailed(false);
    fetch(`/api/matches/${match.id}/lineups`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Failed to load lineups (${response.status})`);
        setLineups(await response.json());
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [match.id]);

  if (failed) {
    return <p className="lu-message">Couldn't load the lineups.</p>;
  }
  if (!lineups) {
    return <span className="skeleton-bar" style={{ width: "100%", height: 420 }} aria-label="Loading lineups" />;
  }

  const teams = [
    { side: "home" as Side, id: match.home_team.id, name: match.home_team.name },
    { side: "away" as Side, id: match.away_team.id, name: match.away_team.name },
  ].map((t) => {
    const squad = lineups.players[String(t.id)] ?? []; // JSON object keys are strings
    const formation = lineups.formations[String(t.id)];
    return { ...t, formation, starters: squad.filter((p) => p.starter), bench: squad.filter((p) => !p.starter) };
  });

  return (
    <div className="lu-page">
      <section className="overview-card lu-xi" aria-labelledby="xi-title">
        <div className="lu-xi__head">
          <h3 id="xi-title">Starting XIs</h3>
          <div className="lu-legend" aria-hidden="true">
            {teams.map((t) => (
              <span key={t.side}>
                <span className={`lu-dot lu-dot--${t.side}`} />
                {t.name}
                {t.formation && <span className="lu-formation">{t.formation}</span>}
              </span>
            ))}
          </div>
        </div>

        <div className={`lu-pitch${vertical ? " lu-pitch--vertical" : ""}`}>
          <Pitch vertical={vertical} />
          {teams.map((t) =>
            t.starters.map((p) => {
              const { left, top } = spotOnPitch(p.position, t.side, vertical);
              const events = eventsText(p);
              const off = p.subbed_off ? `, subbed off ${p.subbed_off.minute_label} for ${p.subbed_off.replaced_by}` : "";
              const label = `${p.jersey_number} ${p.player_name}, ${p.position ?? "position unknown"}, ${p.minutes_played ?? 0} minutes${off}${events ? `, ${events}` : ""}`;
              return (
                <button
                  type="button"
                  key={p.player_id}
                  className="lu-player"
                  style={{ left: `${left}%`, top: `${top}%` }}
                  aria-label={`${label}. Show player stats`}
                  title={label}
                  onClick={() => openPlayer(p.player_id)}
                >
                  <span className="lu-player__badge">
                    <span className={`lu-player__number lu-player__number--${t.side}`}>{p.jersey_number}</span>
                    <EventIcons player={p} />
                    {p.subbed_off && (
                      <span className="lu-sub lu-sub--off" aria-hidden="true">
                        ↓ {p.subbed_off.minute_label}
                      </span>
                    )}
                  </span>
                  <span className="lu-player__name">{shortName(p.player_name)}</span>
                </button>
              );
            }),
          )}
        </div>
      </section>

      <div className="lu-benches">
        {teams.map((t) => (
          <Bench key={t.side} side={t.side} teamName={t.name} players={t.bench} onOpen={openPlayer} />
        ))}
      </div>

      {openId && <PlayerPanel match={match} playerId={openId} onClose={closePlayer} />}
    </div>
  );
}

export default Lineups;
