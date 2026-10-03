import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import type { MatchDetail } from "../types/api";
import { formatFullDate, teamCode } from "../utils/format";
import "./Score.css";

type Status = "loading" | "ready" | "not-found" | "error";

// Tab paths are relative to /matches/:matchId ("" = the Overview index route)
const TABS = [
  { to: "", label: "Overview" },
  { to: "shots", label: "Shots" },
  { to: "passes", label: "Passing" },
  { to: "attack", label: "Attack" },
  { to: "lineups", label: "Lineups" },
  { to: "stats", label: "Players" },
];

// Groups one team's goals by player: "Lionel Messi 23' (pen), 108'"
function scorerLines(match: MatchDetail, teamId: number) {
  const byPlayer = new Map<string, string[]>();
  for (const g of match.goals) {
    if (g.team_id !== teamId) continue;
    const label = g.minute_label + (g.penalty ? " (pen)" : g.own_goal ? " (og)" : "");
    byPlayer.set(g.player_name, [...(byPlayer.get(g.player_name) ?? []), label]);
  }
  return [...byPlayer].map(([player, minutes]) => `${player} ${minutes.join(", ")}`);
}

export function Score() {
  const { matchId } = useParams();
  const [match, setMatch] = useState<MatchDetail | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    const fetchMatch = async () => {
      try {
        const response = await fetch(`/api/matches/${matchId}`, { signal: controller.signal });
        if (response.status === 404) {
          setStatus("not-found");
          return;
        }
        if (!response.ok) throw new Error(`Failed to fetch match (${response.status})`);
        setMatch(await response.json());
        setStatus("ready");
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setStatus("error");
      }
    };

    fetchMatch();
    return () => controller.abort();
  }, [matchId, reloadKey]);

  const retry = () => {
    setStatus("loading");
    setReloadKey((k) => k + 1);
  };

  return (
    <div className="match-page">
      <div className="page-width">
        <Link to="/" className="match-page__back">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
          All matches
        </Link>
      </div>

      {status === "loading" && (
        <div className="page-width match-head match-head--loading" aria-busy="true" aria-label="Loading match">
          <span className="skeleton-bar" style={{ width: 260, height: 12 }} />
          <span className="skeleton-bar" style={{ width: "min(520px, 90%)", height: 44 }} />
          <span className="skeleton-bar" style={{ width: 200, height: 12 }} />
        </div>
      )}

      {(status === "error" || status === "not-found") && (
        <div className="page-width">
          <div className="match-page__alert" role="alert">
            <h4>{status === "not-found" ? "Match not found" : "Couldn't load this match"}</h4>
            <p>
              {status === "not-found"
                ? "There's no match with this ID. It may not have been imported yet."
                : "The match details didn't arrive. Check your connection and try again."}
            </p>
            {status === "error" ? (
              <button type="button" className="btn btn-primary" onClick={retry}>
                Try again
              </button>
            ) : (
              <Link to="/" className="btn btn-primary">
                Back to all matches
              </Link>
            )}
          </div>
        </div>
      )}

      {status === "ready" && match && (
        <>
          <header className="page-width match-head">
            <span className="match-head__kicker">
              {[
                `${match.competition_name} ${match.season_name}`,
                match.competition_stage,
                formatFullDate(match.match_date),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>

            <div className="match-head__teams">
              <div className="match-head__team match-head__team--home">
                <span className="match-head__name">{match.home_team.name}</span>
                <span className="match-head__badge match-head__badge--home" aria-hidden="true">
                  {teamCode(match.home_team.name)}
                </span>
              </div>
              <span
                className="match-head__score"
                aria-label={`${match.home_team.name} ${match.home_score}, ${match.away_team.name} ${match.away_score}`}
              >
                {match.home_score} – {match.away_score}
              </span>
              <div className="match-head__team match-head__team--away">
                <span className="match-head__badge match-head__badge--away" aria-hidden="true">
                  {teamCode(match.away_team.name)}
                </span>
                <span className="match-head__name">{match.away_team.name}</span>
              </div>
            </div>

            {(match.extra_time || match.penalties) && (
              <div className="match-head__tags">
                {match.extra_time && <span className="tag tag-neutral">After extra time</span>}
                {match.penalties && (
                  <span className="tag tag-accent match-head__pens">
                    {match.penalties.home > match.penalties.away
                      ? match.home_team.name
                      : match.away_team.name}{" "}
                    won {Math.max(match.penalties.home, match.penalties.away)}–
                    {Math.min(match.penalties.home, match.penalties.away)} on penalties
                  </span>
                )}
              </div>
            )}

            {match.goals.length > 0 && (
              <div className="match-head__scorers">
                <div className="match-head__scorers-home">
                  {scorerLines(match, match.home_team.id).map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </div>
                <span className="match-head__ball" aria-hidden="true" />
                <div className="match-head__scorers-away">
                  {scorerLines(match, match.away_team.id).map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </div>
              </div>
            )}
          </header>

          <div className="match-tabs">
            <nav className="match-tabs__list" aria-label="Match sections">
              {TABS.map((tab) => (
                <NavLink
                  key={tab.label}
                  to={tab.to}
                  end={tab.to === ""}
                  className={({ isActive }) => `match-tabs__tab${isActive ? " is-active" : ""}`}
                >
                  {tab.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div className="page-width match-page__content">
            <Outlet />
          </div>
        </>
      )}
    </div>
  );
}

export default Score;
