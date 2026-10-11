import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type {
  MatchDetail,
  MatchSummary,
  TeamStats,
  TeamStatsSide,
} from "../types/api";
import { teamCode } from "../utils/format";
import { MatchTimeline } from "../components/MatchTimeline";
import { XgRace } from "../components/XgRace";
import { Shootout } from "../components/Shootout";
import "./Overview.css";

type StatRow = {
  label: string;
  key: keyof TeamStatsSide;
  format?: (value: number) => string;
  neutral?: boolean; // no "winner" highlight (more fouls isn't better or worse)
};

// The rows of the comparison, top to bottom
const STAT_ROWS: StatRow[] = [
  {
    label: "Possession",
    key: "possession",
    format: (v) => `${Math.round(v)}%`,
  },
  { label: "Expected goals (xG)", key: "xg", format: (v) => v.toFixed(2) },
  { label: "Shots", key: "shots" },
  { label: "Shots on target", key: "shots_on_target" },
  { label: "Passes", key: "passes" },
  {
    label: "Pass accuracy",
    key: "pass_accuracy",
    format: (v) => `${v.toFixed(1)}%`,
  },
  { label: "Corners", key: "corners" },
  { label: "Fouls", key: "fouls", neutral: true },
];

function StatComparison({
  row,
  home,
  away,
}: {
  row: StatRow;
  home: number;
  away: number;
}) {
  const format = row.format ?? String;
  // which side is ahead; null on a draw or for neutral stats
  const lead =
    row.neutral || home === away ? null : home > away ? "home" : "away";
  // flex-grow can't be 0 for both, or the bar would vanish when both values are 0
  const homeShare = home + away === 0 ? 1 : home;
  const awayShare = home + away === 0 ? 1 : away;

  const valueClass = (side: "home" | "away") =>
    `stat-row__value stat-row__value--${side}${lead === side ? " is-lead" : ""}`;
  const barClass = (side: "home" | "away") =>
    `stat-row__bar stat-row__bar--${side}${lead && lead !== side ? " is-trailing" : ""}`;

  return (
    <div className="stat-row">
      <div className="stat-row__numbers">
        <span className={valueClass("home")}>{format(home)}</span>
        <span className="stat-row__label">{row.label}</span>
        <span className={valueClass("away")}>{format(away)}</span>
      </div>
      <div className="stat-row__bars" aria-hidden="true">
        <span className={barClass("home")} style={{ flexGrow: homeShare }} />
        <span className={barClass("away")} style={{ flexGrow: awayShare }} />
      </div>
    </div>
  );
}

function Cards({
  team,
  yellow,
  red,
  align,
}: {
  team: string;
  yellow: number;
  red: number;
  align: "start" | "end";
}) {
  return (
    <span
      className={`cards-row__value cards-row__value--${align}`}
      aria-label={`${team}: ${yellow} yellow card${yellow === 1 ? "" : "s"}, ${red} red`}
    >
      <span className="card-icon card-icon--yellow" aria-hidden="true" />
      {yellow}
      <span className="card-icon card-icon--red" aria-hidden="true" />
      {red}
    </span>
  );
}

type AiStatus = "checking" | "idle" | "loading" | "done" | "error";

const SKELETON_LINES = ["100%", "94%", "97%", "60%", "100%", "88%", "45%"];

