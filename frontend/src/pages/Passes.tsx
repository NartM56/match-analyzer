import { useEffect, useState, type ReactNode } from "react";
import { useOutletContext } from "react-router-dom";
import type { LineupPlayer, MatchDetail, MatchLineups, MatchPass } from "../types/api";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { shortName } from "../utils/format";
import { FullPitch, type Side } from "../components/ShotMap";
import "./Passes.css";

/* Passing tab: a passing network and a pass map for one team, for the whole match or one period.
   Everything comes from two requests, every pass in the match (/passes) and the squads (/lineups,
   for shirt numbers, positions and starters). Only the filter *choices* are stored; per-player
   totals, average positions, links and the arrows shown are worked out from all passes on each render. */

type PeriodFilter = "all" | "1" | "2" | "et";
type PassType = "all" | "completed" | "incomplete" | "progressive" | "box";

const NETWORK_MIN_PASSES = 8; // players with fewer passes aren't drawn on the network

/** One player's passes in the chosen team + period. */
interface Passer {
  id: number;
  name: string;
  passes: number;
  completed: number;
  progressive: number;
  sumX: number; // for the average pass position
  sumY: number;
  to: Map<number, number>; // completed passes to each team-mate
}

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A full pitch, horizontal (attacking →) or upright on phones (attacking ↑).
 *  Children are drawn in screen units, so turn StatsBomb points with `toScreen` first. */
function PassPitch({ vertical, label, defs, children }: { vertical: boolean; label: string; defs?: ReactNode; children: ReactNode }) {
  return (
    <svg className="sm-map pa-map" viewBox={vertical ? "-3 -3 86 126" : "-3 -3 126 86"} role="img" aria-label={label}>
      {defs}
      <rect x="0" y="0" width={vertical ? 80 : 120} height={vertical ? 120 : 80} rx="1.5" className="sm-grass" />
      {/* the markings are drawn horizontally; turning them -90° stands the pitch up */}
      <g transform={vertical ? "translate(0 120) rotate(-90)" : undefined}>
        <FullPitch />
      </g>
      {children}
    </svg>
  );
}

