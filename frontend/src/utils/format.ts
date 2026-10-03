/* Formatting helpers shared by the match pages */

// "2022-11-20" -> "Sun 20 Nov". The "T00:00" makes it local midnight; without it the
// date is read as UTC and shows the previous day in North American time zones.
export function formatDate(isoDate: string) {
  return new Date(`${isoDate}T00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// Official FIFA codes. StatsBomb has no team codes, and guessing them from the name gives
// wrong (and sometimes offensive) results, so known teams are looked up here.
export const TEAM_CODES: Record<string, string> = {
  Argentina: "ARG",
  Australia: "AUS",
  Belgium: "BEL",
  Brazil: "BRA",
  Cameroon: "CMR",
  Canada: "CAN",
  "Costa Rica": "CRC",
  Croatia: "CRO",
  Denmark: "DEN",
  Ecuador: "ECU",
  England: "ENG",
  France: "FRA",
  Germany: "GER",
  Ghana: "GHA",
  Iran: "IRN",
  Japan: "JPN",
  Mexico: "MEX",
  Morocco: "MAR",
  Netherlands: "NED",
  Poland: "POL",
  Portugal: "POR",
  Qatar: "QAT",
  "Saudi Arabia": "KSA",
  Senegal: "SEN",
  Serbia: "SRB",
  "South Korea": "KOR",
  Spain: "ESP",
  Switzerland: "SUI",
  Tunisia: "TUN",
  "United States": "USA",
  Uruguay: "URU",
  Wales: "WAL",
};

// Unknown teams fall back to their words' first letters ("Real Madrid" -> "RM"),
// or the first two letters of a one-word name.
export function teamCode(teamName: string) {
  const known = TEAM_CODES[teamName];
  if (known) return known;
  const words = teamName.split(/\s+/).filter(Boolean);
  return words.length > 1
    ? words
        .map((w) => w[0])
        .join("")
        .slice(0, 3)
        .toUpperCase()
    : teamName.slice(0, 2).toUpperCase();
}

// "2022-12-18" -> "Sun 18 Dec 2022"
export function formatFullDate(isoDate: string) {
  return `${formatDate(isoDate)} ${isoDate.slice(0, 4)}`;
}
