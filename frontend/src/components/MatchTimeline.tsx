import { useEffect, useState } from "react";
import type { MatchDetail, MatchTimeline as TimelineData, TimelineEvent } from "../types/api";
import { teamCode } from "../utils/format";
import { axisMarks, buildAxis, extraTimeStart, periodDividers, positionOf, type MatchAxis } from "../utils/matchClock";
import "./MatchTimeline.css";

/* ── Marker geometry (px, inside a 170px-high track; the line sits at 85px) ── */

const TRACK_HEIGHT = 170;
const LINE_Y = 85;
const MARKER = 22; // marker size
const GAP = 14; // space between the line and the first marker
const LEVEL_STEP = 24; // how far a stacked marker moves away from the line
const STACK_DISTANCE = 0.035; // markers closer than 3.5% of the width get stacked

type PlacedEvent = {
  key: string;
  event: TimelineEvent;
  left: number; // 0..1
  top: number; // px
  side: "home" | "away";
};

function placeEvents(events: TimelineEvent[], match: MatchDetail, axis: MatchAxis): PlacedEvent[] {
  const placed: PlacedEvent[] = [];
  for (const side of ["home", "away"] as const) {
    const teamId = side === "home" ? match.home_team.id : match.away_team.id;
    let previous: { left: number; level: number } | null = null;

    for (const event of events) {
      if (event.team_id !== teamId) continue;
      const left = positionOf(event, axis);
      if (left === null) continue;

      // close to the previous marker? move it one level further from the line (max 3 levels)
      const level: number =
        previous && left - previous.left < STACK_DISTANCE ? Math.min(previous.level + 1, 2) : 0;
      previous = { left, level };

      const top =
        side === "home"
          ? LINE_Y - GAP - MARKER - level * LEVEL_STEP // above the line
          : LINE_Y + GAP + level * LEVEL_STEP; // below the line
      placed.push({ key: `${event.type}-${event.event_index}`, event, left, top, side });
    }
  }
  return placed;
}

/* ── Text for the popup and screen readers ── */

function describe(event: TimelineEvent): { title: string; body: string } {
  switch (event.type) {
    case "goal":
      return {
        title: `${event.minute_label} ${event.own_goal ? "Own goal" : "Goal"}`,
        body: event.player_name + (event.penalty ? " (penalty)" : ""),
      };
    case "card":
      return {
        title: `${event.minute_label} ${event.card === "Second Yellow" ? "Second yellow (sent off)" : event.card}`,
        body: event.player_name,
      };
    case "substitution":
      return {
        title: `${event.minute_label} Substitution${event.reason === "Injury" ? " (injury)" : ""}`,
        body: `${event.player_on} on, ${event.player_off} off`,
      };
  }
}

/* ── The marker icons ── */

function MarkerIcon({ event, side }: { event: TimelineEvent; side: "home" | "away" }) {
  if (event.type === "goal") {
    return (
      <span className={`tl-icon tl-icon--goal tl-icon--${side}${event.own_goal ? " tl-icon--own-goal" : ""}`}>
        <span className="tl-icon__dot" />
      </span>
    );
  }
  if (event.type === "card") {
    if (event.card === "Second Yellow") {
      return (
        <span className="tl-icon tl-icon--second-yellow">
          <span className="tl-card tl-card--yellow" />
          <span className="tl-card tl-card--red" />
        </span>
      );
    }
    return <span className={`tl-card ${event.card === "Red Card" ? "tl-card--red" : "tl-card--yellow"}`} />;
  }
  return <span className={`tl-icon tl-icon--sub tl-icon--${side}`} />;
}

/* ── The component ── */

