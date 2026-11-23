"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

type Deck = { legend: string; deck_type: string };
type StatisticsMatch = {
  id: string;
  user_id: string;
  decks: Deck;
  opponent_legend: string;
  won_die_roll: boolean;
  won_match: boolean;
};
type RankedPlayer = { player_id: string; username: string };
type DieFilter = "all" | "won" | "lost";
type MatchRecord = { wins: number; total: number };
type MatrixRow = {
  legend: string;
  deckType: string;
  total: MatchRecord;
  cells: Map<string, MatchRecord>;
};
type StatisticsScope =
  | { userId: string; players?: never }
  | { userId?: never; players: RankedPlayer[] };

const percent = new Intl.NumberFormat("es", { style: "percent", maximumFractionDigits: 1 });
const portraitBase = "https://ddragon.leagueoflegends.com/cdn/16.23.1/img/champion";
const portraitIds: Record<string, string> = {
  "K'Sante": "KSante",
  "Kai'Sa": "Kaisa",
  "Kha'Zix": "Khazix",
  LeBlanc: "Leblanc",
  "Renata Glasc": "Renata",
};

function Portrait({ champion }: { champion: string }) {
  const id = portraitIds[champion] ?? champion.replace(/[^a-z0-9]/gi, "");

  return (
    <span className="matrix-portrait" aria-hidden="true">
      {champion.slice(0, 2).toUpperCase()}
      {id && <img src={`${portraitBase}/${id}.png`} alt="" width={32} height={32}
        loading="lazy" onError={(event) => { event.currentTarget.hidden = true; }} />}
    </span>
  );
}

function LegendHeading({ legend, showTitle = false, deckType }: {
  legend: string;
  showTitle?: boolean;
  deckType?: string;
}) {
  const [champion, title] = legend.split(" · ");

  return (
    <div className="matrix-legend" title={legend}>
      <Portrait champion={champion} />
      <div>
        <span>{champion}</span>
        {title && (showTitle
          ? <small>{title}</small>
          : <span className="visually-hidden">, {title}</span>)}
        {deckType && <small>{deckType}</small>}
      </div>
    </div>
  );
}

function RecordCell({ record }: { record?: MatchRecord }) {
  if (!record?.total) {
    return <td className="matrix-empty"><span aria-hidden="true">—</span><span className="visually-hidden">Sin partidas</span></td>;
  }

  const rate = record.wins / record.total;
  const tone = rate > 0.5 ? "positive" : rate < 0.5 ? "negative" : "even";

  return (
    <td className="matrix-record" data-tone={tone} data-strong={rate >= 0.6 || rate <= 0.4}>
      <strong>{percent.format(rate)}</strong>
      <span>{record.wins}/{record.total}</span>
    </td>
  );
}