export function Passes() {
  const { match } = useOutletContext<{ match: MatchDetail }>();
  const [passes, setPasses] = useState<MatchPass[] | null>(null);
  const [lineups, setLineups] = useState<MatchLineups | null>(null);
  const [failed, setFailed] = useState(false);

  // filter choices
  const [team, setTeam] = useState<Side>("home");
  const [period, setPeriod] = useState<PeriodFilter>("all");
  const [networkId, setNetworkId] = useState<number | null>(null); // player picked on the network
  const [mapPlayer, setMapPlayer] = useState<number | "all">("all"); // player shown on the pass map
  const [passType, setPassType] = useState<PassType>("all");

  const wide = useMediaQuery("(min-width: 1080px)");
  const vertical = useMediaQuery("(max-width: 759px)"); // phones: stand the pitch up

  useEffect(() => {
    const controller = new AbortController();
    const load = (path: string) =>
      fetch(`/api/matches/${match.id}/${path}`, { signal: controller.signal }).then((response) => {
        if (!response.ok) throw new Error(`Failed to load ${path} (${response.status})`);
        return response.json();
      });
    setPasses(null);
    setLineups(null);
    setFailed(false);
    Promise.all([load("passes"), load("lineups")])
      .then(([passData, lineupData]) => {
        setPasses(passData);
        setLineups(lineupData);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [match.id]);

  if (failed) {
    return <p className="pa-message">Couldn't load the passing data.</p>;
  }
  if (!passes || !lineups) {
    return (
      <div className="pa-page" aria-busy="true" aria-label="Loading passing data">
        <span className="skeleton-bar" style={{ width: "100%", height: 460 }} />
        <span className="skeleton-bar" style={{ width: "100%", height: 460 }} />
        <span className="pa-note">Loading every pass for this match…</span>
      </div>
    );
  }

  const teams = {
    home: { id: match.home_team.id, name: match.home_team.name },
    away: { id: match.away_team.id, name: match.away_team.name },
  };
  const teamName = teams[team].name;
  const squad = new Map<number, LineupPlayer>((lineups.players[String(teams[team].id)] ?? []).map((p) => [p.player_id, p]));
  const fullName = (id: number) => squad.get(id)?.player_name ?? "Unknown";

  const PERIODS: [PeriodFilter, string][] = [
    ["all", "Full match"],
    ["1", "1st half"],
    ["2", "2nd half"],
    ...(match.extra_time ? ([["et", "Extra time"]] as [PeriodFilter, string][]) : []),
  ];
  const periodLabel = PERIODS.find(([k]) => k === period)?.[1] ?? "Full match";

  // 1. this team, this period (extra time = periods 3 and 4)
  const inPeriod = passes.filter(
    (p) =>
      p.team_id === teams[team].id &&
      p.x !== null &&
      p.y !== null &&
      (period === "all" || (period === "et" ? p.period >= 3 : p.period === Number(period))),
  );

  // 2. per-player totals
  const byPlayer = new Map<number, Passer>();
  for (const p of inPeriod) {
    if (p.player_id === null) continue;
    let o = byPlayer.get(p.player_id);
    if (!o) {
      o = { id: p.player_id, name: fullName(p.player_id), passes: 0, completed: 0, progressive: 0, sumX: 0, sumY: 0, to: new Map() };
      byPlayer.set(p.player_id, o);
    }
    o.passes++;
    o.sumX += p.x!;
    o.sumY += p.y!;
    if (p.is_progressive) o.progressive++;
    if (p.completed) {
      o.completed++;
      if (p.recipient_id !== null) o.to.set(p.recipient_id, (o.to.get(p.recipient_id) ?? 0) + 1);
    }
  }
  const passers = [...byPlayer.values()].sort((a, b) => b.passes - a.passes || a.name.localeCompare(b.name));

  /* ── passing network ── */

  const toScreen = (x: number, y: number): [number, number] => (vertical ? [y, 120 - x] : [x, y]);
  const nodes = passers.filter((o) => o.passes >= NETWORK_MIN_PASSES);
  const inNetwork = new Set(nodes.map((o) => o.id));

  // links: completed passes between two network players, both directions added together
  const pairs = new Map<string, { a: number; b: number; n: number }>();
  for (const o of nodes) {
    for (const [to, n] of o.to) {
      if (!inNetwork.has(to)) continue;
      const [a, b] = o.id < to ? [o.id, to] : [to, o.id];
      const key = `${a}-${b}`;
      const pair = pairs.get(key) ?? { a, b, n: 0 };
      pair.n += n;
      pairs.set(key, pair);
    }
  }
  const links = [...pairs.values()].sort((x, y) => y.n - x.n);
  const minLink = period === "all" ? 4 : 2; // fewer passes in one period, so a lower bar
  const shownLinks = links.filter((l) => l.n >= minLink);
  const maxLink = Math.max(1, ...shownLinks.map((l) => l.n));
  const maxPasses = Math.max(1, ...nodes.map((o) => o.passes));

  const picked = nodes.find((o) => o.id === networkId) ?? null;
  const neighbours = new Set<number>();
  if (picked) for (const l of shownLinks) if (l.a === picked.id) neighbours.add(l.b); else if (l.b === picked.id) neighbours.add(l.a);

  // circles at each player's average pass position, nudged apart so name labels don't overlap
  const radius = (o: Passer) => 2 + 2 * Math.sqrt(o.passes / maxPasses);
  const fontSize = vertical ? 3.2 : 2.5;
  const pos = new Map(nodes.map((o) => [o.id, toScreen(o.sumX / o.passes, o.sumY / o.passes)]));
  const labelWidth = (o: Passer) => Math.max(2 * radius(o), shortName(o.name).length * fontSize * 0.56) + 1.2;
  const box = (o: Passer, labelAbove = false) => {
    const [cx, cy] = pos.get(o.id)!;
    const r = radius(o);
    const w = labelWidth(o) / 2;
    return labelAbove
      ? { l: cx - w, r: cx + w, t: cy - r - fontSize * 1.35, b: cy + r + 0.6 }
      : { l: cx - w, r: cx + w, t: cy - r - 0.6, b: cy + r + fontSize * 1.35 };
  };
  const width = vertical ? 80 : 120;
  const height = vertical ? 120 : 80;
  for (let pass = 0; pass < 200; pass++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const A = box(nodes[i]);
        const B = box(nodes[j]);
        const overlapX = Math.min(A.r, B.r) - Math.max(A.l, B.l);
        const overlapY = Math.min(A.b, B.b) - Math.max(A.t, B.t);
        if (overlapX <= 0 || overlapY <= 0) continue;
        const pa = pos.get(nodes[i].id)!;
        const pb = pos.get(nodes[j].id)!;
        // push the pair apart along whichever way needs the smaller move
        if (overlapX / (A.r - A.l) < overlapY / (A.b - A.t)) {
          const dir = pb[0] >= pa[0] ? 1 : -1;
          pa[0] -= dir * (overlapX / 2 + 0.05);
          pb[0] += dir * (overlapX / 2 + 0.05);
        } else {
          const dir = pb[1] >= pa[1] ? 1 : -1;
          pa[1] -= dir * (overlapY / 2 + 0.05);
          pb[1] += dir * (overlapY / 2 + 0.05);
        }
        moved = true;
      }
    }
    for (const o of nodes) {
      const p = pos.get(o.id)!;
      const w = labelWidth(o) / 2;
      p[0] = clamp(p[0], w + 0.5, width - w - 0.5);
      p[1] = clamp(p[1], radius(o) + 1, height - radius(o) - fontSize * 1.4);
    }
    if (!moved) break;
  }
  // any label that still collides goes above its circle instead
  const hits = (A: ReturnType<typeof box>, B: ReturnType<typeof box>) =>
    Math.min(A.r, B.r) > Math.max(A.l, B.l) && Math.min(A.b, B.b) > Math.max(A.t, B.t);
  const labelAbove = new Set<number>();
  nodes.forEach((o, i) => {
    if (nodes.some((q, j) => j !== i && hits(box(o), box(q, labelAbove.has(q.id))))) labelAbove.add(o.id);
  });

  const pickNode = (id: number) => () => setNetworkId(id);

  /* ── pass map ── */

  const mapPlayerId = passers.some((o) => o.id === mapPlayer) ? mapPlayer : "all"; // gone after a team/period change → all
  const base = inPeriod.filter((p) => mapPlayerId === "all" || p.player_id === mapPlayerId);
  const shown = base.filter((p) => {
    if (p.end_x === null || p.end_y === null) return false;
    if (passType === "completed") return p.completed;
    if (passType === "incomplete") return !p.completed;
    if (passType === "progressive") return p.is_progressive;
    if (passType === "box") return p.into_box;
    return true;
  });
  // the busier the map, the fainter each arrow
  const dense = shown.length > 180;
  const veryDense = shown.length > 400;
  const arrowOpacity = (completed: boolean) =>
    veryDense ? (completed ? 0.3 : 0.32) : dense ? (completed ? 0.5 : 0.45) : completed ? 0.85 : 0.75;
  const baseCompleted = base.filter((p) => p.completed).length;
  const completedPct = base.length
    ? mapPlayerId === "all"
      ? `${((baseCompleted / base.length) * 100).toFixed(1)}%`
      : `${pct(baseCompleted, base.length)}%`
    : "–";
  const mapStats = [
    { k: "Passes", v: String(base.length) },
    { k: "Completed", v: completedPct },
    { k: "Progressive", v: String(base.filter((p) => p.is_progressive).length) },
    { k: "Into final third", v: String(base.filter((p) => p.into_final_third).length) },
    { k: "Into the box", v: String(base.filter((p) => p.into_box).length) },
  ];
  const direction = vertical ? "Attacking ↑" : "Attacking →";
  const arrowId = `pa-arrow-${team}`;

  return (
    <div className={`pa-page pa-team--${team}`}>
      <div className="pa-controls">
        <div className="seg" role="radiogroup" aria-label="Team">
          {(["home", "away"] as Side[]).map((side) => (
            <label key={side} className="seg-opt">
              <input
                type="radio"
                name="pa-team"
                checked={team === side}
                onChange={() => {
                  setTeam(side);
                  setNetworkId(null);
                  setMapPlayer("all");
                }}
              />
              {teams[side].name}
            </label>
          ))}
        </div>
        <div className="pa-scroll">
          <div className="seg" role="radiogroup" aria-label="Period">
            {PERIODS.map(([value, label]) => (
              <label key={value} className="seg-opt pa-nowrap">
                <input
                  type="radio"
                  name="pa-period"
                  checked={period === value}
                  onChange={() => {
                    setPeriod(value);
                    setNetworkId(null);
                  }}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* ── passing network ── */}
      <section className="overview-card pa-card" aria-labelledby="pa-network-title">
        <div className="pa-head__text">
          <h3 id="pa-network-title">Passing network</h3>
          <span className="pa-sub">
            {teamName} · {periodLabel} · {nodes.length} players with {NETWORK_MIN_PASSES}+ passes · links of {minLink}+ passes
          </span>
        </div>

        <div className={`pa-body${wide ? " pa-body--wide" : ""}`}>
          <div className={`pa-pitch${vertical ? " pa-pitch--vertical" : ""}`}>
            <div className="pa-pitch__head">
              <span className="pa-pitch__team">
                <span className="pa-dot" aria-hidden="true" />
                {teamName}
              </span>
              <span>{direction}</span>
            </div>
            <div className="pa-pitch__frame">
              <PassPitch vertical={vertical} label={`${teamName} passing network, ${periodLabel}: ${nodes.length} players`}>
                {/* weakest links first, so the strongest are drawn on top */}
                {[...shownLinks].reverse().map((l) => {
                  const [x1, y1] = pos.get(l.a)!;
                  const [x2, y2] = pos.get(l.b)!;
                  const on = picked && (l.a === picked.id || l.b === picked.id);
                  return (
                    <line
                      key={`${l.a}-${l.b}`}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      className="pa-link"
                      strokeWidth={0.35 + (l.n / maxLink) * 2.3}
                      opacity={picked ? (on ? 0.9 : 0.1) : 0.2 + (0.6 * l.n) / maxLink}
                    />
                  );
                })}
                {nodes.map((o) => {
                  const [cx, cy] = pos.get(o.id)!;
                  const r = radius(o);
                  const on = picked === o;
                  const dim = picked && !on && !neighbours.has(o.id);
                  const number = squad.get(o.id)?.jersey_number ?? "";
                  return (
                    <g
                      key={o.id}
                      className="pa-node"
                      tabIndex={0}
                      role="button"
                      aria-pressed={on}
                      aria-label={`${o.name}, ${o.passes} passes, ${pct(o.completed, o.passes)}% completed`}
                      opacity={dim ? 0.35 : 1}
                      onClick={pickNode(o.id)}
                      onMouseEnter={pickNode(o.id)}
                      onFocus={pickNode(o.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setNetworkId(o.id);
                        }
                      }}
                    >
                      {on && <circle cx={cx} cy={cy} r={r + 1.2} className="pa-node__ring" />}
                      <circle cx={cx} cy={cy} r={r} className="pa-node__circle" />
                      <text x={cx} y={cy} className="pa-node__number" fontSize={r * 0.95}>
                        {number}
                      </text>
                      <text
                        x={cx}
                        y={labelAbove.has(o.id) ? cy - r - fontSize * 0.45 : cy + r + fontSize * 0.95}
                        className="pa-node__name"
                        fontSize={fontSize}
                        strokeWidth={fontSize * 0.32}
                      >
                        {shortName(o.name)}
                      </text>
                    </g>
                  );
                })}
              </PassPitch>
            </div>
            <span className="pa-note">
              Each circle sits at the player's average pass position; bigger circle = more passes, thicker line = more passes between the
              pair. Hover, tap or tab to a player.
            </span>
          </div>

          <div className="pa-side">
            {picked ? (
              <div className="pa-panel" aria-live="polite">
                <div className="pa-who">
                  <span className="pa-who__number">{squad.get(picked.id)?.jersey_number}</span>
                  <div className="pa-who__text">
                    <h5>{picked.name}</h5>
                    <span>{squad.get(picked.id)?.position ?? "Substitute"}</span>
                  </div>
                </div>
                <div className="pa-facts">
                  {[
                    { k: "Passes", v: String(picked.passes) },
                    { k: "Completed", v: `${pct(picked.completed, picked.passes)}%` },
                    { k: "Progressive", v: String(picked.progressive) },
                  ].map((f) => (
                    <div key={f.k}>
                      <span>{f.k}</span>
                      <strong>{f.v}</strong>
                    </div>
                  ))}
                </div>
                <div className="pa-partners">
                  <span className="pa-partners__title">Most passes to</span>
                  {[...picked.to.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([id, n]) => (
                      <div key={id} className="pa-partners__row">
                        <span>{fullName(id)}</span>
                        <strong>{n}</strong>
                      </div>
                    ))}
                </div>
                <button type="button" className="btn btn-secondary pa-small-btn" onClick={() => setMapPlayer(picked.id)}>
                  Show on pass map
                </button>
              </div>
            ) : (
              <div className="pa-panel pa-panel--empty">
                <h5>Pick a player</h5>
                <p>Hover or tap a circle to see who they passed to most. Their links stay highlighted on the network.</p>
              </div>
            )}

            <div className="pa-panel pa-links">
              <h5>Strongest links</h5>
              {links.slice(0, 5).map((l) => (
                <div key={`${l.a}-${l.b}`} className="pa-links__item">
                  <div className="pa-links__row">
                    <span>
                      {shortName(fullName(l.a))} ↔ {shortName(fullName(l.b))}
                    </span>
                    <strong>{l.n}</strong>
                  </div>
                  <span className="pa-bar">
                    <span style={{ width: `${(l.n / links[0].n) * 100}%` }} />
                  </span>
                </div>
              ))}
              <span className="pa-note">Completed passes, both directions combined.</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── pass map ── */}
      <section className="overview-card pa-card" aria-labelledby="pa-map-title">
        <div className="pa-head">
          <div className="pa-head__text">
            <h3 id="pa-map-title">Pass map</h3>
            <span className="pa-sub">
              {teamName} · {periodLabel} · {mapPlayerId === "all" ? "all players" : fullName(mapPlayerId)}
            </span>
          </div>
          <select
            className="input pa-select"
            aria-label="Filter by player"
            value={String(mapPlayerId)}
            onChange={(e) => setMapPlayer(e.target.value === "all" ? "all" : Number(e.target.value))}
          >
            <option value="all">All players</option>
            {passers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} · {o.passes}
              </option>
            ))}
          </select>
        </div>

        <div className="pa-scroll">
          <div className="seg pa-seg" role="radiogroup" aria-label="Pass type">
            {(
              [
                ["all", "All"],
                ["completed", "Completed"],
                ["incomplete", "Incomplete"],
                ["progressive", "Progressive"],
                ["box", "Into box"],
              ] as [PassType, string][]
            ).map(([value, label]) => (
              <label key={value} className="seg-opt pa-nowrap">
                <input type="radio" name="pa-type" checked={passType === value} onChange={() => setPassType(value)} />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="pa-stats">
          {mapStats.map((s) => (
            <div key={s.k}>
              <span>{s.k}</span>
              <strong>{s.v}</strong>
            </div>
          ))}
        </div>

        <div className={`pa-body${wide ? " pa-body--wide" : ""}`}>
          <div className={`pa-pitch${vertical ? " pa-pitch--vertical" : ""}`}>
            <div className="pa-pitch__head">
              <span>
                {shown.length} of {base.length} passes shown
              </span>
              <span>{direction}</span>
            </div>
            <div className="pa-pitch__frame">
              <PassPitch
                vertical={vertical}
                label={`${teamName} pass map: ${shown.length} passes shown`}
                defs={
                  <defs>
                    <marker id={arrowId} viewBox="0 0 4 4" refX="3.2" refY="2" markerWidth="3" markerHeight="3" markerUnits="userSpaceOnUse" orient="auto">
                      <path d="M0 0 L4 2 L0 4 z" className="pa-arrow" />
                    </marker>
                    <marker id="pa-arrow-miss" viewBox="0 0 4 4" refX="3.2" refY="2" markerWidth="2.8" markerHeight="2.8" markerUnits="userSpaceOnUse" orient="auto">
                      <path d="M0 0 L4 2 L0 4 z" className="pa-arrow pa-arrow--miss" />
                    </marker>
                  </defs>
                }
              >
                {/* incomplete first, so completed passes sit on top */}
                {[...shown]
                  .sort((a, b) => Number(a.completed) - Number(b.completed))
                  .map((p) => {
                    const [x1, y1] = toScreen(p.x!, p.y!);
                    const [x2, y2] = toScreen(p.end_x!, p.end_y!);
                    return (
                      <line
                        key={p.event_index}
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        className={p.completed ? "pa-pass" : "pa-pass pa-pass--miss"}
                        opacity={arrowOpacity(p.completed)}
                        markerEnd={`url(#${p.completed ? arrowId : "pa-arrow-miss"})`}
                      />
                    );
                  })}
              </PassPitch>
              {!shown.length && (
                <div className="pa-empty">
                  <span>No passes match these filters</span>
                </div>
              )}
            </div>
            <div className="pa-legend">
              <span>
                <span className="pa-key" />
                Completed
              </span>
              <span>
                <span className="pa-key pa-key--miss" />
                Incomplete
              </span>
            </div>
          </div>

          <div className="pa-panel pa-passers">
            <div className="pa-passers__head">
              <h5>Passers</h5>
              <span>Tap to filter the map</span>
            </div>
            <div className="pa-passers__row pa-passers__cols" aria-hidden="true">
              <span />
              <span>Player</span>
              <span>Passes</span>
              <span>Cmp</span>
              <span>Prog</span>
            </div>
            <div className={`pa-passers__list${wide ? " pa-passers__list--scroll" : ""}`}>
              {passers.map((o) => {
                const on = mapPlayerId === o.id;
                const starter = squad.get(o.id)?.starter ?? false;
                return (
                  <button
                    key={o.id}
                    type="button"
                    className={`pa-passers__row${on ? " is-on" : ""}`}
                    aria-pressed={on}
                    aria-label={`${o.name}${starter ? "" : ", substitute"}: ${o.passes} passes, ${pct(o.completed, o.passes)}% completed, ${
                      o.progressive
                    } progressive. ${on ? "Show all players" : "Show only their passes"}`}
                    onClick={() => setMapPlayer(on ? "all" : o.id)}
                  >
                    <span className={`pa-num${starter ? " pa-num--starter" : ""}`}>{squad.get(o.id)?.jersey_number}</span>
                    <span className="pa-passers__name">{o.name}</span>
                    <span className="pa-passers__n">{o.passes}</span>
                    <span>{pct(o.completed, o.passes)}%</span>
                    <span>{o.progressive}</span>
                  </button>
                );
              })}
            </div>
            <span className="pa-note pa-passers__foot">Filled number = starter · outlined = substitute</span>
          </div>
        </div>
      </section>

      <p className="pa-note pa-definition">
        Progressive pass is a PlayIQ definition: a completed pass, starting outside the team's own defensive third, that ends at least 25%
        closer to the opponent's goal.
      </p>
    </div>
  );
}

export default Passes;
