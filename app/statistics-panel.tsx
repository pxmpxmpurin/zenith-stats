"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

type Deck = { legend: string; deck_type: string };
type StatisticsMatch = {
  id: string;
  decks: Deck;
  opponent_legend: string;
  won_die_roll: boolean;
  won_match: boolean;
};
type DieFilter = "all" | "won" | "lost";
type MatchRecord = { wins: number; total: number };
type MatrixRow = {
  legend: string;
  deckType: string;
  total: MatchRecord;
  cells: Map<string, MatchRecord>;
};

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

export function StatisticsPanel({ client, userId, hidden, revision, showLegend, showDeckType }: {
  client: SupabaseClient;
  userId: string;
  hidden: boolean;
  revision: number;
  showLegend: (name: string) => string;
  showDeckType: (deck: Deck) => string;
}) {
  const [matches, setMatches] = useState<StatisticsMatch[] | null>(null);
  const [filter, setFilter] = useState<DieFilter>("all");
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const request = new AbortController();

    async function loadMatches() {
      const history: StatisticsMatch[] = [];
      let lastId: string | undefined;
      let total: number | null = null;

      try {
        while (!request.signal.aborted) {
          const query = client.from("matches")
            .select(
              "id, opponent_legend, won_die_roll, won_match, decks!inner(legend, deck_type)",
              lastId ? undefined : { count: "exact" },
            )
            .eq("user_id", userId).order("id").limit(500);
          if (lastId) query.gt("id", lastId);

          const { data, count, error: queryError } = await query.abortSignal(request.signal)
            .overrideTypes<StatisticsMatch[], { merge: false }>();
          if (queryError) throw queryError;
          if (count !== null) total = count;
          history.push(...data);
          if (data.length === 0 || (total !== null && history.length >= total)) {
            if (!request.signal.aborted) {
              setMatches(history);
              setError(false);
            }
            return;
          }
          lastId = data[data.length - 1].id;
        }
      } catch {
        if (!request.signal.aborted) setError(true);
      }
    }

    void loadMatches();
    return () => request.abort();
  }, [client, userId, revision, attempt]);

  if (hidden) return null;

  const rows = new Map<string, MatrixRow>();
  const opponents = new Set<string>();

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
        <h2 id="statistics-title">Matriz de enfrentamientos</h2>
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
          <p role="alert">No se pudieron cargar tus estadísticas.</p>
          <button type="button" onClick={() => {
            setError(false);
            setAttempt((current) => current + 1);
          }}>Reintentar</button>
        </>
      ) : !matches ? (
        <p role="status">Cargando estadísticas…</p>
      ) : matches.length === 0 ? (
        <p>Registra una partida para ver tus enfrentamientos.</p>
      ) : (
        <>
          <p className="matrix-key" id="matrix-key">Porcentaje de victorias y victorias / partidas</p>
          <div className="matrix-scroll" role="region" aria-label="Matriz de enfrentamientos"
            aria-describedby="matrix-key" tabIndex={0}>
            <table className="match-matrix">
              <thead>
                <tr>
                  <th scope="col">Tu leyenda</th>
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
    </section>
  );
}