function PlayerRanking({ players, records }: {
  players: RankedPlayer[];
  records: Map<string, MatchRecord>;
}) {
  if (!players.length) return null;

  const ranking = players.map((player) => {
    const record = records.get(player.player_id) ?? { wins: 0, total: 0 };
    return { ...player, ...record, rate: record.total ? record.wins / record.total : null };
  }).sort((first, second) =>
    (second.rate ?? -1) - (first.rate ?? -1) || first.username.localeCompare(second.username, "es"),
  );
  const highest = ranking[0].rate;
  const lowest = ranking.findLast((player) => player.rate !== null)?.rate;
  let place = 0;

  return (
    <section className="player-ranking" aria-labelledby="player-ranking-title">
      <h3 id="player-ranking-title">Ranking de WR</h3>
      <table>
        <thead>
          <tr><th scope="col">Puesto</th><th scope="col">Jugador</th><th scope="col">WR</th></tr>
        </thead>
        <tbody>
          {ranking.map((player, index) => {
            if (player.rate !== ranking[index - 1]?.rate) place = index + 1;
            const top = player.rate !== null && player.rate === highest;
            const bottom = player.rate !== null && player.rate === lowest;
            const distinction = top && bottom ? "WR más alto y más bajo"
              : top ? "WR más alto" : bottom ? "WR más bajo" : "";

            return (
              <tr key={player.player_id}>
                <td>{player.rate === null ? "—" : place}</td>
                <th scope="row">
                  {player.username}
                  {distinction && <span className="ranking-highlight" data-extreme={top ? "high" : "low"}>
                    {distinction}
                  </span>}
                </th>
                <td>
                  {player.rate === null ? "Sin partidas" : (
                    <>
                      <strong>{percent.format(player.rate)}</strong>
                      <small>{player.wins}/{player.total}</small>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function StatisticsPanel({
  client, userId, players, hidden, revision, showLegend, showDeckType,
  emptyMessage = "Registra una partida para ver tus enfrentamientos.",
}: {
  client: SupabaseClient;
  hidden: boolean;
  revision: number;
  showLegend: (name: string) => string;
  showDeckType: (deck: Deck) => string;
  emptyMessage?: string;
} & StatisticsScope) {
  const [matches, setMatches] = useState<StatisticsMatch[] | null>(null);
  const [filter, setFilter] = useState<DieFilter>("all");
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const request = new AbortController();

    async function loadMatches() {
      const history: StatisticsMatch[] = [];
      const ids = players?.map((player) => player.player_id) ?? (userId ? [userId] : []);

      try {
        // Keep the list of UUIDs in each request short enough for the URL.
        for (let offset = 0; offset < ids.length && !request.signal.aborted; offset += 50) {
          const batch = ids.slice(offset, offset + 50);
          const start = history.length;
          let lastId: string | undefined;
          let total: number | null = null;

          while (!request.signal.aborted) {
            const query = client.from("matches")
              .select(
                "id, user_id, opponent_legend, won_die_roll, won_match, decks!inner(legend, deck_type)",
                lastId ? undefined : { count: "exact" },
              )
              .order("id").limit(500);
            if (batch.length === 1) query.eq("user_id", batch[0]);
            else query.in("user_id", batch);
            if (lastId) query.gt("id", lastId);

            const { data, count, error: queryError } = await query.abortSignal(request.signal)
              .overrideTypes<StatisticsMatch[], { merge: false }>();
            if (queryError) throw queryError;
            if (count !== null) total = count;
            history.push(...data);
            if (data.length === 0 || (total !== null && history.length - start >= total)) break;
            lastId = data[data.length - 1].id;
          }
        }
        if (!request.signal.aborted) {
          setMatches(history);
          setError(false);
        }
      } catch {
        if (!request.signal.aborted) setError(true);
      }
    }

    void loadMatches();
    return () => request.abort();
  }, [client, userId, players, revision, attempt]);

  if (hidden) return null;

  const rows = new Map<string, MatrixRow>();
  const opponents = new Set<string>();
  const playerRecords = new Map<string, MatchRecord>(
    players?.map((player) => [player.player_id, { wins: 0, total: 0 }]),
  );

  for (const match of matches ?? []) {
    const legend = showLegend(match.decks.legend);
    const deckType = showDeckType(match.decks);
    const opponent = showLegend(match.opponent_legend);
    const key = JSON.stringify([legend, deckType.trim().toLowerCase()]);
    let row = rows.get(key);
    if (!row) {
      row = { legend, deckType, total: { wins: 0, total: 0 }, cells: new Map() };
      rows.set(key, row);
    }
    opponents.add(opponent);

    if (filter !== "all" && match.won_die_roll !== (filter === "won")) continue;
    const playerRecord = playerRecords.get(match.user_id);
    if (playerRecord) {
      playerRecord.total += 1;
      playerRecord.wins += Number(match.won_match);
    }
    row.total.total += 1;
    const record = row.cells.get(opponent) ?? { wins: 0, total: 0 };
    record.total += 1;
    if (match.won_match) {
      record.wins += 1;
      row.total.wins += 1;
    }
    row.cells.set(opponent, record);
  }

  const columns = [...opponents].sort((a, b) => a.localeCompare(b, "es"));
  const columnCounts = new Map<string, number>();
  for (const legend of columns) {
    const champion = legend.split(" · ")[0];
    columnCounts.set(champion, (columnCounts.get(champion) ?? 0) + 1);
  }
  const sortedRows = [...rows].sort(([, a], [, b]) =>
    a.legend.localeCompare(b.legend, "es") || a.deckType.localeCompare(b.deckType, "es"),
  );

  return (
    <section className="panel statistics-panel" aria-labelledby="statistics-title">
      <div className="statistics-heading">
        <h2 id="statistics-title">{players ? "Matriz conjunta" : "Matriz de enfrentamientos"}</h2>
        {matches && matches.length > 0 && (
          <select aria-label="Filtro de dado" value={filter} onChange={(event) => setFilter(event.target.value as DieFilter)}>
            <option value="all">Dado · Todas</option>
            <option value="won">Dado · Ganado</option>
            <option value="lost">Dado · Perdido</option>
          </select>
        )}
      </div>
      {error ? (
        <>
          <p role="alert">No se pudieron cargar las estadísticas.</p>
          <button type="button" onClick={() => {
            setError(false);
            setAttempt((current) => current + 1);
          }}>Reintentar</button>
        </>
      ) : !matches ? (
        <p role="status">Cargando estadísticas…</p>
      ) : (
        <>
          {players && <PlayerRanking players={players} records={playerRecords} />}
          {matches.length === 0 ? <p>{emptyMessage}</p> : (
            <>
              <p className="matrix-key" id="matrix-key">Porcentaje de victorias y victorias / partidas</p>
              <div className="matrix-scroll" role="region" aria-label="Matriz de enfrentamientos"
                aria-describedby="matrix-key" tabIndex={0}>
                <table className="match-matrix">
                  <thead>
                    <tr>
                      <th scope="col">{players ? "Leyenda" : "Tu leyenda"}</th>
                      <th scope="col">Global</th>
                      {columns.map((opponent) => (
                        <th key={opponent} scope="col">
                          <LegendHeading legend={opponent} showTitle={(columnCounts.get(opponent.split(" · ")[0]) ?? 0) > 1} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map(([key, row]) => (
                      <tr key={key}>
                        <th scope="row">
                          <LegendHeading legend={row.legend} showTitle deckType={row.deckType} />
                        </th>
                        <RecordCell record={row.total} />
                        {columns.map((opponent) => <RecordCell key={opponent} record={row.cells.get(opponent)} />)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