export function MatchTimeline({ match }: { match: MatchDetail }) {
  const [data, setData] = useState<TimelineData | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // load the timeline whenever the match changes
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/matches/${match.id}/timeline`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Failed to load timeline (${response.status})`);
        setData(await response.json());
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFailed(true);
      });
    // clear this match's data when moving to another
    return () => {
      controller.abort();
      setData(null);
      setFailed(false);
      setSelectedKey(null);
    };
  }, [match.id]);

  // Escape closes the popup
  useEffect(() => {
    if (!selectedKey) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelectedKey(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedKey]);

  const teamName = (side: "home" | "away") => (side === "home" ? match.home_team.name : match.away_team.name);

  let body;
  if (failed) {
    body = <p className="tl-message">Couldn't load the timeline.</p>;
  } else if (!data) {
    body = <span className="skeleton-bar" style={{ width: "100%", height: TRACK_HEIGHT }} aria-label="Loading timeline" />;
  } else {
    const axis = buildAxis(data.periods);
    const placed = placeEvents(data.timeline, match, axis);
    const selected = placed.find((p) => p.key === selectedKey) ?? null;
    const etStart = extraTimeStart(axis);
    const marks = axisMarks(axis); // labels under the axis: kick-off, then the end of each period

    body = (
      <div className="tl-scroll">
        <div className="tl-grid">
          <div className="tl-teams" aria-hidden="true">
            <span className="tl-teams__home">{teamCode(match.home_team.name)}</span>
            <span className="tl-teams__away">{teamCode(match.away_team.name)}</span>
          </div>

          <div className="tl-area">
            <div className="tl-track" style={{ height: TRACK_HEIGHT }}>
              {etStart !== null && (
                <>
                  <span className="tl-extra" style={{ left: `${etStart * 100}%` }} />
                  <span className="tl-extra__label" style={{ left: `${etStart * 100}%` }}>
                    Extra time
                  </span>
                </>
              )}
              {periodDividers(axis).map((left) => (
                <span key={left} className="tl-divider" style={{ left: `${left * 100}%` }} />
              ))}
              <span className="tl-line" style={{ top: LINE_Y - 2 }} />

              {placed.map((p) => {
                const { title, body: text } = describe(p.event);
                const isSelected = p.key === selectedKey;
                return (
                  <button
                    key={p.key}
                    type="button"
                    className={`tl-marker${isSelected ? " is-selected" : ""}`}
                    style={{ left: `${p.left * 100}%`, top: p.top - 3 }}
                    aria-label={`${title}, ${text}, ${teamName(p.side)}`}
                    aria-expanded={isSelected}
                    onClick={() => setSelectedKey(isSelected ? null : p.key)}
                  >
                    <MarkerIcon event={p.event} side={p.side} />
                  </button>
                );
              })}

              {selected && (
                <div
                  className="tl-popup"
                  role="status"
                  style={{
                    left: `${selected.left * 100}%`,
                    // keep the popup inside the card near the edges
                    transform:
                      selected.left < 0.2 ? "translateX(-12px)" : selected.left > 0.8 ? "translateX(calc(-100% + 12px))" : "translateX(-50%)",
                    // home markers are above the line: open below them; away: open above
                    ...(selected.side === "home"
                      ? { top: selected.top + MARKER + 8 }
                      : { bottom: TRACK_HEIGHT - selected.top + 8 }),
                  }}
                >
                  <span className="tl-popup__text">
                    <strong>{describe(selected.event).title}</strong>
                    <span>{describe(selected.event).body}</span>
                    <span className="tl-popup__team">{teamName(selected.side)}</span>
                  </span>
                  <button type="button" className="tl-popup__close" aria-label="Close" onClick={() => setSelectedKey(null)}>
                    ×
                  </button>
                </div>
              )}
            </div>

            <div className="tl-marks" aria-hidden="true">
              {marks.map((m) => (
                <span
                  key={m.label}
                  className="tl-mark"
                  style={{ left: `${m.left * 100}%`, transform: m.left === 0 ? "none" : m.left >= 1 ? "translateX(-100%)" : "translateX(-50%)" }}
                >
                  {m.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="overview-card overview-card--wide tl-card-section" aria-labelledby="timeline-title">
      <div className="tl-head">
        <h3 id="timeline-title">Timeline</h3>
        <div className="tl-legend" aria-hidden="true">
          <span><span className="tl-icon tl-icon--goal tl-icon--legend"><span className="tl-icon__dot" /></span>Goal</span>
          <span><span className="tl-card tl-card--yellow" />Yellow card</span>
          <span><span className="tl-card tl-card--red" />Red card</span>
          <span><span className="tl-icon tl-icon--sub tl-icon--legend" />Substitution</span>
          <span className="tl-legend__hint">Tap a marker for details</span>
        </div>
      </div>
      {body}
    </section>
  );
}

export default MatchTimeline;
