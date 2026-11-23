"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { StatisticsPanel } from "./statistics-panel";

type Player = { player_id: string; username: string };
type DirectoryRow = { player_id: string; username?: string | null; email?: string | null };
type PlayerMatch = {
  id: string;
  decks: { legend: string; deck_type: string };
  opponent_legend: string;
  opponent_deck_type: string | null;
  played_at: string;
  won_die_roll: boolean;
  won_match: boolean;
};
type History = { page: number; matches: PlayerMatch[]; hasMore: boolean };

const pageSize = 50;
const dateFormat = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" });

export function AdminPanel({ client, showLegend, showDeckType }: {
  client: SupabaseClient;
  showLegend: (name: string) => string;
  showDeckType: (deck: PlayerMatch["decks"]) => string;
}) {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [search, setSearch] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [error, setError] = useState("");
  const [directoryAttempt, setDirectoryAttempt] = useState(0);
  const playerDetailsHeading = useRef<HTMLHeadingElement>(null);
  const searchPanel = useRef<HTMLDivElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const searchList = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!searchActive) return;

    function closeOnOutsidePress(event: PointerEvent) {
      if (event.target instanceof Node && !searchPanel.current?.contains(event.target)) {
        setSearchActive(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePress, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress, true);
  }, [searchActive]);

  useEffect(() => {
    const request = new AbortController();

    async function loadPlayers() {
      const directory: Player[] = [];

      try {
        while (!request.signal.aborted) {
          const { data, count, error: queryError } = await client.rpc(
            "admin_list_players", undefined, { count: "exact" },
          ).order("player_id").range(directory.length, directory.length + 199)
            .abortSignal(request.signal).overrideTypes<DirectoryRow[], { merge: false }>();
          if (request.signal.aborted) return;
          if (queryError) {
            if (queryError.code === "PGRST202") {
              setError("Falta habilitar el directorio de jugadores en Supabase.");
            } else if (queryError.code === "42501") {
              setError("Tu cuenta no tiene acceso al directorio de jugadores.");
            } else {
              setError("No se pudo cargar la lista de jugadores.");
            }
            return;
          }
          if (!Array.isArray(data)) throw new Error("La lista de jugadores no es válida.");
          directory.push(...data.map((player) => ({
            player_id: player.player_id,
            username: player.username?.trim() || player.email?.split("@")[0] ||
              `Jugador ${player.player_id.slice(0, 8)}`,
          })));
          if (data.length === 0 || (count !== null && directory.length >= count)) {
            setPlayers(directory.sort((first, second) => first.username.localeCompare(second.username, "es")));
            return;
          }
        }
      } catch {
        if (!request.signal.aborted) setError("No se pudo cargar la lista de jugadores.");
      }
    }

    void loadPlayers();
    return () => request.abort();
  }, [client, directoryAttempt]);

  const selectedPlayer = players?.find((player) => player.player_id === playerId);
  const showAll = playerId === "all";
  const query = search.trim().toLocaleLowerCase("es");
  const matchingPlayers = players?.filter((player) => player.username.toLocaleLowerCase("es").includes(query)) ?? [];

  function choosePlayer(id: string) {
    setPlayerId(id);
    setSearch("");
    setSearchActive(false);
    playerDetailsHeading.current?.focus({ preventScroll: true });
  }

  return (
    <div className="admin-panel">
      <section className="panel player-directory" aria-labelledby="players-title">
        <h2 id="players-title">Jugadores</h2>
        {error && (
          <>
            <p role="alert">{error}</p>
            <button type="button" className="secondary-button" onClick={() => {
              setError("");
              setDirectoryAttempt((attempt) => attempt + 1);
            }}>Reintentar</button>
          </>
        )}
        {!error && !players && <p role="status">Cargando jugadores…</p>}
        {players?.length === 0 && <p>No hay jugadores con el rol Zenith.</p>}
        {players && players.length > 0 && (
          <div className="player-directory-controls">
            <button type="button" className="secondary-button all-players-button"
              aria-pressed={showAll} onClick={() => choosePlayer("all")}>
              Todos los jugadores
            </button>
            <div className="player-search" ref={searchPanel} data-open={searchActive}
              onKeyDown={(event) => {
                if (event.key !== "Escape" || !searchActive) return;
                event.preventDefault();
                searchField.current?.focus();
                setSearchActive(false);
              }}>
              <div className="player-search-field">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <circle cx="10.5" cy="10.5" r="5.5" />
                  <path d="m15 15 4.5 4.5" />
                </svg>
                <input ref={searchField} type="search" aria-label="Buscar jugador" placeholder="Buscar jugador"
                  autoComplete="off" value={search}
                  onFocus={() => setSearchActive(true)} onClick={() => setSearchActive(true)}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setSearchActive(true);
                    if (searchList.current) searchList.current.scrollTop = 0;
                  }} />
              </div>
              {searchActive && (
                <div className="player-search-results">
                  {matchingPlayers.length > 0 ? (
                    <ul ref={searchList} className="player-list" aria-label="Jugadores disponibles">
                      {matchingPlayers.map((player) => (
                        <li key={player.player_id}>
                          <button type="button" className="secondary-button"
                            aria-pressed={playerId === player.player_id}
                            onClick={() => choosePlayer(player.player_id)}>
                            {player.username}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : <p role="status">Sin coincidencias.</p>}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
      <section className="panel player-history" aria-labelledby="player-history-title">
        <h2 id="player-history-title" ref={playerDetailsHeading} tabIndex={-1}>
          {showAll ? "Todos los jugadores" : selectedPlayer?.username ?? "Historial de partidas"}
        </h2>
        {showAll && players ? (
          <StatisticsPanel
            client={client}
            players={players}
            hidden={false}
            revision={0}
            emptyMessage="Los jugadores Zenith todavía no tienen partidas registradas."
            showLegend={showLegend}
            showDeckType={showDeckType}
          />
        ) : selectedPlayer ? (
          <PlayerDetails key={playerId} client={client} playerId={playerId}
            showLegend={showLegend} showDeckType={showDeckType} />
        ) : <p>Elige un jugador para consultar sus partidas.</p>}
      </section>
    </div>
  );
}

type PlayerDetailsProps = {
  client: SupabaseClient;
  playerId: string;
  showLegend: (name: string) => string;
  showDeckType: (deck: PlayerMatch["decks"]) => string;
};

function PlayerDetails({ client, playerId, showLegend, showDeckType }: PlayerDetailsProps) {
  const [view, setView] = useState<"history" | "matrix">("history");
  const [matrixOpened, setMatrixOpened] = useState(false);

  return (
    <>
      <nav className="dashboard-menu player-view-menu" aria-label="Datos del jugador">
        <button type="button" aria-pressed={view === "history"} onClick={() => setView("history")}>
          Historial
        </button>
        <button type="button" aria-pressed={view === "matrix"} onClick={() => {
          setMatrixOpened(true);
          setView("matrix");
        }}>
          Matriz
        </button>
      </nav>
      <div hidden={view !== "history"}>
        <PlayerHistory client={client} playerId={playerId} showLegend={showLegend} showDeckType={showDeckType} />
      </div>
      {matrixOpened && (
        <StatisticsPanel
          client={client}
          userId={playerId}
          hidden={view !== "matrix"}
          revision={0}
          emptyMessage="Este jugador todavía no tiene partidas registradas."
          showLegend={showLegend}
          showDeckType={showDeckType}
        />
      )}
    </>
  );
}

function PlayerHistory({ client, playerId, showLegend, showDeckType }: PlayerDetailsProps) {
  const [page, setPage] = useState(0);
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const request = new AbortController();

    async function loadPage() {
      try {
        const start = page * pageSize;
        const { data, error: queryError } = await client.from("matches")
          .select("id, opponent_legend, opponent_deck_type, played_at, won_die_roll, won_match, decks!inner(legend, deck_type)")
          .eq("user_id", playerId).order("played_at", { ascending: false }).order("id")
          .range(start, start + pageSize).abortSignal(request.signal)
          .overrideTypes<PlayerMatch[], { merge: false }>();
        if (queryError) throw queryError;
        if (!request.signal.aborted) {
          setHistory({ page, matches: data.slice(0, pageSize), hasMore: data.length > pageSize });
        }
      } catch {
        if (!request.signal.aborted) setError(true);
      }
    }

    void loadPage();
    return () => request.abort();
  }, [client, page, playerId]);

  function changePage(nextPage: number) {
    setError(false);
    setPage(nextPage);
  }

  if (error) return <p role="alert">No se pudo cargar el historial de este jugador.</p>;
  if (!history || history.page !== page) return <p role="status">Cargando historial…</p>;

  return (
    <>
      {history.matches.length === 0 ? <p>Este jugador no tiene partidas en esta página.</p> : (
        <ul className="match-list admin-history">
          {history.matches.map((match) => {
            const deckType = showDeckType(match.decks);

            return (
              <li key={match.id}>
                <div className="match-summary">
                  <strong>
                    {showLegend(match.decks.legend)}{deckType && ` · ${deckType}`}
                    {" contra "}{showLegend(match.opponent_legend)}
                    {match.opponent_deck_type && ` · ${match.opponent_deck_type}`}
                  </strong>
                  <div>
                    {match.won_match ? "Victoria" : "Derrota"} · {match.won_die_roll ? "Dado ganado" : "Dado perdido"}
                  </div>
                  <time dateTime={match.played_at}>{dateFormat.format(new Date(match.played_at))}</time>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {(page > 0 || history.hasMore) && (
        <div className="match-actions admin-pagination">
          <button type="button" className="secondary-button" disabled={page === 0}
            onClick={() => changePage(page - 1)}>Anterior</button>
          <button type="button" className="secondary-button" disabled={!history.hasMore}
            onClick={() => changePage(page + 1)}>Siguiente</button>
        </div>
      )}
    </>
  );
}