// Splits text so minutes like 23' or 90+3' can be highlighted
const MINUTE_PATTERN = /(\d{1,3}(?:\+\d{1,2})?')/;

function AiSummary({ matchId }: { matchId: number }) {
  // checking = looking for a saved summary, idle = none yet, loading = AI is writing
  const [status, setStatus] = useState<AiStatus>("checking");
  const [summary, setSummary] = useState<string | null>(null);
  // the message shown in the error box when generating fails
  const [aiError, setAiError] = useState<string | null>(null);

  // When the tab opens: show the saved summary if there is one (never calls the AI)
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/matches/${matchId}/ai_summary`, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) return setStatus("idle"); // no summary yet
        if (!response.ok)
          throw new Error(`Failed to load summary (${response.status})`);
        const data: MatchSummary = await response.json();
        setSummary(data.summary);
        setStatus("done");
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setStatus("idle"); // couldn't check: still let the user generate one
      });
    return () => controller.abort();
  }, [matchId]);

  // "Explain this match" / "Regenerate": ask the backend to write (and save) a summary
  const explainMatch = async () => {
    setStatus("loading"); // before the request, so the loading state shows while waiting
    setAiError(null);
    try {
      const response = await fetch(`/api/matches/${matchId}/ai_summary`, {
        method: "POST",
      });
      if (response.status === 429)
        throw new Error("Please wait a moment before regenerating.");
      if (!response.ok)
        throw new Error(
          "The AI service didn't respond. The stats on this page are unaffected.",
        );
      const data: MatchSummary = await response.json();
      setSummary(data.summary);
      setStatus("done");
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  };

  const paragraphs = (summary ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <section className="overview-card ai-card" aria-labelledby="ai-card-title">
      <span className="ai-card__blob" aria-hidden="true" />

      <div className="ai-card__head">
        <h3 id="ai-card-title">What happened</h3>
        <span className="tag tag-accent-2 ai-card__tag">
          <SparkleIcon size={13} />
          AI-generated
        </span>
      </div>

      {status === "checking" && (
        <div
          className="ai-card__lines"
          aria-busy="true"
          aria-label="Checking for a saved summary"
        >
          {SKELETON_LINES.slice(0, 3).map((w, i) => (
            <span
              key={i}
              className="skeleton-bar"
              style={{ width: w, height: 10 }}
            />
          ))}
        </div>
      )}

      {status === "idle" && (
        <div className="ai-card__idle">
          <p>
            Get a plain-English account of how this match unfolded and why,
            written by an AI model from the stats on this page.
          </p>
          <button
            type="button"
            className="btn btn-primary ai-card__cta"
            onClick={explainMatch}
          >
            <SparkleIcon size={16} />
            Explain this match
          </button>
          <span className="ai-card__hint">Usually takes 5–15 seconds.</span>
        </div>
      )}

      {status === "loading" && (
        <div className="ai-card__lines" role="status" aria-live="polite">
          <div className="ai-card__progress">
            <span className="ai-card__spinner" aria-hidden="true" />
            Writing the summary…
          </div>
          {SKELETON_LINES.map((w, i) => (
            <span
              key={i}
              className="skeleton-bar"
              style={{ width: w, height: 10, marginTop: i === 4 ? 10 : 0 }}
            />
          ))}
        </div>
      )}

      {status === "error" && (
        <div className="ai-card__error" role="alert">
          <h5>Couldn't write the explanation</h5>
          <p>{aiError}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={explainMatch}
          >
            Try again
          </button>
        </div>
      )}

      {status === "done" && (
        <div className="ai-card__text">
          {paragraphs.map((paragraph, i) => (
            <p key={i}>
              {paragraph.split(MINUTE_PATTERN).map((part, j) =>
                MINUTE_PATTERN.test(part) ? (
                  <mark key={j} className="ai-card__minute">
                    {part}
                  </mark>
                ) : (
                  part
                ),
              )}
            </p>
          ))}
          <div className="ai-card__footer">
            <span>
              Written by AI from PlayIQ match data and saved for this match. It
              can make mistakes, so check key facts against the stats.
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={explainMatch}
            >
              Regenerate
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function SparkleIcon({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    </svg>
  );
}

export function Overview() {
  const { match, stats } = useOutletContext<{
    match: MatchDetail;
    stats: TeamStats | null;
  }>();

  const homeCode = teamCode(match.home_team.name);
  const awayCode = teamCode(match.away_team.name);

  return (
    <div className="overview-grid">
      <section
        className="overview-card team-stats"
        aria-labelledby="team-stats-title"
      >
        <div className="team-stats__head">
          <span className="team-key">
            <span
              className="team-key__dot team-key__dot--home"
              aria-hidden="true"
            />
            {homeCode}
          </span>
          <h3 id="team-stats-title">Team stats</h3>
          <span className="team-key">
            {awayCode}
            <span
              className="team-key__dot team-key__dot--away"
              aria-hidden="true"
            />
          </span>
        </div>

        {!stats ? (
          <div
            className="team-stats__rows"
            aria-busy="true"
            aria-label="Loading team stats"
          >
            {STAT_ROWS.map((row) => (
              <div key={row.key} className="stat-row">
                <span
                  className="skeleton-bar"
                  style={{ width: "60%", height: 10, margin: "0 auto" }}
                />
                <span
                  className="skeleton-bar"
                  style={{ width: "100%", height: 8 }}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="team-stats__rows">
            {STAT_ROWS.map((row) => (
              <StatComparison
                key={row.key}
                row={row}
                home={stats.home_team_stats[row.key]}
                away={stats.away_team_stats[row.key]}
              />
            ))}

            <div className="stat-row__numbers cards-row">
              <Cards
                team={match.home_team.name}
                yellow={stats.home_team_stats.yellow_cards}
                red={stats.home_team_stats.red_cards}
                align="start"
              />
              <span className="stat-row__label">Cards</span>
              <Cards
                team={match.away_team.name}
                yellow={stats.away_team_stats.yellow_cards}
                red={stats.away_team_stats.red_cards}
                align="end"
              />
            </div>
          </div>
        )}

        <p className="overview-card__note">
          The leading team's figure is highlighted; fouls and cards aren't
          scored either way. Possession is a PlayIQ estimate: each team's share
          of time on the ball, worked out from event timestamps.
        </p>
      </section>
      <AiSummary matchId={match.id} />
      <MatchTimeline match={match} />
      {/* xG race, plus the shootout card beside it when the match went to penalties
          (match.penalties is null otherwise, so the 2-column layout and the request are skipped) */}
      <div className={`xg-row${match.penalties ? " xg-row--with-shootout" : ""}`}>
        <XgRace match={match} shared={!!match.penalties} />
        {match.penalties && <Shootout match={match} />}
      </div>
    </div>
  );
}

export default Overview;
