import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Comparison, CompareSide, Competition, Match, Season } from "../types/api";
import "./Compare.css";

/* Compare page (prototype: "Compare.dc.html"): one team in two of its matches.
   Pick a competition/season, a team and two matches; GET /compare?team=&a=&b= returns both
   matches' stats, the PlayIQ performance score with its parts, the verdict and the key differences.
   The choices live in the URL (?season=43-106&team=779&a=…&b=…) so a comparison can be shared. */

type Letter = "A" | "B";
type Mode = "totals" | "per90";

/* ── formatting ── */

// "2022-12-18" -> "18 Dec" (local midnight, so it doesn't slip a day in American time zones)
const dayMonth = (iso: string) => new Date(`${iso}T00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const fmtInt = (v: number) => String(Math.round(v));
const fmt1 = (v: number) => v.toFixed(1);
const fmt2 = (v: number) => v.toFixed(2);
const fmtPct = (v: number) => `${Math.round(v)}%`;
const fmtPct1 = (v: number) => `${v.toFixed(1)}%`;
const fmtSigned = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`;
const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** "Group C", "Round of 16", "Final" */
function stageName(stage: string | null, group: string | null) {
  if (stage === "Group Stage") return group ? `Group ${group}` : "Group stage";
  return stage ?? "Match";
}

/** The match from the chosen team's point of view (for the dropdown labels) */
function teamView(m: Match, teamId: number) {
  const home = m.home_team_id === teamId;
  const gf = home ? m.home_team_score : m.away_team_score;
  const ga = home ? m.away_team_score : m.home_team_score;
  const pens = m.penalties ? (home ? [m.penalties.home, m.penalties.away] : [m.penalties.away, m.penalties.home]) : null;
  return { opp: home ? m.away_team_name : m.home_team_name, gf, ga, pens };
}

function matchLabel(m: Match, teamId: number) {
  const v = teamView(m, teamId);
  const res = v.gf > v.ga ? "Won" : v.gf < v.ga ? "Lost" : "Drew";
  const pens = v.pens ? ` (${v.pens[0]}–${v.pens[1]} pens)` : "";
  return `${stageName(m.competition_stage, m.group_name)} · vs ${v.opp} · ${res} ${v.gf}–${v.ga}${pens} · ${dayMonth(m.match_date)}`;
}

/** "Won", "Lost", "Drew · won 4–2 on pens" */
function resultText(side: CompareSide) {
  const base = side.result === "W" ? "Won" : side.result === "L" ? "Lost" : "Drew";
  const p = side.penalties;
  if (!p) return base;
  return `${base} · ${p.for > p.against ? "won" : "lost"} ${p.for}–${p.against} on pens`;
}

/* ── score parts: what each part measures, and the stat line shown under its bar ── */
const PART_INFO: Record<string, { basis: string; stat: (s: CompareSide) => string }> = {
  "Chance creation": {
    basis: "xG, shots on target and big chances per 90",
    stat: (s) => `${fmt2(s.stats_per_90.xg)} xG · ${fmt1(s.stats_per_90.shots_on_target)} on target`,
  },
  Defending: {
    basis: "xG, shots on target and big chances conceded per 90",
    stat: (s) => `${fmt2(s.stats_per_90.xg_against)} xG conceded`,
  },
  Result: {
    basis: "Win, draw or loss; winning a shootout adds a little",
    stat: (s) => `${resultText(s).split(" · ")[0]} ${s.stats.goals_for}–${s.stats.goals_against}${s.penalties ? " (pens)" : ""}`,
  },
  Control: {
    basis: "Possession, pass accuracy and progressive passes per 90",
    stat: (s) => `${fmtPct(s.stats.possession)} · ${fmtPct1(s.stats.pass_accuracy)} passing`,
  },
  Territory: {
    basis: "Attacking-third touches and final-third entries per 90",
    stat: (s) => `${fmtPct(s.stats.attacking_third_pct)} in attacking third`,
  },
};

/* ── full stats ── */
type Better = "hi" | "lo" | null;
// [label, value, format, better, scales with minutes]
type StatRow = [string, (s: CompareSide) => number, (v: number) => string, Better, boolean];
const GROUPS: [string, StatRow[]][] = [
  ["Result", [
    ["Goals scored", (s) => s.stats.goals_for, fmtInt, "hi", false],
    ["Goals conceded", (s) => s.stats.goals_against, fmtInt, "lo", false],
    ["xG difference", (s) => s.stats.xg - s.stats.xg_against, fmtSigned, "hi", false],
  ]],
  ["Chances", [
    ["Expected goals (xG)", (s) => s.stats.xg, fmt2, "hi", true],
    ["xG conceded", (s) => s.stats.xg_against, fmt2, "lo", true],
    ["Shots", (s) => s.stats.shots, fmtInt, "hi", true],
    ["Shots on target", (s) => s.stats.shots_on_target, fmtInt, "hi", true],
    ["Big chances", (s) => s.stats.big_chances, fmtInt, "hi", true],
  ]],
  ["Ball", [
    ["Possession", (s) => s.stats.possession, fmtPct, "hi", false],
    ["Passes", (s) => s.stats.passes, fmtInt, "hi", true],
    ["Pass accuracy", (s) => s.stats.pass_accuracy, fmtPct1, "hi", false],
    ["Progressive passes", (s) => s.stats.progressive_passes, fmtInt, "hi", true],
    ["Final-third entries", (s) => s.stats.final_third_entries, fmtInt, "hi", true],
    ["Territory (attacking third)", (s) => s.stats.attacking_third_pct, fmtPct, "hi", false],
  ]],
  ["Discipline", [
    ["Fouls", (s) => s.stats.fouls, fmtInt, null, true],
    ["Yellow cards", (s) => s.stats.yellow_cards, fmtInt, null, true],
  ]],
];

const toNumber = (text: string) => Number(text.replace("−", "-").replace(/[^0-9.-]/g, ""));

/* ── data loading ── */

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.detail ?? `Request failed (${response.status})`);
  }
  return response.json();
}

