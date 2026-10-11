import { useEffect, useState } from "react";
import type { MatchDetail, MatchShootout } from "../types/api";
import "./Shootout.css";

/** Penalty shootout, kick by kick: one row of circles per team.
 *  Only rendered for matches that had a shootout (Overview checks match.penalties). */
export function Shootout({ match }: { match: MatchDetail }) {
  const [data, setData] = useState<MatchShootout | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setFailed(false);
    fetch(`/api/matches/${match.id}/shootout`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Failed to load shootout (${response.status})`);
        setData(await response.json());
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [match.id]);

  const nameOf = (teamId: number) => (teamId === match.home_team.id ? match.home_team.name : match.away_team.name);

  let content;
  if (failed) {
    content = <p className="so-message">Couldn't load the shootout.</p>;
  } else if (!data) {
    content = (
      <div className="so-rows" aria-busy="true" aria-label="Loading shootout">
        {[0, 1].map((i) => (
          <span key={i} className="skeleton-bar" style={{ width: "70%", height: 30 }} />
        ))}
      </div>
    );
  } else {
    // one row per team, home first (like the rest of the page)
    const teams = [
      { side: "home", id: match.home_team.id, score: data.home_score },
      { side: "away", id: match.away_team.id, score: data.away_score },
    ] as const;
    const winnerScore = Math.max(data.home_score, data.away_score);
    const loserScore = Math.min(data.home_score, data.away_score);

    content = (
      <>
        <p className="so-summary">
          {nameOf(data.winner_team_id)} won {winnerScore}–{loserScore}. {nameOf(data.first_team_id)} kicked first.
        </p>
        <div className="so-rows">
          {teams.map((team) => {
            const kicks = data.kicks.filter((k) => k.team_id === team.id).sort((a, b) => a.taken - b.taken);
            return (
              <div key={team.side} className="so-team">
                <div className="so-team__head">
                  <strong>{nameOf(team.id)}</strong>
                  <span className="so-team__score">{team.score}</span>
                </div>
                <ol className="so-kicks">
                  {kicks.map((kick) => {
                    const label = `Kick ${kick.taken}: ${kick.player_name}, ${kick.result.toLowerCase()}`;
                    return (
                      <li
                        key={kick.order}
                        className={`so-kick so-kick--${team.side}${kick.goal ? " is-scored" : ""}`}
                        title={label}
                        aria-label={label}
                      >
                        {kick.goal ? "" : "✕"}
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })}
        </div>
        <span className="so-note">Filled = scored · ✕ = missed or saved</span>
      </>
    );
  }

  return (
    <section className="overview-card so-card" aria-labelledby="shootout-title">
      <h3 id="shootout-title">Shootout</h3>
      {content}
    </section>
  );
}

export default Shootout;
