import { useState, useEffect } from "react";
import type { Competition, Season, Match } from "../types/api";
import { useMediaQuery } from "../hooks/useMediaQuery";
import "./MatchSelection.css";

type Status = "loading" | "ready" | "error";
type GenderFilter = "all" | "male" | "female";

const GENDER_FILTERS: { value: GenderFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "male", label: "Men's" },
  { value: "female", label: "Women's" },
];

const SKELETON_WIDTHS = ["72%", "58%", "80%", "64%", "50%", "70%"];

function genderLabel(gender: string) {
  return gender === "female" ? "Women's" : "Men's";
}

// "International" first, then countries alphabetically
function compareCountries(a: string, b: string) {
  if (a === "International") return -1;
  if (b === "International") return 1;
  return a.localeCompare(b);
}

/* ── data fetching (no component state needed, so it lives outside the component) ── */

async function fetchSeasons(competitionId: number): Promise<Season[]> {
  try {
    const response = await fetch(`/api/competitions/${competitionId}/seasons`);
    if (!response.ok) {
      throw new Error(`Failed to fetch seasons (${response.status})`);
    }
    return await response.json();
  } catch (err) {
    console.error(err);
    return [];
  }
}

async function fetchMatches(competitionId: number, seasonId: number): Promise<Match[]> {
  try {
    const response = await fetch(
      `/api/competitions/${competitionId}/seasons/${seasonId}/matches`,
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch matches (${response.status})`);
    }
    return await response.json();
  } catch (err) {
    console.error(err);
    return [];
  }
}

/* ── match helpers ── */

type SortOrder = "asc" | "desc";

type MatchSection = {
  key: string;
  title: string;
  sub: string;
  rows: Match[];
};

// "2022-11-20" -> "Sun 20 Nov". The "T00:00" makes it local midnight; without it the
// date is read as UTC and shows the previous day in North American time zones.
function formatDate(isoDate: string) {
  return new Date(`${isoDate}T00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// Official FIFA codes. StatsBomb has no team codes, and guessing them from the name gives
// wrong (and sometimes offensive) results, so known teams are looked up here.
const TEAM_CODES: Record<string, string> = {
  Argentina: "ARG", Australia: "AUS", Belgium: "BEL", Brazil: "BRA", Cameroon: "CMR",
  Canada: "CAN", "Costa Rica": "CRC", Croatia: "CRO", Denmark: "DEN", Ecuador: "ECU",
  England: "ENG", France: "FRA", Germany: "GER", Ghana: "GHA", Iran: "IRN", Japan: "JPN",
  Mexico: "MEX", Morocco: "MAR", Netherlands: "NED", Poland: "POL", Portugal: "POR",
  Qatar: "QAT", "Saudi Arabia": "KSA", Senegal: "SEN", Serbia: "SRB", "South Korea": "KOR",
  Spain: "ESP", Switzerland: "SUI", Tunisia: "TUN", "United States": "USA", Uruguay: "URU",
  Wales: "WAL",
};

// Unknown teams fall back to their words' first letters ("Real Madrid" -> "RM"),
// or the first two letters of a one-word name.
function teamCode(teamName: string) {
  const known = TEAM_CODES[teamName];
  if (known) return known;
  const words = teamName.split(/\s+/).filter(Boolean);
  return words.length > 1
    ? words.map((w) => w[0]).join("").slice(0, 3).toUpperCase()
    : teamName.slice(0, 2).toUpperCase();
}

function winner(m: Match): "home" | "away" | null {
  if (m.home_team_score > m.away_team_score) return "home";
  if (m.away_team_score > m.home_team_score) return "away";
  return null; // draw (penalty shootouts aren't in the data yet)
}

// date + kick-off as one sortable string, e.g. "2022-11-20 16:00:00"
function kickOffKey(m: Match) {
  return `${m.match_date} ${m.kick_off ?? ""}`;
}

function sortMatches(list: Match[], order: SortOrder) {
  const sorted = [...list].sort((a, b) => kickOffKey(a).localeCompare(kickOffKey(b)));
  return order === "asc" ? sorted : sorted.reverse();
}

// Groups matches (already sorted) into sections; the group stage is split by matchday.
function buildSections(list: Match[]): MatchSection[] {
  const sections: MatchSection[] = [];
  for (const m of list) {
    const isGroup = m.competition_stage === "Group Stage";
    const title = isGroup ? "Group stage" : m.competition_stage ?? "Matches";
    const key = isGroup ? `${title} · ${m.match_week}` : title;

    let section = sections.find((s) => s.key === key);
    if (!section) {
      section = { key, title, sub: isGroup ? `Matchday ${m.match_week}` : "", rows: [] };
      sections.push(section);
    }
    section.rows.push(m);
  }
  return sections;
}

function countLabel(n: number) {
  return `${n} match${n === 1 ? "" : "es"}`;
}

export function MatchSelection() {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [reloadKey, setReloadKey] = useState(0);

  const [searchComp, setSearchComp] = useState("");
  const [genderFilter, setGenderFilter] = useState<GenderFilter>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // On phones the list and the selected competition are two separate steps
  const isMobile = useMediaQuery("(max-width: 759px)");
  const [mobileStep, setMobileStep] = useState<"list" | "detail">("list");

  const [seasons, setSeasons] = useState<Season[]>([]);
  const [searchMatch, setSearchMatch] = useState("");
  const [selectedSeason, setSelectedSeason] = useState<Season | null>(null);

  const [matches, setMatches] = useState<Match[]>([]);
  const [stageFilter, setStageFilter] = useState("All");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");

  useEffect(() => {
    const controller = new AbortController();

    const fetchCompetitions = async () => {
      try {
        const response = await fetch("/api/competitions", {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Failed to fetch competitions (${response.status})`);
        }
        const data: Competition[] = await response.json();
        setCompetitions(data);
        setStatus("ready");
        // open the first competition so the page isn't empty
        setSelectedId((current) => current ?? data[0]?.id ?? null);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setStatus("error");
      }
    };

    fetchCompetitions();
    return () => controller.abort(); // cancel the request if the page is left early
  }, [reloadKey]);

  useEffect(() => {
    if (selectedId === null) return;
    let cancelled = false;

    fetchSeasons(selectedId).then((data) => {
      if (!cancelled) {
        setSeasons(data);
        // seasons arrive newest first, so open the latest one
        setSelectedSeason(data[0] ?? null);
        setMatches([]);
        setStageFilter("All");
        setSearchMatch("");
      }
    });

    return () => {
      cancelled = true; // ignore a slow response if the user already picked another competition
    };
  }, [selectedId]);

  useEffect(() => {
    if (selectedSeason === null) return;
    let cancelled = false;

    // league_id comes from the season itself, so competition and season always belong together
    fetchMatches(selectedSeason.league_id, selectedSeason.id).then((data) => {
      if (!cancelled) setMatches(data);
    });

    return () => {
      cancelled = true; // ignore a slow response if the user already picked another season
    };
  }, [selectedSeason]);

  // a season button click: switch season and start from an unfiltered list
  const pickSeason = (season: Season) => {
    if (season.id === selectedSeason?.id) return;
    setSelectedSeason(season);
    setMatches([]);
    setStageFilter("All");
    setSearchMatch("");
  };

  const retry = () => {
    setStatus("loading");
    setReloadKey((k) => k + 1);
  };

  const query = searchComp.trim().toLowerCase();
  const visible = competitions.filter(
    (c) =>
      (genderFilter === "all" || c.gender === genderFilter) &&
      (c.name.toLowerCase().includes(query) ||
        c.country.toLowerCase().includes(query)),
  );

  const byCountry: Record<string, Competition[]> = {};
  for (const c of visible) {
    if (!byCountry[c.country]) {
      byCountry[c.country] = [];
    }
    byCountry[c.country].push(c);
  }

  const selected = competitions.find((c) => c.id === selectedId) ?? null;
  const noData = competitions.length === 0;

  // Matches: `matches` stays exactly as fetched; the filters only decide what's shown.
  const matchQuery = searchMatch.trim().toLowerCase();
  const shownMatches = matches.filter(
    (m) =>
      (stageFilter === "All" || m.competition_stage === stageFilter) &&
      (m.home_team_name.toLowerCase().includes(matchQuery) ||
        m.away_team_name.toLowerCase().includes(matchQuery)),
  );
  // stage chips come from the data, in the order the stages were played
  const stages = [
    "All",
    ...new Set(sortMatches(matches, "asc").map((m) => m.competition_stage ?? "Other")),
  ];
  const sections = buildSections(sortMatches(shownMatches, sortOrder));
  const isFiltered = shownMatches.length !== matches.length;

  const pickCompetition = (id: number) => {
    setSelectedId(id);
    if (isMobile) setMobileStep("detail");
  };

  const showList = !isMobile || mobileStep === "list";
  const showDetail = !isMobile || mobileStep === "detail";

  return (
    <div className="page-width match-picker">
      {showList && (
        <header className="match-picker__intro">
          <h1>Pick a match</h1>
          <p>
            Choose a competition and season, then open any match to see the
            shots, the passing and the story behind the score.
          </p>
        </header>
      )}

      <div className="match-picker__layout">
        {showList && (
          <aside className="comp-pane" aria-label="Competitions">
            <div className="comp-pane__head">
              <h4>Competitions</h4>
              {status === "ready" && (
                <span className="comp-pane__count">
                  {visible.length} of {competitions.length}
                </span>
              )}
            </div>

            <div className="search-field">
              <SearchIcon />
              <input
                className="input"
                type="search"
                aria-label="Search competitions"
                placeholder="Search competition or country"
                value={searchComp}
                onChange={(e) => setSearchComp(e.target.value)}
              />
            </div>

            <div
              className="seg comp-pane__gender"
              role="radiogroup"
              aria-label="Filter by gender"
            >
              {GENDER_FILTERS.map((f) => (
                <label key={f.value} className="seg-opt">
                  <input
                    type="radio"
                    name="piq-gender"
                    checked={genderFilter === f.value}
                    onChange={() => setGenderFilter(f.value)}
                  />
                  {f.label}
                </label>
              ))}
            </div>

            {status === "loading" && (
              <div
                className="comp-pane__skeleton"
                aria-busy="true"
                aria-label="Loading competitions"
              >
                {SKELETON_WIDTHS.map((width, i) => (
                  <div key={i} className="comp-pane__skeleton-item">
                    <span
                      className="skeleton-bar"
                      style={{ width, height: 12 }}
                    />
                    <span
                      className="skeleton-bar"
                      style={{ width: "40%", height: 9 }}
                    />
                  </div>
                ))}
              </div>
            )}

            {status === "error" && (
              <div className="comp-pane__alert" role="alert">
                <AlertIcon size={20} />
                <h5>Couldn't load competitions</h5>
                <p>Check your connection and try again.</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={retry}
                >
                  Try again
                </button>
              </div>
            )}

            {status === "ready" && visible.length === 0 && (
              <div className="comp-pane__empty">
                <h5>
                  {noData
                    ? "No competitions yet"
                    : `Nothing matches “${searchComp}”`}
                </h5>
                <p>
                  {noData
                    ? "Match data is still being prepared. Check back soon."
                    : "Try a country, or a name like “World Cup”."}
                </p>
                {!noData && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setSearchComp("");
                      setGenderFilter("all");
                    }}
                  >
                    Clear search
                  </button>
                )}
              </div>
            )}

            {status === "ready" && visible.length > 0 && (
              <ul className="comp-list">
                {Object.entries(byCountry)
                  .sort(([a], [b]) => compareCountries(a, b))
                  .map(([country, comps]) => (
                    <li key={country} className="comp-group">
                      <h6>{country}</h6>
                      <ul>
                        {comps.map((competition) => (
                          <li key={competition.id}>
                            <button
                              type="button"
                              className="comp-item"
                              aria-pressed={competition.id === selectedId}
                              onClick={() => pickCompetition(competition.id)}
                            >
                              <span className="comp-item__text">
                                <span className="comp-item__name">
                                  {competition.name}
                                </span>
                                <span className="comp-item__meta">
                                  {genderLabel(competition.gender)}
                                </span>
                              </span>
                              <span className="comp-item__chevron">
                                <ChevronIcon direction="right" />
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
              </ul>
            )}
          </aside>
        )}

        {showDetail && (
          <section
            className="match-picker__main"
            aria-label="Seasons and matches"
          >
            {isMobile && (
              <button
                type="button"
                className="btn btn-ghost match-picker__back"
                onClick={() => setMobileStep("list")}
              >
                <ChevronIcon direction="left" size={18} />
                Competitions
              </button>
            )}

            {!selected && status !== "error" && (
              <div className="start-panel">
                <h3>Start with a competition</h3>
                <p>
                  Pick one on the right to see its seasons and every match we
                  have data for.
                </p>
              </div>
            )}

            {selected && (
              <div className="comp-heading">
                <div className="comp-heading__tags">
                  <span className="tag tag-accent-2">
                    {genderLabel(selected.gender)}
                  </span>
                  <span className="tag tag-neutral">{selected.country}</span>
                </div>
                <h2>{selected.name}</h2>
              </div>
            )}
            {selected && (
              <div className="season-picker">
                <h6>Season</h6>
                <div className="pill-row" role="group" aria-label="Seasons">
                  {seasons.map((season) => (
                    <button
                      key={season.id}
                      type="button"
                      className={`btn pill ${season.id === selectedSeason?.id ? "btn-primary" : "btn-secondary"}`}
                      aria-pressed={season.id === selectedSeason?.id}
                      onClick={() => pickSeason(season)}
                    >
                      {season.year}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selected && matches.length > 0 && (
              <div className="match-toolbar">
                <div className="match-toolbar__row">
                  <div className="search-field match-toolbar__search">
                    <SearchIcon />
                    <input
                      className="input"
                      type="search"
                      aria-label="Search matches by team"
                      placeholder="Search by team"
                      value={searchMatch}
                      onChange={(e) => setSearchMatch(e.target.value)}
                    />
                  </div>
                  <span className="match-toolbar__count" aria-live="polite">
                    {isFiltered
                      ? `${shownMatches.length} of ${countLabel(matches.length)}`
                      : countLabel(matches.length)}
                  </span>
                  <div className="seg" role="radiogroup" aria-label="Sort order">
                    {(
                      [
                        ["desc", "Latest first"],
                        ["asc", "Earliest first"],
                      ] as const
                    ).map(([value, label]) => (
                      <label key={value} className="seg-opt">
                        <input
                          type="radio"
                          name="piq-sort"
                          checked={sortOrder === value}
                          onChange={() => setSortOrder(value)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="pill-row" role="group" aria-label="Filter by stage">
                  {stages.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`btn chip ${s === stageFilter ? "btn-primary" : "btn-secondary"}`}
                      aria-pressed={s === stageFilter}
                      onClick={() => setStageFilter(s)}
                    >
                      {s === "All" ? "All stages" : s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {matches.length > 0 && shownMatches.length === 0 && (
              <div className="match-empty">
                <h4>
                  {matchQuery ? `No matches for “${searchMatch}”` : "No matches in this stage"}
                </h4>
                <p>Try another team name, or widen the stage filter.</p>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setSearchMatch("");
                    setStageFilter("All");
                  }}
                >
                  Clear search and filters
                </button>
              </div>
            )}

            {sections.map((section) => (
              <div key={section.key} className="match-section">
                <div className="match-section__head">
                  <h4>{section.title}</h4>
                  <span>
                    {section.sub && `${section.sub} · `}
                    {countLabel(section.rows.length)}
                  </span>
                </div>
                <ul className="match-list">
                  {section.rows.map((m) => {
                    const won = winner(m);
                    return (
                      <li key={m.id} className="match-row">
                        <span className="match-row__when">
                          <span className="match-row__date">{formatDate(m.match_date)}</span>
                          <span className="match-row__time">{m.kick_off?.slice(0, 5)}</span>
                        </span>
                        <span className="match-row__team match-row__team--home">
                          <span className={`match-row__name${won === "home" ? " is-winner" : ""}`}>
                            {m.home_team_name}
                          </span>
                          <span className="team-badge" aria-hidden="true">
                            {teamCode(m.home_team_name)}
                          </span>
                        </span>
                        <span className="match-row__score">
                          {m.home_team_score} – {m.away_team_score}
                        </span>
                        <span className="match-row__team match-row__team--away">
                          <span className="team-badge" aria-hidden="true">
                            {teamCode(m.away_team_name)}
                          </span>
                          <span className={`match-row__name${won === "away" ? " is-winner" : ""}`}>
                            {m.away_team_name}
                          </span>
                        </span>
                        <span className="match-row__tag">
                          {m.group_name && (
                            <span className="tag tag-neutral">Group {m.group_name}</span>
                          )}
                        </span>
                        <span className="match-row__chevron" aria-hidden="true">
                          <ChevronIcon direction="right" />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

/* Lucide icons at stroke-width 2.75, as the design system specifies */

function SearchIcon() {
  return (
    <svg
      className="search-field__icon"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function ChevronIcon({
  direction,
  size = 16,
}: {
  direction: "left" | "right";
  size?: number;
}) {
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
      <path d={direction === "right" ? "m9 18 6-6-6-6" : "m15 18-6-6 6-6"} />
    </svg>
  );
}

function AlertIcon({ size }: { size: number }) {
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
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

export default MatchSelection;