const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

export function Compare() {
  const [params, setParams] = useSearchParams();
  const [seasons, setSeasons] = useState<{ value: string; label: string }[] | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("totals");

  // 1. every competition's seasons, for the first dropdown ("FIFA World Cup · 2022")
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const comps = await getJson<Competition[]>("/api/competitions", controller.signal);
      const lists = await Promise.all(
        comps.map((c) =>
          getJson<Season[]>(`/api/competitions/${c.id}/seasons`, controller.signal).then((ss) =>
            ss.map((s) => ({ value: `${c.id}-${s.id}`, label: `${c.name} · ${s.year}` })),
          ),
        ),
      );
      setSeasons(lists.flat());
    })().catch((err) => {
      if (!isAbort(err)) setError("Couldn't load the competitions.");
    });
    return () => controller.abort();
  }, []);

  // Every choice starts empty; one only counts when it's in the URL and still valid
  // (so a shared link opens straight to its comparison).
  const seasonValue = seasons?.some((s) => s.value === params.get("season")) ? params.get("season")! : null;

  // 2. that season's matches (for the team list and the match dropdowns)
  useEffect(() => {
    if (!seasonValue) return;
    const [compId, seasonId] = seasonValue.split("-");
    const controller = new AbortController();
    getJson<Match[]>(`/api/competitions/${compId}/seasons/${seasonId}/matches`, controller.signal)
      .then(setMatches)
      .catch((err) => {
        if (!isAbort(err)) setError("Couldn't load the matches for this season.");
      });
    // clear this season's matches when the season changes or is cleared
    return () => {
      controller.abort();
      setMatches(null);
    };
  }, [seasonValue]);

  // teams in the season, A–Z
  const teams = useMemo(() => {
    const byId = new Map<number, string>();
    for (const m of matches ?? []) {
      byId.set(m.home_team_id, m.home_team_name);
      byId.set(m.away_team_id, m.away_team_name);
    }
    return [...byId].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name));
  }, [matches]);

  const teamId = teams.some((t) => t.id === Number(params.get("team"))) ? Number(params.get("team")) : null;
  const teamMatches = useMemo(
    () => (matches ?? []).filter((m) => m.home_team_id === teamId || m.away_team_id === teamId),
    [matches, teamId],
  );
  const ids = teamMatches.map((m) => m.id);
  const aParam = Number(params.get("a"));
  const bParam = Number(params.get("b"));
  const aId = ids.includes(aParam) ? aParam : null;
  const bId = ids.includes(bParam) && bParam !== aId ? bParam : null;
  const ready = teamId !== null && aId !== null && bId !== null;

  const choose = (next: Partial<Record<"season" | "team" | "a" | "b", string | number | null>>) => {
    const merged = { season: seasonValue, team: teamId, a: aId, b: bId, ...next };
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(merged)) if (v !== null && v !== undefined) out[k] = String(v);
    setParams(out, { replace: true });
  };

  // 3. the comparison itself
  useEffect(() => {
    if (!teamId || !aId || !bId || aId === bId) return;
    const controller = new AbortController();
    getJson<Comparison>(`/api/compare?team=${teamId}&a=${aId}&b=${bId}`, controller.signal)
      .then(setComparison)
      .catch((err) => {
        if (!isAbort(err)) setError(err instanceof Error ? err.message : "Couldn't load the comparison.");
      });
    // clear this comparison (and its error) when any of the choices change
    return () => {
      controller.abort();
      setComparison(null);
      setError(null);
    };
  }, [teamId, aId, bId]);

  const notEnoughMatches = matches !== null && teamId !== null && teamMatches.length < 2;

  return (
    <div className="page-width cp-page">
      <div className="cp-wrap">
        <header className="cp-intro">
          <h1>Compare matches</h1>
          <p>Pick a team and two of their matches to see which performance was better.</p>
        </header>

        {/* ── pick ── */}
        <section className="cp-card cp-picker" aria-label="Choose team and matches">
          <div className="cp-picker__top">
            <label className="cp-field">
              <span className="cp-field__label">Competition and season</span>
              <select
                className="input"
                value={seasonValue ?? ""}
                onChange={(e) => choose({ season: e.target.value, team: null, a: null, b: null })}
                disabled={!seasons}
              >
                <option value="" disabled>
                  {seasons ? "Choose a competition" : "Loading…"}
                </option>
                {(seasons ?? []).map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="cp-field">
              <span className="cp-field__label">Team</span>
              <select
                className="input"
                value={teamId ?? ""}
                onChange={(e) => choose({ team: e.target.value, a: null, b: null })}
                disabled={!teams.length}
              >
                <option value="" disabled>
                  {seasonValue && !matches ? "Loading…" : "Choose a team"}
                </option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="cp-picker__bottom">
            <label className="cp-field">
              <span className="cp-field__label">
                <span className="cp-letter cp-letter--a">A</span>Match A
              </span>
              <select className="input" value={aId ?? ""} onChange={(e) => choose({ a: e.target.value })} disabled={!teamMatches.length}>
                <option value="" disabled>
                  Choose a match
                </option>
                {teamMatches.map((m) => (
                  <option key={m.id} value={m.id} disabled={m.id === bId}>
                    {matchLabel(m, teamId!)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-secondary btn-icon cp-swap"
              aria-label="Swap matches A and B"
              title="Swap matches"
              onClick={() => choose({ a: bId, b: aId })}
              disabled={!aId || !bId}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m16 3 4 4-4 4" />
                <path d="M20 7H4" />
                <path d="m8 21-4-4 4-4" />
                <path d="M4 17h16" />
              </svg>
            </button>
            <label className="cp-field">
              <span className="cp-field__label">
                <span className="cp-letter cp-letter--b">B</span>Match B
              </span>
              <select className="input" value={bId ?? ""} onChange={(e) => choose({ b: e.target.value })} disabled={!teamMatches.length}>
                <option value="" disabled>
                  Choose a match
                </option>
                {teamMatches.map((m) => (
                  <option key={m.id} value={m.id} disabled={m.id === aId}>
                    {matchLabel(m, teamId!)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {error ? (
          <p className="cp-message" role="alert">
            {error}
          </p>
        ) : notEnoughMatches ? (
          <p className="cp-message">This team has only one match in this season, so there's nothing to compare it with.</p>
        ) : !ready ? (
          <div className="cp-empty">
            <h3>{!seasonValue ? "Choose a competition" : !teamId ? "Choose a team" : "Choose two matches"}</h3>
            <p>
              {!seasonValue
                ? "Start with a competition and season, then pick a team and two of their matches."
                : !teamId
                  ? "Pick the team whose matches you want to compare."
                  : aId === null && bId === null
                    ? "Pick Match A and Match B to see which performance was better."
                    : `Now pick Match ${aId === null ? "A" : "B"}.`}
            </p>
          </div>
        ) : !comparison ? (
          <div className="cp-loading" aria-busy="true" aria-label="Loading comparison">
            <div className="cp-cards">
              <span className="skeleton-bar" style={{ height: 300, borderRadius: 28 }} />
              <span className="skeleton-bar" style={{ height: 300, borderRadius: 28 }} />
            </div>
            <span className="skeleton-bar" style={{ height: 260, borderRadius: 32 }} />
          </div>
        ) : (
          <Results data={comparison} mode={mode} onMode={setMode} />
        )}
      </div>
    </div>
  );
}

/* ── results ── */

function Results({ data, mode, onMode }: { data: Comparison; mode: Mode; onMode: (m: Mode) => void }) {
  const { a, b, verdict } = data;
  const lead = verdict.better;
  const sides: [Letter, CompareSide][] = [
    ["A", a],
    ["B", b],
  ];

  return (
    <div className="cp-results">
      {/* the answer: both match cards, then the verdict */}
      <div className="cp-answer">
        <div className="cp-cards">
          {sides.map(([letter, s]) => (
            <MatchCard key={letter} letter={letter} side={s} team={data.team_name} lead={lead} />
          ))}
        </div>
        <div className="cp-verdict" role="status">
          <span className={`cp-verdict__badge${lead ? ` cp-fill--${lead.toLowerCase()}` : ""}`} aria-hidden="true">
            {lead ?? "="}
          </span>
          <span className="cp-verdict__text">
            <strong>
              {lead
                ? `Match ${lead} was better by ${verdict.points_gap} point${verdict.points_gap === 1 ? "" : "s"}`
                : "Both matches scored the same"}
            </strong>
            <span>A custom PlayIQ metric, not an official rating.</span>
          </span>
        </div>
      </div>

      {/* why: the score's parts */}
      <section className="cp-card" aria-labelledby="cp-how">
        <div className="cp-head">
          <h3 id="cp-how">How the score is made</h3>
          <span>Stats are per 90 minutes, so extra time doesn't inflate a score.</span>
        </div>
        <div className="cp-parts">
          {a.score.parts.map((partA, i) => {
            const partB = b.score.parts[i];
            const info = PART_INFO[partA.name];
            const better = partA.points === partB.points ? null : partA.points > partB.points ? "A" : "B";
            return (
              <div key={partA.name} className="cp-part">
                <div className="cp-part__name">
                  <span>
                    <strong>{partA.name}</strong>
                    <em>{partA.max}%</em>
                  </span>
                  <small>{info?.basis}</small>
                </div>
                <div className="cp-part__bars">
                  {([["A", partA, a], ["B", partB, b]] as const).map(([letter, part, side]) => (
                    <div key={letter} className="cp-bar">
                      <span className={`cp-letter cp-letter--${letter.toLowerCase()}`}>{letter}</span>
                      <span className="cp-track">
                        <span
                          className={`cp-fill--${letter.toLowerCase()}${better && better !== letter ? " is-behind" : ""}`}
                          style={{ width: `${(part.points / part.max) * 100}%` }}
                        />
                      </span>
                      <span className={`cp-bar__pts${better === letter ? ` cp-text--${letter.toLowerCase()}` : ""}`}>
                        {part.points}
                        <small>/{part.max}</small>
                      </span>
                      <span className="cp-bar__stat">{info?.stat(side)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="cp-part cp-part--total">
            <strong>Total</strong>
            <div className="cp-totals">
              {sides.map(([letter, s]) => (
                <span key={letter}>
                  <span className={`cp-letter cp-letter--${letter.toLowerCase()}`}>{letter}</span>
                  <span className={`cp-totals__v${lead === letter ? ` cp-text--${letter.toLowerCase()}` : ""}`}>{s.score.total}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* the story */}
      <section className="cp-card" aria-labelledby="cp-kd">
        <div className="cp-head">
          <h3 id="cp-kd">Key differences</h3>
        </div>
        {data.key_differences.length ? (
          <div className="cp-kd">
            {data.key_differences.map((k) => (
              <div key={k.part} className="cp-kd__row">
                <span className={`cp-kd__badge cp-fill--${k.better.toLowerCase()}`} aria-label={`Better in Match ${k.better}`}>
                  {k.better}
                </span>
                <span className="cp-kd__body">
                  <span className="cp-kd__title">
                    <strong>{k.part}</strong>
                    <em className={`cp-text--${k.better.toLowerCase()}`}>
                      +{Math.round(k.points_gap)} pts to {k.better}
                    </em>
                  </span>
                  <span>{k.text}</span>
                </span>
                <span className="cp-kd__vals">
                  <strong>
                    {k.values.a} vs {k.values.b}
                  </strong>
                  <small>{k.unit}</small>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="cp-message">The two matches scored the same in every part.</p>
        )}
      </section>

      {/* the evidence */}
      <FullStats a={a} b={b} mode={mode} onMode={onMode} />
    </div>
  );
}

function MatchCard({ letter, side, team, lead }: { letter: Letter; side: CompareSide; team: string; lead: Letter | null }) {
  const l = letter.toLowerCase();
  const isLead = lead === letter;
  const strength = side.opponent_strength;
  const year = side.match_date.slice(0, 4);
  return (
    <article
      className={`cp-match cp-match--${l}`}
      aria-label={`Match ${letter}: ${team} ${side.stats.goals_for}, ${side.opponent_name} ${side.stats.goals_against}`}
    >
      <div className="cp-match__meta">
        <span className={`cp-letter cp-letter--${l} cp-letter--lg`}>{letter}</span>
        <span>
          {stageName(side.competition_stage, side.group_name)} · {dayMonth(side.match_date)} {year}
        </span>
        {side.extra_time && <span className="tag tag-neutral cp-tag">After extra time</span>}
      </div>
      <div className="cp-match__opp">
        <span>vs</span>
        <strong>{side.opponent_name}</strong>
      </div>
      <div className="cp-match__score">
        <span className="cp-num">
          {side.stats.goals_for}–{side.stats.goals_against}
        </span>
        <span className={`tag cp-result cp-result--${side.result.toLowerCase()}`}>
          <b>{side.result}</b>
          {resultText(side)}
        </span>
      </div>
      {strength && (
        <span className="cp-match__strength">
          Opponent's tournament xG difference <strong>{fmtSigned(strength.xg_difference)}</strong> · {ordinal(strength.rank)} of {strength.teams}
        </span>
      )}
      <div className="cp-perf">
        <span className="cp-perf__label">PlayIQ performance score</span>
        <span className="cp-perf__line">
          <span className={`cp-perf__num${isLead ? ` cp-text--${l}` : ""}`}>
            {side.score.total}
            <small>/100</small>
          </span>
          <span className="cp-perf__band">{side.score.band}</span>
        </span>
        <span
          className="cp-track cp-track--perf"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={side.score.total}
          aria-label={`PlayIQ performance score ${side.score.total} out of 100, ${side.score.band}`}
        >
          <span className={`cp-fill--${l}${lead && !isLead ? " is-behind" : ""}`} style={{ width: `${side.score.total}%` }} />
        </span>
      </div>
      <Link to={`/matches/${side.match_id}`} className="cp-open">
        Open match analysis
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </Link>
    </article>
  );
}

function FullStats({ a, b, mode, onMode }: { a: CompareSide; b: CompareSide; mode: Mode; onMode: (m: Mode) => void }) {
  const per90 = mode === "per90";
  const minsNote = (letter: Letter, s: CompareSide) => `Match ${letter} ${s.minutes} min${s.extra_time ? " (extra time)" : ""}`;
  return (
    <section className="cp-card cp-stats" aria-labelledby="cp-full">
      <div className="cp-stats__top">
        <div className="cp-head">
          <h3 id="cp-full">Full stats</h3>
          <span>
            {minsNote("A", a)} · {minsNote("B", b)}
          </span>
        </div>
        <div className="seg cp-seg" role="radiogroup" aria-label="Show totals or per 90 minutes">
          {(
            [
              ["totals", "Totals"],
              ["per90", "Per 90"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="seg-opt">
              <input type="radio" name="cp-mode" checked={mode === value} onChange={() => onMode(value)} />
              {label}
            </label>
          ))}
        </div>
      </div>
      <div className="cp-stats__legend">
        <span>
          <span className="cp-letter cp-letter--a">A</span>vs {a.opponent_name}
        </span>
        <span>
          vs {b.opponent_name}
          <span className="cp-letter cp-letter--b">B</span>
        </span>
      </div>
      <div className="cp-groups">
        {GROUPS.map(([title, rows]) => (
          <div key={title} className="cp-group">
            <h6>{title}</h6>
            {rows.map(([label, get, format, better, scales]) => {
              const use = per90 && scales;
              const va = use ? (get(a) * 90) / a.minutes : get(a);
              const vb = use ? (get(b) * 90) / b.minutes : get(b);
              const fmt = use && format === fmtInt ? fmt1 : format;
              const ta = fmt(va);
              const tb = fmt(vb);
              // compare what's shown, so 1.0 vs 1.0 isn't highlighted as a win
              const na = toNumber(ta);
              const nb = toNumber(tb);
              const lead = !better || na === nb ? null : (better === "hi") === na > nb ? "a" : "b";
              // bars: the better value gets the longer bar, also when lower is better
              let fa = better === "lo" ? vb : va;
              let fb = better === "lo" ? va : vb;
              const low = Math.min(fa, fb);
              if (low < 0) {
                fa = fa - low + 0.25;
                fb = fb - low + 0.25;
              }
              return (
                <div key={label} className="cp-row">
                  <div className="cp-row__vals">
                    <span className={`cp-pill${lead === "a" ? " cp-fill--a" : ""}`}>{ta}</span>
                    <span className="cp-row__label">
                      {label}
                      {use ? " per 90" : ""}
                    </span>
                    <span className={`cp-pill cp-pill--end${lead === "b" ? " cp-fill--b" : ""}`}>{tb}</span>
                  </div>
                  <div className="cp-row__bars" aria-hidden="true">
                    <span className={`cp-fill--a${lead === "b" ? " is-behind" : ""}`} style={{ flexGrow: Math.max(fa, 0.001) }} />
                    <span className={`cp-fill--b${lead === "a" ? " is-behind" : ""}`} style={{ flexGrow: Math.max(fb, 0.001) }} />
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

export default Compare;
