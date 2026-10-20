import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { AttackPeriod, Channel, MatchAttackZones, MatchDetail, TeamAttackZones, Third } from "../types/api";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { teamCode } from "../utils/format";
import { FullPitch, type Side } from "../components/ShotMap";
import "./Attack.css";

/* Attack tab (prototype: "Attack"): where each team had the ball, and which channel they attacked down.
   GET /matches/{id}/possession returns, for the whole match and each period, every team's touches in
   9 zones plus its final-third entries and shots per channel, already counted, so switching team or
   period just picks another part of the response. */

type TeamMode = Side | "compare";

const PERIOD_LABELS: Record<AttackPeriod, string> = { all: "Full match", "1": "1st half", "2": "2nd half", et: "Extra time" };
// button order (Object.keys would put "1" and "2" first: JavaScript lists number-like keys before others)
const PERIOD_ORDER: AttackPeriod[] = ["all", "1", "2", "et"];
const THIRDS_TOP_DOWN: Third[] = ["attacking", "middle", "defensive"]; // upright pitch: attacking third at the top
const CHANNELS: Channel[] = ["left", "centre", "right"];
const THIRD_SHORT: Record<Third, string> = { attacking: "Att", middle: "Mid", defensive: "Def" };
const CHANNEL_LABEL: Record<Channel, string> = { left: "Left", centre: "Centre", right: "Right" };

const pctText = (part: number, whole: number) => `${whole ? Math.round((part / whole) * 100) : 0}%`;

/** How strongly a zone is shaded (0-100). Mid strengths jump to 50 or 72 so the number on top is
 *  always clearly dark-on-light or white-on-dark. */
function shade(count: number, max: number) {
  const a = Math.round(6 + (80 * count) / Math.max(1, max));
  return a >= 50 && a < 72 ? (a < 61 ? 50 : 72) : a;
}

