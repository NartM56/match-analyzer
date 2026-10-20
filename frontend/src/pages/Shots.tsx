import { useCallback, useEffect, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import type { MatchDetail, MatchXg, XgShot } from "../types/api";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { teamCode } from "../utils/format";
import { HalfPitchShots, KIND_LABEL, ShotIcon, shotKind, type ShotKind, type Side } from "../components/ShotMap";
import { PlayerPanel } from "../components/PlayerPanel";
import "./Shots.css";

/* Shots tab: every shot of the match (from GET /matches/{id}/xg) on a half-pitch per team,
   with team / player / outcome filters, the selected shot's details, a team comparison of the
   shots shown, and the list of those shots underneath.
   Only the filter *choices* are stored; the shots to show are worked out from all shots on each render. */

type TeamFilter = "both" | Side;

const KINDS: ShotKind[] = ["goal", "saved", "off", "blocked"];
const CHIP_LABEL: Record<ShotKind, string> = { goal: "Goals", saved: "Saved", off: "Off target", blocked: "Blocked" };
const ALL_ON: Record<ShotKind, boolean> = { goal: true, saved: true, off: true, blocked: true };

const sumXg = (list: XgShot[]) => list.reduce((sum, s) => sum + s.xg, 0);

/** The numbers in the "Filtered shots" table. On target = goals + saved, like the Overview stats. */
function totals(list: XgShot[]) {
  const kinds = list.map((s) => shotKind(s.outcome));
  const xg = sumXg(list);
  return {
    shots: list.length,
    onTarget: kinds.filter((k) => k === "goal" || k === "saved").length,
    goals: kinds.filter((k) => k === "goal").length,
    xg,
    xgPerShot: list.length ? xg / list.length : 0,
  };
}

/** "Left Foot · Penalty" (open play isn't worth saying) */
function shotMeta(s: XgShot) {
  return [s.body_part, s.shot_type !== "Open Play" ? s.shot_type : null].filter(Boolean).join(" · ");
}

export function Shots() {
  const { match } = useOutletContext<{ match: MatchDetail }>();
  const [data, setData] = useState<MatchXg | null>(null);
  const [failed, setFailed] = useState(false);

  // filter choices
  const [team, setTeam] = useState<TeamFilter>("both");
  const [playerId, setPlayerId] = useState<number | "all">("all");
  const [outcomes, setOutcomes] = useState(ALL_ON);
  const [selectedKey, setSelectedKey] = useState<number | null>(null); // event_index of the picked shot

  const wide = useMediaQuery("(min-width: 1080px)");
  const mobile = useMediaQuery("(max-width: 759px)");

  // "View player" opens the player panel, the same way as on the Lineups tab (?player=<id>)
  const [searchParams, setSearchParams] = useSearchParams();
  const openId = Number(searchParams.get("player")) || null;
  const closePlayer = useCallback(() => setSearchParams({}), [setSearchParams]);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setFailed(false);
    fetch(`/api/matches/${match.id}/xg`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Failed to load shots (${response.status})`);
        setData(await response.json());
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [match.id]);

  if (failed) {
    return <p className="sh-message">Couldn't load the shots.</p>;
  }
  if (!data) {
    return <span className="skeleton-bar" style={{ width: "100%", height: 520 }} aria-label="Loading shots" />;
  }

  const teams = {
    home: { side: "home" as Side, id: match.home_team.id, name: match.home_team.name, code: teamCode(match.home_team.name) },
    away: { side: "away" as Side, id: match.away_team.id, name: match.away_team.name, code: teamCode(match.away_team.name) },
  };
  const sideOf = (s: XgShot): Side => (s.team_id === teams.home.id ? "home" : "away");
  const shown = team === "both" ? [teams.home, teams.away] : [teams[team]];
  const both = shown.length === 2;

  // own goals are in /xg so the xG race's goal dots match the score, but they aren't shots
  const shots = data.shots.filter((s) => !s.own_goal && s.x !== null);

  // each filter narrows the one before it
  const inTeam = shots.filter((s) => team === "both" || sideOf(s) === team);

  // the player dropdown: everyone in the chosen team(s) who had a shot, most shots first
  const shooters: { id: number; name: string; side: Side; count: number }[] = [];
  for (const s of inTeam) {
    if (s.player_id === null) continue;
    const found = shooters.find((p) => p.id === s.player_id);
    if (found) found.count++;
    else shooters.push({ id: s.player_id, name: s.player_name, side: sideOf(s), count: 1 });
  }
  shooters.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  // a player from the other team (after switching team) falls back to "All players"
  const player = shooters.some((p) => p.id === playerId) ? playerId : "all";

  const byPlayer = inTeam.filter((s) => player === "all" || s.player_id === player);
  const visible = byPlayer.filter((s) => outcomes[shotKind(s.outcome)]);
  const selected = visible.find((s) => s.event_index === selectedKey) ?? null;

  // the subtitle always shows the whole match
  const subtitle = `${shots.length} shots · ${teams.home.name} ${sumXg(shots.filter((s) => sideOf(s) === "home")).toFixed(2)} xG, ${
    teams.away.name
  } ${sumXg(shots.filter((s) => sideOf(s) === "away")).toFixed(2)} xG`;

  const describe = (s: XgShot) =>
    `${s.minute_label} ${s.player_name} (${teams[sideOf(s)].name}), ${KIND_LABEL[shotKind(s.outcome)]}, ${s.xg.toFixed(2)} xG${
      shotMeta(s) ? `, ${shotMeta(s)}` : ""
    }`;
  const select = (s: XgShot) => setSelectedKey(s.event_index);

  // the "Filtered shots" comparison: one column per team shown, the better value in bold
  const teamTotals = shown.map((t) => totals(visible.filter((s) => sideOf(s) === t.side)));
  const tableRows: { label: string; key: keyof ReturnType<typeof totals>; format: (v: number) => string }[] = [
    { label: "Shots", key: "shots", format: String },
    { label: "On target", key: "onTarget", format: String },
    { label: "Goals", key: "goals", format: String },
    { label: "xG", key: "xg", format: (v) => v.toFixed(2) },
    { label: "xG per shot", key: "xgPerShot", format: (v) => v.toFixed(2) },
  ];

  const listed = [...visible].sort(
    (a, b) => a.period - b.period || a.minute - b.minute || a.second - b.second || a.event_index - b.event_index,
  );

  return (
    <div className="sh-page">
      <section className="overview-card sh-card" aria-labelledby="sh-map-title">
        <div className="sh-head">
          <div className="sh-head__text">
            <h3 id="sh-map-title">Shot map</h3>
            <span className="sh-sub">{subtitle}</span>
          </div>
          <div className="seg sh-seg" role="radiogroup" aria-label="Team">
            {(
              [
                ["both", "Both"],
                ["home", teams.home.name],
                ["away", teams.away.name],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="seg-opt">
                <input
                  type="radio"
                  name="sh-team"
                  checked={team === value}
                  onChange={() => {
                    setTeam(value);
                    setSelectedKey(null);
                  }}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="sh-filters">
          <select
            className="input sh-player"
            aria-label="Filter by player"
            value={String(player)}
            onChange={(e) => {
              setPlayerId(e.target.value === "all" ? "all" : Number(e.target.value));
              setSelectedKey(null);
            }}
          >
            <option value="all">All players</option>
            {shooters.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {both ? ` (${teams[p.side].code})` : ""} · {p.count}
              </option>
            ))}
          </select>
          <div className="sh-chips" role="group" aria-label="Filter by outcome">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                className={`sh-chip${outcomes[k] ? " is-on" : ""}`}
                aria-pressed={outcomes[k]}
                onClick={() => {
                  setOutcomes((o) => ({ ...o, [k]: !o[k] }));
                  setSelectedKey(null);
                }}
              >
                <ShotIcon kind={k} />
                {CHIP_LABEL[k]}
                <span className="sh-chip__count">{byPlayer.filter((s) => shotKind(s.outcome) === k).length}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={`sh-body${wide ? " sh-body--wide" : ""}`}>
          <div className={`sh-pitches${both && !mobile ? " sh-pitches--two" : ""}${both ? "" : " sh-pitches--one"}`}>
            {shown.map((t) => {
              const list = visible.filter((s) => sideOf(s) === t.side);
              return (
                <div key={t.side} className="sh-pitch">
                  <div className="sh-pitch__head">
                    <span className="sh-pitch__team">
                      <span className={`sh-dot sh-dot--${t.side}`} aria-hidden="true" />
                      {t.name}
                    </span>
                    <span className="sh-pitch__sub">
                      {list.length} shot{list.length === 1 ? "" : "s"} · {sumXg(list).toFixed(2)} xG
                    </span>
                  </div>
                  <div className="sh-pitch__frame">
                    <HalfPitchShots
                      shots={list}
                      side={t.side}
                      selected={selected}
                      onSelect={select}
                      label={`${t.name} shot map: ${list.length} shots`}
                      describe={describe}
                    />
                    {!list.length && (
                      <div className="sh-empty">
                        <span>No shots match these filters</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <span className="sh-caption">
              Bigger marker = higher xG. Shootout penalties aren't included.
            </span>
          </div>

          <div className="sh-side">
            {selected ? (
              <div className="sh-detail" aria-live="polite">
                <div className="sh-detail__top">
                  <span className={`tag ${sideOf(selected) === "home" ? "tag-accent" : "tag-accent-2"} sh-detail__team`}>
                    {teams[sideOf(selected)].name}
                  </span>
                  <span className="sh-detail__min">{selected.minute_label}</span>
                </div>
                <h4>{selected.player_name}</h4>
                <div className="sh-detail__facts">
                  {[
                    { k: "Outcome", v: KIND_LABEL[shotKind(selected.outcome)] },
                    { k: "xG", v: selected.xg.toFixed(2) },
                    { k: "Body part", v: selected.body_part ?? "–" },
                    { k: "Type", v: selected.shot_type ?? "–" },
                  ].map((f) => (
                    <div key={f.k}>
                      <span>{f.k}</span>
                      <strong>{f.v}</strong>
                    </div>
                  ))}
                </div>
                {selected.player_id !== null && (
                  <button
                    type="button"
                    className="btn btn-secondary sh-detail__open"
                    onClick={() => setSearchParams({ player: String(selected.player_id) })}
                  >
                    View player
                  </button>
                )}
              </div>
            ) : (
              <div className="sh-pick">
                <h5>Pick a shot</h5>
                <p>Hover or tap a marker, or choose one from the list below, to see who took it, when, and how good the chance was.</p>
              </div>
            )}

            <div className="sh-table" role="table" aria-label="Filtered shots by team">
              <div className="sh-table__row sh-table__head" role="row" style={{ gridTemplateColumns: `minmax(0, 1fr) repeat(${shown.length}, 56px)` }}>
                <span role="columnheader">Filtered shots</span>
                {shown.map((t) => (
                  <span key={t.side} role="columnheader" className={`sh-code--${t.side}`}>
                    {t.code}
                  </span>
                ))}
              </div>
              {tableRows.map((r) => {
                const values = teamTotals.map((tt) => tt[r.key]);
                const best = both && values[0] !== values[1] ? (values[0] > values[1] ? 0 : 1) : -1;
                return (
                  <div key={r.key} className="sh-table__row" role="row" style={{ gridTemplateColumns: `minmax(0, 1fr) repeat(${shown.length}, 56px)` }}>
                    <span role="rowheader">{r.label}</span>
                    {values.map((v, i) => (
                      <span key={i} role="cell" className={i === best ? "is-best" : ""}>
                        {r.format(v)}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="overview-card sh-card sh-list-card" aria-labelledby="sh-list-title">
        <div className="sh-list-head">
          <h3 id="sh-list-title">Every shot</h3>
          <span className="sh-sub">{visible.length === shots.length ? `${shots.length} shots` : `${visible.length} of ${shots.length} shots`}</span>
        </div>
        {listed.length ? (
          <div className="sh-list">
            {listed.map((s) => {
              const kind = shotKind(s.outcome);
              return (
                <button
                  key={s.event_index}
                  type="button"
                  className={`sh-row${selected === s ? " is-selected" : ""}`}
                  aria-pressed={selected === s}
                  aria-label={describe(s)}
                  onClick={() => select(s)}
                >
                  <span className="sh-row__min">{s.minute_label}</span>
                  <span className="sh-row__who">
                    <span className="sh-row__name">
                      <span className={`sh-dot sh-dot--small sh-dot--${sideOf(s)}`} aria-hidden="true" />
                      <span className="sh-row__name-text">{s.player_name}</span>
                    </span>
                    {shotMeta(s) && <span className="sh-row__meta">{shotMeta(s)}</span>}
                  </span>
                  <span className={`tag sh-row__out${kind === "goal" ? " is-goal" : ""}`}>{KIND_LABEL[kind]}</span>
                  <span className="sh-row__xg">{s.xg.toFixed(2)}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="sh-message">No shots match these filters.</p>
        )}
      </section>

      {openId && <PlayerPanel match={match} playerId={openId} onClose={closePlayer} />}
    </div>
  );
}

export default Shots;
