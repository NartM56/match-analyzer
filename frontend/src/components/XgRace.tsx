import { useEffect, useState } from "react";
import type { MatchDetail, MatchXg, XgShot } from "../types/api";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { axisMarks, buildAxis, extraTimeStart, periodDividers, positionOf, type MatchAxis } from "../utils/matchClock";
import "./XgRace.css";

type Side = "home" | "away";

/* Chart size in SVG units. The SVG scales to the card's width via viewBox,
   so these only set the proportions (and how big the text is relative to the chart). */
function chartSize(mobile: boolean, shared: boolean) {
  if (!mobile && shared) {
    // sharing the row with the shootout card: about 2/3 of the width
    return { width: 760, height: 260, left: 34, right: 12, top: 14, bottom: 26, font: 12 };
  }
  return mobile
    ? { width: 360, height: 210, left: 30, right: 10, top: 14, bottom: 26, font: 10 }
    : { width: 1100, height: 280, left: 34, right: 12, top: 14, bottom: 26, font: 12 }; // ~the card's real width, so text isn't enlarged
}

type Point = { left: number; total: number; shot: XgShot }; // left: 0..1 on the axis, total: running xG

/** One team's running xG total: each shot adds its xG at the moment it was taken. */
function runningTotal(shots: XgShot[], teamId: number, axis: MatchAxis): Point[] {
  let total = 0;
  const points: Point[] = [];
  for (const shot of shots) {
    if (shot.team_id !== teamId) continue;
    const left = positionOf(shot, axis);
    if (left === null) continue;
    total += shot.xg;
    points.push({ left, total, shot });
  }
  return points;
}

function shotLabel(shot: XgShot): string {
  if (shot.own_goal) return `${shot.minute_label} ${shot.player_name} (own goal)`;
  const pen = shot.penalty ? " (pen)" : "";
  return `${shot.minute_label} ${shot.player_name}${pen}: goal, ${shot.xg.toFixed(2)} xG`;
}

// shared: true when the shootout card sits next to the chart (a narrower column)
export function XgRace({ match, shared = false }: { match: MatchDetail; shared?: boolean }) {
  const [data, setData] = useState<MatchXg | null>(null);
  const [failed, setFailed] = useState(false);
  const mobile = useMediaQuery("(max-width: 759px)");

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setFailed(false);
    fetch(`/api/matches/${match.id}/xg`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Failed to load xG (${response.status})`);
        setData(await response.json());
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [match.id]);

  const teams: { side: Side; id: number; name: string }[] = [
    { side: "home", id: match.home_team.id, name: match.home_team.name },
    { side: "away", id: match.away_team.id, name: match.away_team.name },
  ];

  // final totals for the legend (own goals add 0)
  const finalXg = (teamId: number) =>
    (data?.shots ?? []).filter((s) => s.team_id === teamId).reduce((sum, s) => sum + s.xg, 0);

  let chart;
  if (failed) {
    chart = <p className="xg-message">Couldn't load the xG data.</p>;
  } else if (!data) {
    chart = <span className="skeleton-bar" style={{ width: "100%", height: mobile ? 210 : 280 }} aria-label="Loading xG" />;
  } else {
    const size = chartSize(mobile, shared);
    const axis = buildAxis(data.periods);
    const lines = teams.map((t) => ({ ...t, points: runningTotal(data.shots, t.id, axis) }));

    // y axis: 0 up to a round number just above the highest total
    const highest = Math.max(0, ...lines.flatMap((l) => l.points.map((p) => p.total)));
    const yMax = Math.max(1, Math.ceil(highest * 2) / 2 + 0.5);
    const yStep = yMax <= 2 ? 0.5 : 1;
    const yTicks = Array.from({ length: Math.floor(yMax / yStep) + 1 }, (_, i) => i * yStep);

    // data → SVG coordinates
    const plotW = size.width - size.left - size.right;
    const plotH = size.height - size.top - size.bottom;
    const x = (left: number) => size.left + left * plotW;
    const y = (value: number) => size.top + (1 - value / yMax) * plotH;

    // a step line: flat until a shot, then straight up by that shot's xG
    const stepPath = (points: Point[]) => {
      let d = `M${x(0)},${y(0)}`;
      for (const p of points) d += ` H${x(p.left)} V${y(p.total)}`;
      return d + ` H${x(1)}`;
    };

    const etStart = extraTimeStart(axis);
    const summary = lines.map((l) => `${l.name} ${finalXg(l.id).toFixed(2)}`).join(", ");

    chart = (
      <svg
        className="xg-chart"
        viewBox={`0 0 ${size.width} ${size.height}`}
        role="img"
        aria-label={`Cumulative expected goals over the match. Final totals: ${summary}.`}
        style={{ fontSize: size.font }}
      >
        {/* extra-time shading */}
        {etStart !== null && (
          <rect className="xg-extra" x={x(etStart)} y={size.top} width={x(1) - x(etStart)} height={plotH} rx={8} />
        )}

        {/* horizontal grid lines + y labels */}
        {yTicks.map((v) => (
          <g key={v}>
            <line className="xg-grid" x1={size.left} x2={size.width - size.right} y1={y(v)} y2={y(v)} />
            <text className="xg-axis-text" x={size.left - 6} y={y(v) + 4} textAnchor="end">
              {v.toFixed(v % 1 ? 1 : 0)}
            </text>
          </g>
        ))}

        {/* lines between periods + labels along the bottom */}
        {periodDividers(axis).map((left) => (
          <line key={left} className="xg-divider" x1={x(left)} x2={x(left)} y1={size.top} y2={size.top + plotH} />
        ))}
        {axisMarks(axis).map((m) => (
          <text
            key={m.label}
            className="xg-axis-text"
            x={x(m.left)}
            y={size.height - 8}
            textAnchor={m.left === 0 ? "start" : m.left >= 1 ? "end" : "middle"}
          >
            {m.label}
          </text>
        ))}

        {/* one step line per team, then the goal dots on top */}
        {lines.map((l) => (
          <path key={l.side} className={`xg-line xg-line--${l.side}`} d={stepPath(l.points)} />
        ))}
        {lines.map((l) =>
          l.points
            .filter((p) => p.shot.goal)
            .map((p) => (
              <circle
                key={`${l.side}-${p.shot.event_index}`}
                className={`xg-goal xg-goal--${l.side}${p.shot.own_goal ? " xg-goal--own" : ""}`}
                cx={x(p.left)}
                cy={y(p.total)}
                r={mobile ? 4.5 : 5.5}
              >
                <title>{shotLabel(p.shot)}</title>
              </circle>
            )),
        )}
      </svg>
    );
  }

  return (
    <section className="overview-card xg-card" aria-labelledby="xg-title">
      <div className="xg-head">
        <h3 id="xg-title">xG race</h3>
        <div className="xg-legend">
          {teams.map((t) => (
            <span key={t.side}>
              <span className={`xg-legend__line xg-legend__line--${t.side}`} aria-hidden="true" />
              {t.name} {data && <strong>{finalXg(t.id).toFixed(2)}</strong>}
            </span>
          ))}
        </div>
      </div>
      <p className="xg-note">
        Running total of expected goals (xG) from every shot. Dots are goals; shootout penalties aren't counted.
      </p>
      {chart}
    </section>
  );
}

export default XgRace;