/** One team's upright pitch: 3 × 3 shaded zones, third totals on the left, channel totals underneath. */
function ZonePitch({ data, side, teamName, compare, mobile }: { data: TeamAttackZones; side: Side; teamName: string; compare: boolean; mobile: boolean }) {
  const count = (third: Third, channel: Channel) => data.zones.find((z) => z.third === third && z.channel === channel)?.count ?? 0;
  const max = Math.max(1, ...data.zones.map((z) => z.count));
  const busiest = data.zones.reduce((best, z) => (z.count > best.count ? z : best), data.zones[0]);
  const thirdTotal = (third: Third) => data.zones.filter((z) => z.third === third).reduce((s, z) => s + z.count, 0);
  const channelTotal = (channel: Channel) => data.zones.filter((z) => z.channel === channel).reduce((s, z) => s + z.count, 0);

  return (
    <div className={`at-pitch at-team--${side}${compare ? " at-pitch--compare" : ""}`}>
      <div className="at-pitch__head">
        <span className="at-pitch__team">
          <span className="at-dot" aria-hidden="true" />
          {teamName}
        </span>
        <span className="at-pitch__sub">{data.total} touches</span>
      </div>

      <div className="at-pitch__grid">
        {/* Att / Mid / Def with each third's share */}
        <div className="at-rows">
          {THIRDS_TOP_DOWN.map((third) => (
            <div key={third} className="at-label at-label--row">
              <span className="at-label__name">{THIRD_SHORT[third]}</span>
              <span className="at-label__pct">{pctText(thirdTotal(third), data.total)}</span>
            </div>
          ))}
        </div>

        <div className="at-field">
          <svg className="at-field__marks" viewBox="0 0 80 120" aria-hidden="true">
            {/* the markings are drawn horizontally; turning them -90° stands the pitch up */}
            <g transform="translate(0 120) rotate(-90)">
              <FullPitch />
            </g>
          </svg>
          <div className="at-cells">
            {THIRDS_TOP_DOWN.flatMap((third) =>
              CHANNELS.map((channel) => {
                const n = count(third, channel);
                const a = shade(n, max);
                const top = busiest.count > 0 && busiest.third === third && busiest.channel === channel;
                const label = `${teamName}: ${third} third, ${channel} channel, ${pctText(n, data.total)} of touches${top ? " (busiest zone)" : ""}`;
                return (
                  <div
                    key={`${third}-${channel}`}
                    className={`at-cell${top ? " is-busiest" : ""}${a >= 72 ? " is-dark" : ""}`}
                    style={{ "--at-a": `${a}%` } as React.CSSProperties}
                    role="img"
                    aria-label={label}
                    title={label}
                  >
                    {pctText(n, data.total)}
                  </div>
                );
              }),
            )}
          </div>
        </div>

        <span />
        {/* Left / Centre / Right with each channel's share */}
        <div className="at-cols">
          {CHANNELS.map((channel) => (
            <div key={channel} className="at-label">
              <span className="at-label__name">{compare && mobile ? CHANNEL_LABEL[channel][0] : CHANNEL_LABEL[channel]}</span>
              <span className="at-label__pct">{pctText(channelTotal(channel), data.total)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** One stacked bar per team: the three parts in the team colour, strongest to lightest, with labels. */
function SplitBar({ side, parts }: { side: Side; parts: { label: string; pct: number }[] }) {
  return (
    <div className={`at-split at-team--${side}`}>
      <div className="at-split__bar" aria-hidden="true">
        {parts.map((p, i) => (
          <span key={p.label} className={`at-split__part at-split__part--${i}`} style={{ flexGrow: p.pct || 0.0001 }} />
        ))}
      </div>
      <div className="at-split__labels">
        {parts.map((p, i) => (
          <span key={p.label}>
            <span className={`at-split__key at-split__part--${i}`} aria-hidden="true" />
            {p.label} <strong>{Math.round(p.pct)}%</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

export function Attack() {
  const { match } = useOutletContext<{ match: MatchDetail }>();
  const [data, setData] = useState<MatchAttackZones | null>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<TeamMode>("home");
  const [period, setPeriod] = useState<AttackPeriod>("all");

  const wide = useMediaQuery("(min-width: 1080px)");
  const mobile = useMediaQuery("(max-width: 759px)");

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setFailed(false);
    fetch(`/api/matches/${match.id}/possession`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Failed to load attack zones (${response.status})`);
        setData(await response.json());
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [match.id]);

  if (failed) {
    return <p className="at-message">Couldn't load the attacking data.</p>;
  }
  if (!data) {
    return <span className="skeleton-bar" style={{ width: "100%", height: 520 }} aria-label="Loading attacking data" />;
  }

  const periods = PERIOD_ORDER.filter((p) => data[p]); // no "Extra time" button without extra time
  const current = data[period] ?? data.all!;
  const periodLabel = PERIOD_LABELS[period];
  const names: Record<Side, string> = { home: match.home_team.name, away: match.away_team.name };
  const compare = mode === "compare";
  const shown: Side[] = compare ? ["home", "away"] : [mode];
  const one = shown[0];

  /* ── attacking channels ── */
  const shotCaption = (side: Side, i: number) => {
    const c = current[side].channels[i];
    return `${c.shots} shot${c.shots === 1 ? "" : "s"} · ${c.xg.toFixed(2)} xG`;
  };
  const share = (side: Side, i: number) => {
    const d = current[side];
    return d.entries_total ? d.channels[i].entries / d.entries_total : 0;
  };
  // "Argentina went mostly down the left channel (42% of entries)"
  const lean = (side: Side) => {
    const d = current[side];
    if (!d.entries_total) return `${names[side]} made no final-third entries`;
    const i = d.channels.reduce((best, c, j) => (c.entries > d.channels[best].entries ? j : best), 0);
    return `${names[side]} went mostly down the ${CHANNELS[i]}${i === 1 ? "" : " channel"} (${pctText(d.channels[i].entries, d.entries_total)} of entries)`;
  };
  // territory: share of each team's touches in each third (defensive → attacking)
  const THIRDS_FORWARD: Third[] = ["defensive", "middle", "attacking"];
  const THIRD_NAME: Record<Third, string> = { defensive: "Defensive", middle: "Middle", attacking: "Attacking" };
  const territory = (side: Side) => {
    const d = current[side];
    return THIRDS_FORWARD.map((third) => ({
      label: THIRD_NAME[third],
      pct: d.total ? (d.zones.filter((z) => z.third === third).reduce((sum, z) => sum + z.count, 0) / d.total) * 100 : 0,
    }));
  };

  const insight = compare ? `${lean("home")}; ${lean("away")}.` : `${lean(one)}.`;
  const maxShare = Math.max(0.01, ...CHANNELS.map((_, i) => share(one, i)));

  return (
    <div className="at-page">
      <div className="at-controls">
        <div className="seg" role="radiogroup" aria-label="Team">
          {(
            [
              ["home", names.home],
              ["away", names.away],
              ["compare", "Compare"],
            ] as [TeamMode, string][]
          ).map(([value, label]) => (
            <label key={value} className="seg-opt">
              <input type="radio" name="at-team" checked={mode === value} onChange={() => setMode(value)} />
              {label}
            </label>
          ))}
        </div>
        <div className="at-scroll">
          <div className="seg" role="radiogroup" aria-label="Period">
            {periods.map((p) => (
              <label key={p} className="seg-opt at-nowrap">
                <input type="radio" name="at-period" checked={period === p} onChange={() => setPeriod(p)} />
                {PERIOD_LABELS[p]}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className={`at-cards${wide && !compare ? " at-cards--two" : ""}`}>
        <section className="overview-card at-card" aria-labelledby="at-zones-title">
          <div className="at-head">
            <h3 id="at-zones-title">Where they had the ball</h3>
            <span className="at-sub">
              Share of {compare ? "each team's" : `${names[one]}'s`} touches in each zone · {periodLabel}
            </span>
          </div>

          <div className={`at-pitches${compare ? " at-pitches--compare" : ""}`}>
            {shown.map((side) => (
              <ZonePitch key={side} data={current[side]} side={side} teamName={names[side]} compare={compare} mobile={mobile} />
            ))}
          </div>

          <div className="at-legend">
            <strong>{compare ? "Both teams attacking ↑" : "Attacking ↑"}</strong>
            <span>
              Less
              <span className="at-legend__ramp" aria-hidden="true" />
              More of the ball
            </span>
            <span>
              <span className="at-legend__busiest" aria-hidden="true" />
              Busiest zone
            </span>
          </div>
        </section>

        {/* one team: channels and territory stacked beside the pitch; compare: side by side under the pitches */}
        <div className={`at-side${wide && compare ? " at-side--row" : ""}`}>
        <section className="overview-card at-card" aria-labelledby="at-channels-title">
          <div className="at-head">
            <h3 id="at-channels-title">Attacking channels</h3>
            <span className="at-insight">{insight}</span>
            <span className="at-sub">
              {compare
                ? `Final-third entries · ${names.home} ${current.home.entries_total}, ${names.away} ${current.away.entries_total} · ${periodLabel}`
                : `${current[one].entries_total} final-third entries · ${periodLabel}`}
            </span>
          </div>

          {!compare ? (
            <div className={`at-channels at-team--${one}`}>
              {CHANNELS.map((channel, i) => (
                <div key={channel} className="at-channel">
                  <div className="at-channel__row">
                    <span className="at-channel__name">{CHANNEL_LABEL[channel]}</span>
                    <span className="at-channel__track">
                      <span style={{ width: `${(share(one, i) / maxShare) * 100}%` }} />
                    </span>
                    <span className="at-channel__pct">{Math.round(share(one, i) * 100)}%</span>
                  </div>
                  <span className="at-channel__cap">
                    {current[one].channels[i].entries} entries · {shotCaption(one, i)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="at-compare">
              <div className="at-compare__head">
                <span className="at-team--home">
                  <span className="at-dot" aria-hidden="true" />
                  {teamCode(names.home)}
                </span>
                <span className="at-compare__mid">Share of each team's final-third entries</span>
                <span className="at-team--away">
                  {teamCode(names.away)}
                  <span className="at-dot" aria-hidden="true" />
                </span>
              </div>
              {CHANNELS.map((channel, i) => {
                const h = Math.round(share("home", i) * 100);
                const a = Math.round(share("away", i) * 100);
                const lead = h === a ? null : h > a ? "home" : "away";
                return (
                  <div key={channel} className="at-compare__item">
                    <div className="at-compare__row">
                      <span className={`at-pill at-team--home${lead === "home" ? " is-lead" : ""}`}>{h}%</span>
                      <span className="at-compare__name">{CHANNEL_LABEL[channel]}</span>
                      <span className={`at-pill at-pill--end at-team--away${lead === "away" ? " is-lead" : ""}`}>{a}%</span>
                    </div>
                    <div className="at-compare__bars" aria-hidden="true">
                      <span className={`at-bar--home${lead === "away" ? " is-behind" : ""}`} style={{ flexGrow: Math.max(h, 0.1) }} />
                      <span className={`at-bar--away${lead === "home" ? " is-behind" : ""}`} style={{ flexGrow: Math.max(a, 0.1) }} />
                    </div>
                    <div className="at-compare__caps">
                      <span>
                        {current.home.channels[i].entries} entries · {shotCaption("home", i)}
                      </span>
                      <span>
                        {current.away.channels[i].entries} entries · {shotCaption("away", i)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="overview-card at-card" aria-labelledby="at-territory-title">
          <div className="at-head">
            <h3 id="at-territory-title">Territory</h3>
            <span className="at-sub">
              Share of {compare ? "each team's" : `${names[one]}'s`} touches in each third · {periodLabel}
            </span>
          </div>
          {shown.map((side) => (
            <div key={side} className="at-territory">
              {compare && (
                <span className="at-territory__team">
                  <span className={`at-dot at-team--${side}`} aria-hidden="true" />
                  {names[side]}
                </span>
              )}
              <SplitBar side={side} parts={territory(side)} />
            </div>
          ))}
        </section>
        </div>
      </div>

      <p className="at-note">
        Left and right are from the attacking team's point of view. A final-third entry is a completed pass from outside the final third into
        it.
      </p>
    </div>
  );
}

export default Attack;
