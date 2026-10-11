/* The match clock as a horizontal axis, shared by the timeline and the xG race
   so both place every minute (stoppage time included) in the same spot.

   StatsBomb's clock keeps running through stoppage time and each period starts at
   a fixed minute, so minute 50 can be first-half stoppage time OR the 5th minute of
   the second half. To keep them apart, the axis is built from the periods actually
   played: each period gets a segment as long as it really lasted. */

import type { TimelinePeriod } from "../types/api";

const PERIOD_START: Record<number, number> = { 1: 0, 2: 45, 3: 90, 4: 105 };

export type Segment = { period: number; start: number; length: number; offset: number };

export type MatchAxis = {
  segments: Segment[];
  total: number; // minutes on the whole axis
  hasExtraTime: boolean;
};

/** Any event with a place on the clock. */
type Timed = { period: number; minute: number; second: number };

export function buildAxis(periods: TimelinePeriod[]): MatchAxis {
  let offset = 0;
  const segments = periods
    .filter((p) => p.period in PERIOD_START)
    .map((p) => {
      const start = PERIOD_START[p.period];
      const length = Math.max(p.end_minute - start + 1, 1); // +1 so the final minute fits
      const segment = { period: p.period, start, length, offset };
      offset += length;
      return segment;
    });
  return { segments, total: offset, hasExtraTime: segments.some((s) => s.period >= 3) };
}

/** Where an event goes on the axis: 0 = kick-off, 1 = final whistle (null if its period isn't on the axis). */
export function positionOf(event: Timed, axis: MatchAxis): number | null {
  const segment = axis.segments.find((s) => s.period === event.period);
  if (!segment) return null;
  const intoPeriod = Math.min(event.minute - segment.start + event.second / 60, segment.length);
  return (segment.offset + intoPeriod) / axis.total;
}

/** Where extra time starts on the axis (0..1), or null without extra time. */
export function extraTimeStart(axis: MatchAxis): number | null {
  const et = axis.segments.find((s) => s.period === 3);
  return et ? et.offset / axis.total : null;
}

/** Labels along the axis: kick-off, then the end of each period. */
export function axisMarks(axis: MatchAxis): { left: number; label: string }[] {
  return [
    { left: 0, label: "0'" },
    ...axis.segments.map((s) => ({
      left: (s.offset + s.length) / axis.total,
      label:
        s.period === 1 ? "HT" : s.period === 2 ? (axis.hasExtraTime ? "90'" : "FT") : s.period === 3 ? "105'" : "120'",
    })),
  ];
}

/** Positions (0..1) of the lines between periods. */
export function periodDividers(axis: MatchAxis): number[] {
  return axis.segments.slice(0, -1).map((s) => (s.offset + s.length) / axis.total);
}
