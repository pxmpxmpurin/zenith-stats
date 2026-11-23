"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AdminPanel } from "./admin-panel";
import { DeveloperPanel, type CatalogLegend } from "./developer-panel";
import { expansions, formatMatchDate, matchDay, matchExpansion } from "./expansions";
import { StatisticsPanel } from "./statistics-panel";

type Deck = { id: string; legend: string; deck_type: string };
type Legend = CatalogLegend;
type Match = {
  id: string;
  deck_id: string;
  opponent_legend: string;
  opponent_deck_type: string | null;
  won_die_roll: boolean;
  won_match: boolean;
  played_at: string;
  expansion_override: string | null;
};

const matchPageSize = 50;
const matchColumns = "id, deck_id, opponent_legend, opponent_deck_type, won_die_roll, won_match, played_at, expansion_override";
const deckColumns = "id, legend, deck_type";
const unspecifiedDeckType = "Sin especificar";
const dashboardViews = {
  matches: "Partidas",
  statistics: "Estadísticas",
  players: "Jugadores",
  developer: "Desarrollo",
};
type DashboardView = keyof typeof dashboardViews;

function compareMatches(a: Match, b: Match) {
  return Date.parse(b.played_at) - Date.parse(a.played_at)
    || b.played_at.localeCompare(a.played_at)
    || a.id.localeCompare(b.id);
}

function updateVisibleMatch(current: Match[], saved: Match, hasMore: boolean) {
  const remaining = current.filter((match) => match.id !== saved.id);
  const lastVisible = current.at(-1);
  if (hasMore && (!lastVisible || compareMatches(saved, lastVisible) > 0)) return remaining;
  return [...remaining, saved].sort(compareMatches);
}

function matchPageQuery(client: SupabaseClient, userId: string, after?: Match) {
  const query = client.from("matches").select(matchColumns).eq("user_id", userId)
    .order("played_at", { ascending: false }).order("id").limit(matchPageSize + 1);
  if (after) {
    query.or(`played_at.lt.${after.played_at},and(played_at.eq.${after.played_at},id.gt.${after.id})`);
  }
  return query;
}

function normalizeName(name: string) {
  return name.trim().toLowerCase();
}

function capitalizeInitial(value: string) {
  return value.trim().replace(/^./u, (firstLetter) => firstLetter.toUpperCase());
}

function formatLegend(legend: string) {
  return capitalizeInitial(legend.toLowerCase());
}

function catalogName(legends: Legend[], storedName: string) {
  const key = normalizeName(storedName);
  const exact = legends.find((legend) => normalizeName(legend.name) === key);
  if (exact) return exact.name;

  const aliases = legends.filter((legend) =>
    normalizeName(legend.champion) === key || normalizeName(legend.title) === key,
  );
  return aliases.length === 1 ? aliases[0].name : "";
}

function visibleDeckType(deck?: Pick<Deck, "deck_type">) {
  if (!deck || normalizeName(deck.deck_type) === normalizeName(unspecifiedDeckType)) return "";
  return capitalizeInitial(deck.deck_type);
}

export function MatchPanel({ client, userId, accountMenu, onUsernameChanged }: {
  client: SupabaseClient;
  userId: string;
  accountMenu: ReactNode;
  onUsernameChanged: (username: string) => void;
}) {
  const [view, setView] = useState<DashboardView>("matches");
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [developer, setDeveloper] = useState<{ is_owner: boolean } | null>(null);
  const [statisticsOpened, setStatisticsOpened] = useState(false);
  const [statisticsRevision, setStatisticsRevision] = useState(0);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [legends, setLegends] = useState<Legend[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [hasMoreMatches, setHasMoreMatches] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [entry, setEntry] = useState({ version: 0, legend: "" });
  const [editingMatch, setEditingMatch] = useState<Match | null>(null);
  const [matchToDelete, setMatchToDelete] = useState<Match | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const editDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const editHeading = useRef<HTMLHeadingElement>(null);
  const dashboardNav = useRef<HTMLElement>(null);
  const dashboardToggle = useRef<HTMLButtonElement>(null);
  const pendingMatch = useRef<{ id: string; fields: string } | null>(null);
  const saveInProgress = useRef(false);
  const editingDeck = decks.find((deck) => deck.id === editingMatch?.deck_id);

  useEffect(() => {
    if (!menuOpen) return;

    function closeOnOutsidePress(event: PointerEvent) {
      if (event.target instanceof Node && !dashboardNav.current?.contains(event.target)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePress, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress, true);
  }, [menuOpen]);

  useEffect(() => {
    const request = new AbortController();

    async function checkRoles() {
      const [admin, developerRole] = await Promise.all([
        client.from("app_admins").select("user_id").eq("user_id", userId)
          .abortSignal(request.signal).maybeSingle(),
        client.from("app_developers").select("is_owner").eq("user_id", userId)
          .abortSignal(request.signal).maybeSingle(),
      ]);
      if (request.signal.aborted) return;
      setIsAdmin(!admin.error && admin.data?.user_id === userId);
      setDeveloper(developerRole.error ? null : developerRole.data);
    }

    void checkRoles();
    return () => request.abort();
  }, [client, userId]);

  useEffect(() => {
    const request = new AbortController();

    async function load() {
      try {
        const [deckResult, matchResult, legendResult] = await Promise.all([
          client.from("decks").select(deckColumns).eq("user_id", userId)
            .order("legend").order("deck_type").abortSignal(request.signal),
          matchPageQuery(client, userId).abortSignal(request.signal),
          client.from("legends").select("name, champion, title")
            .order("champion").order("title").abortSignal(request.signal),
        ]);
        if (request.signal.aborted) return;
        if (deckResult.error || matchResult.error || legendResult.error) throw new Error("No se pudieron cargar los datos.");
        setDecks(deckResult.data);
        setMatches(matchResult.data.slice(0, matchPageSize));
        setHasMoreMatches(matchResult.data.length > matchPageSize);
        setLegends(legendResult.data);
      } catch {
        if (!request.signal.aborted) setLoadError(true);
      } finally {
        if (!request.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => request.abort();
  }, [client, userId]);

  useEffect(() => {
    const dialog = editDialog.current;
    if (editingMatch && dialog && !dialog.open) {
      dialog.showModal();
      editHeading.current?.focus();
    } else if (!editingMatch && dialog?.open) {
      dialog.close();
    }
  }, [editingMatch]);

  useEffect(() => {
    const dialog = deleteDialog.current;
    if (matchToDelete && dialog && !dialog.open) dialog.showModal();
    if (!matchToDelete && dialog?.open) dialog.close();
  }, [matchToDelete]);

  function editMatch(match: Match | null) {
    setEditingMatch(match);
    setError("");
    setNotice("");
  }

  async function loadMoreMatches() {
    if (!hasMoreMatches || saveInProgress.current) return;
    saveInProgress.current = true;
    setLoadingMore(true);
    setLoadMoreError(false);

    try {
      const { data, error } = await matchPageQuery(client, userId, matches.at(-1));
      if (error) throw error;

      const nextPage = data.slice(0, matchPageSize);
      setMatches((current) => {
        const byId = new Map([...current, ...nextPage].map((match) => [match.id, match]));
        return [...byId.values()].sort(compareMatches);
      });
      setHasMoreMatches(data.length > matchPageSize);
    } catch {
      setLoadMoreError(true);
    } finally {
      saveInProgress.current = false;
      setLoadingMore(false);
    }
  }

  async function deleteMatch() {
    if (!matchToDelete || saveInProgress.current) return;
    saveInProgress.current = true;
    setDeleting(true);
    setDeleteError("");

    try {
      const { data, error } = await client.from("matches").delete()
        .eq("user_id", userId).eq("id", matchToDelete.id).select("id").maybeSingle();
      if (error || !data) {
        setDeleteError("No se pudo borrar la partida. Inténtalo de nuevo.");
        return;
      }

      setMatches((current) => current.filter((match) => match.id !== data.id));
      setStatisticsRevision((revision) => revision + 1);
      setMatchToDelete(null);
      setNotice("Partida borrada.");
    } catch {
      setDeleteError("No se pudo borrar la partida. Inténtalo de nuevo.");
    } finally {
      saveInProgress.current = false;
      setDeleting(false);
    }
  }

  async function saveMatch(event: FormEvent<HTMLFormElement>, editingMatch: Match | null) {
    event.preventDefault();
    if (saveInProgress.current) return;

    const fields = new FormData(event.currentTarget);
    const opponentLegend = String(fields.get("opponentLegend") ?? "");
    const opponentDeckType = capitalizeInitial(String(fields.get("opponentDeckType") ?? ""));
    const legend = String(fields.get("legend") ?? "");
    const deckType = capitalizeInitial(String(fields.get("deckType") ?? "")) || unspecifiedDeckType;
    const dieRoll = fields.get("dieRoll");
    const result = fields.get("result");
    const date = String(fields.get("playedOn") ?? "");
    const override = String(fields.get("expansion") ?? "");
    const today = matchDay();
    const dateStart = Date.parse(`${date}T00:00:00.000Z`);

    setNotice("");
    setError("");
    if (!legends.some((item) => item.name === legend) ||
        !legends.some((item) => item.name === opponentLegend)) {
      setError("Selecciona ambas leyendas de la lista.");
      return;
    }
    if ((dieRoll !== "won" && dieRoll !== "lost") ||
        (result !== "won" && result !== "lost")) {
      setError("Completa los campos obligatorios.");
      return;
    }
    if (!Number.isFinite(dateStart) || matchDay(new Date(dateStart).toISOString()) !== date || date > today) {
      setError("Elige la fecha de la partida. Debe ser hoy o un día anterior.");
      return;
    }
    if (override && !expansions.some((item) => item.name === override)) {
      setError("Elige una expansión de la lista.");
      return;
    }
    const dateChanged = editingMatch ? matchDay(editingMatch.played_at) !== date : date !== today;

    saveInProgress.current = true;
    setSaving(true);

    try {
      const matchesDeck = (deck: Deck) => (
        deck.legend === legend &&
        normalizeName(deck.deck_type) === normalizeName(deckType)
      );
      let selectedDeck = decks.find(matchesDeck);
      if (!selectedDeck) {
        const { data: savedDeck, error: deckError } = await client.from("decks")
          .insert({ user_id: userId, legend, deck_type: deckType })
          .select(deckColumns).single();
        if (deckError?.code === "23505") {
          const { data: currentDecks, error: refreshError } = await client.from("decks")
            .select(deckColumns).eq("user_id", userId).order("legend").order("deck_type");
          if (refreshError) throw refreshError;
          setDecks(currentDecks);
          selectedDeck = currentDecks.find(matchesDeck);
        } else if (deckError) {
          throw deckError;
        } else {
          selectedDeck = savedDeck;
          setDecks((current) => [...current, savedDeck]);
        }
      }
      if (!selectedDeck) throw new Error("No se pudo recuperar la leyenda.");

      const match = {
        deck_id: selectedDeck.id,
        opponent_legend: opponentLegend,
        opponent_deck_type: opponentDeckType || null,
        won_die_roll: dieRoll === "won",
        won_match: result === "won",
        expansion_override: override || null,
        ...(dateChanged ? { played_at: new Date(dateStart).toISOString() } : {}),
      };

      if (editingMatch) {
        const { data: updatedMatch, error: updateError } = await client.from("matches")
          .update(match).eq("user_id", userId).eq("id", editingMatch.id)
          .select(matchColumns).single();
        if (updateError) throw updateError;
        setMatches((current) => updateVisibleMatch(current, updatedMatch, hasMoreMatches));
        setStatisticsRevision((revision) => revision + 1);
        editMatch(null);
        setNotice("Cambios guardados.");
        return;
      }

      const signature = JSON.stringify({ ...match, played_at: date });
      if (pendingMatch.current?.fields !== signature) {
        pendingMatch.current = { id: crypto.randomUUID(), fields: signature };
      }
      const id = pendingMatch.current.id;
      const { data: insertedMatch, error: matchError } = await client.from("matches")
        .insert({ id, user_id: userId, ...match }).select(matchColumns).single();

      let savedMatch = insertedMatch;
      if (matchError?.code === "23505") {
        const { data, error: retryError } = await client.from("matches")
          .select(matchColumns).eq("user_id", userId).eq("id", id).single();
        if (retryError) throw retryError;
        savedMatch = data;
      } else if (matchError) {
        throw matchError;
      }
      if (!savedMatch) throw new Error("No se pudo confirmar la partida.");

      pendingMatch.current = null;
      setMatches((current) => updateVisibleMatch(current, savedMatch, hasMoreMatches));
      setStatisticsRevision((revision) => revision + 1);
      setEntry((current) => ({ version: current.version + 1, legend }));
      setNotice("Partida guardada.");
    } catch {
      setError("No se pudo guardar la partida. Inténtalo de nuevo.");
    } finally {
      saveInProgress.current = false;
      setSaving(false);
    }
  }

  function showLegend(name: string) {
    return catalogName(legends, name) || formatLegend(name);
  }

  function selectView(nextView: DashboardView) {
    if (nextView === "statistics") setStatisticsOpened(true);
    setView(nextView);
    if (menuOpen) {
      setMenuOpen(false);
      dashboardToggle.current?.focus();
    }
  }

  return (
    <div>
      <div className="dashboard-bar">
        <nav className="dashboard-nav" ref={dashboardNav} aria-label="Vistas de Zenith Stats"
          onKeyDown={(event) => {
            if (event.key === "Escape" && menuOpen) {
              event.preventDefault();
              setMenuOpen(false);
              dashboardToggle.current?.focus();
            }
          }}>
          <button
            ref={dashboardToggle}
            className="secondary-button dashboard-menu-toggle"
            type="button"
            aria-label={`Menú principal, vista actual: ${dashboardViews[view]}`}
            aria-controls="dashboard-views"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
            {dashboardViews[view]}
          </button>
          <div id="dashboard-views" className="dashboard-menu dashboard-views" data-open={menuOpen}>
            <button type="button" aria-pressed={view === "matches"} onClick={() => selectView("matches")}>
              Partidas
            </button>
            <button type="button" aria-pressed={view === "statistics"} onClick={() => selectView("statistics")}>
              Estadísticas
            </button>
            {isAdmin && (
              <button type="button" aria-pressed={view === "players"} onClick={() => selectView("players")}>
                Jugadores
              </button>
            )}
            {developer && (
              <button type="button" aria-pressed={view === "developer"} onClick={() => selectView("developer")}>
                Desarrollo
              </button>
            )}
          </div>
        </nav>
        {accountMenu}
      </div>
      {loading && <p role="status">Cargando partidas…</p>}
      {loadError && <p role="alert">No se pudieron cargar tus datos. Recarga la página para reintentar.</p>}
      <div className="match-panel" hidden={loading || loadError || view !== "matches"}>
        <section className="panel match-entry" aria-labelledby="match-entry-title">
          <h2 id="match-entry-title">Registrar partida</h2>
          <MatchForm key={entry.version} legends={legends} initialLegend={entry.legend}
            saving={saving} disabled={loadingMore} error={editingMatch ? "" : error}
            onSave={(event) => void saveMatch(event, null)} />
          <p role="status" hidden={notice !== "Partida guardada."}>{notice}</p>
        </section>

        <section className="panel match-history" aria-labelledby="match-history-title">
          <h2 id="match-history-title">Mis partidas</h2>
          {matches.length === 0 && !hasMoreMatches && <p>Aún no has registrado partidas.</p>}
          {matches.length > 0 && (
            <ul className="match-list">
              {matches.map((match) => {
                const deck = decks.find((item) => item.id === match.deck_id);
                const deckType = visibleDeckType(deck);
                const expansion = matchExpansion(match.played_at, match.expansion_override);

                return (
                  <li key={match.id}>
                    <div className="match-summary">
                      <strong>
                        {deck ? showLegend(deck.legend) : "Tu leyenda"}
                        {deckType && ` · ${deckType}`}
                        {" contra "}{showLegend(match.opponent_legend)}
                        {match.opponent_deck_type && ` · ${capitalizeInitial(match.opponent_deck_type)}`}
                      </strong>
                      <div>
                        {match.won_match ? "Victoria" : "Derrota"} · {match.won_die_roll ? "Ganaste el dado" : "Perdiste el dado"}
                      </div>
                      <div className="match-date">
                        <time dateTime={match.played_at}>{formatMatchDate(match.played_at)}</time>
                        {expansion && <span>{expansion}</span>}
                      </div>
                    </div>
                    <div className="match-row-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={saving || deleting || loadingMore}
                        aria-haspopup="dialog"
                        onClick={(event) => {
                          event.currentTarget.focus();
                          editMatch(match);
                        }}
                      >
                        Editar
                      </button>
                      <button
                        className="secondary-button match-delete-button"
                        type="button"
                        disabled={saving || deleting || loadingMore}
                        aria-label={`Borrar partida contra ${showLegend(match.opponent_legend)}`}
                        title="Borrar partida"
                        aria-haspopup="dialog"
                        onClick={(event) => {
                          event.currentTarget.focus();
                          setNotice("");
                          setDeleteError("");
                          setMatchToDelete(match);
                        }}
                      >
                        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24"
                          fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
                        </svg>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {hasMoreMatches && (
            <div className="match-history-more">
              <button type="button" className="secondary-button" disabled={loadingMore || saving || deleting}
                onClick={() => void loadMoreMatches()}>
                {loadingMore ? "Cargando…" : "Cargar más"}
              </button>
              {loadMoreError && <p role="alert">No se pudieron cargar más partidas. Inténtalo de nuevo.</p>}
            </div>
          )}
          <p role="status" hidden={notice !== "Cambios guardados." && notice !== "Partida borrada."}>{notice}</p>
        </section>

        <dialog
          ref={editDialog}
          className="panel match-dialog"
          aria-labelledby="match-edit-title"
          onCancel={(event) => {
            event.preventDefault();
            if (!saveInProgress.current) editMatch(null);
          }}
        >
          <h2 id="match-edit-title" ref={editHeading} tabIndex={-1}>Editar partida</h2>
          {editingMatch && (
            <MatchForm
              key={editingMatch.id}
              legends={legends}
              initialLegend={editingDeck?.legend}
              editingMatch={editingMatch}
              editingDeck={editingDeck}
              saving={saving}
              error={error}
              onSave={(event) => void saveMatch(event, editingMatch)}
              onCancel={() => editMatch(null)}
            />
          )}
        </dialog>
        <dialog
          ref={deleteDialog}
          className="panel match-dialog match-delete-dialog"
          aria-labelledby="match-delete-title"
          aria-describedby="match-delete-description"
          onCancel={(event) => {
            event.preventDefault();
            if (!saveInProgress.current) setMatchToDelete(null);
          }}
        >
          {matchToDelete && (
            <>
              <h2 id="match-delete-title">¿Borrar partida?</h2>
              <p id="match-delete-description">
                Se borrará la partida contra <strong>{showLegend(matchToDelete.opponent_legend)}</strong> del{" "}
                {formatMatchDate(matchToDelete.played_at)}.
              </p>
              <div className="match-actions">
                <button type="button" className="secondary-button" disabled={deleting}
                  onClick={() => setMatchToDelete(null)} autoFocus>Cancelar</button>
                <button type="button" className="match-delete-confirm" disabled={deleting}
                  onClick={() => void deleteMatch()}>
                  {deleting ? "Borrando…" : "Borrar partida"}
                </button>
              </div>
              {deleteError && <p role="alert">{deleteError}</p>}
            </>
          )}
        </dialog>
      </div>
      {!loading && !loadError && statisticsOpened && (
        <StatisticsPanel
          client={client}
          userId={userId}
          hidden={view !== "statistics"}
          revision={statisticsRevision}
          showLegend={showLegend}
          showDeckType={visibleDeckType}
        />
      )}
      {!loading && !loadError && isAdmin && view === "players" && (
        <AdminPanel client={client} showLegend={showLegend} showDeckType={visibleDeckType} />
      )}
      {!loading && developer && view === "developer" && (
        <DeveloperPanel
          client={client}
          isOwner={developer.is_owner}
          onLegendsAdded={(added) => setLegends((current) => {
            const byName = new Map([...current, ...added].map((legend) => [legend.name, legend]));
            return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
          })}
          onUsernameChanged={(target, username) => {
            if (target === userId) onUsernameChanged(username);
          }}
          onRoleChanged={(target, role, enabled) => {
            if (target === userId && role === "administrator") setIsAdmin(enabled);
          }}
        />
      )}
    </div>
  );
}

function LegendPicker({ name, label, legends, initialValue = "" }: {
  name: string;
  label: string;
  legends: Legend[];
  initialValue?: string;
}) {
  const [selected, setSelected] = useState(() => catalogName(legends, initialValue));
  const [query, setQuery] = useState(selected || formatLegend(initialValue));
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const firstOption = useRef<HTMLButtonElement>(null);
  const search = normalizeName(query);
  const suggestions = legends.filter((legend) =>
    normalizeName(legend.name).includes(search) ||
    normalizeName(`${legend.champion} ${legend.title}`).includes(search),
  ).slice(0, 3);

  function selectLegend(legend: Legend) {
    setSelected(legend.name);
    setQuery(legend.name);
    input.current?.focus();
    setOpen(false);
  }

  return (
    <div
      className="legend-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          input.current?.focus();
          setOpen(false);
        }
      }}
    >
      <label>
        {label}
        <input
          ref={input}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected("");
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (open) firstOption.current?.focus();
              else setOpen(true);
            }
            if (event.key === "Enter" && open && suggestions.length > 0) {
              event.preventDefault();
              selectLegend(suggestions[0]);
            }
          }}
          placeholder="Busca por campeón o leyenda"
          autoComplete="off"
          required
        />
      </label>
      <input type="hidden" name={name} value={selected} />
      {open && (
        <ul className="legend-suggestions" aria-label={label}>
          {suggestions.length === 0 && <li className="legend-empty">Sin coincidencias</li>}
          {suggestions.map((legend, index) => (
            <li key={legend.name}>
              <button
                ref={index === 0 ? firstOption : undefined}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectLegend(legend)}
              >
                {legend.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MatchForm({
  legends, initialLegend = "", editingMatch, editingDeck, saving, disabled, error, onSave, onCancel,
}: {
  legends: Legend[];
  initialLegend?: string;
  editingMatch?: Match;
  editingDeck?: Deck;
  saving: boolean;
  disabled?: boolean;
  error: string;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onCancel?: () => void;
}) {
  const [date, setDate] = useState(() => editingMatch ? matchDay(editingMatch.played_at) : matchDay());
  const automaticExpansion = matchExpansion(date);

  return (
    <>
      <form onSubmit={onSave}>
        <fieldset disabled={saving || disabled}>
          <LegendPicker name="legend" label="Tu leyenda" legends={legends} initialValue={initialLegend} />
          <label>
            Tu tipo de mazo (opcional)
            <input
              name="deckType"
              defaultValue={visibleDeckType(editingDeck)}
              onBlur={(event) => {
                event.currentTarget.value = capitalizeInitial(event.currentTarget.value);
              }}
            />
          </label>
          <LegendPicker name="opponentLegend" label="Leyenda rival" legends={legends}
            initialValue={editingMatch?.opponent_legend} />
          <label>
            Tipo de mazo rival (opcional)
            <input
              name="opponentDeckType"
              defaultValue={capitalizeInitial(editingMatch?.opponent_deck_type ?? "")}
              onBlur={(event) => {
                event.currentTarget.value = capitalizeInitial(event.currentTarget.value);
              }}
            />
          </label>
          <div className="match-scheduling">
            <label>
              Fecha de la partida
              <input type="date" name="playedOn" value={date} max={matchDay()}
                onChange={(event) => setDate(event.target.value)} required />
            </label>
            <label>
              Expansión
              <select name="expansion" defaultValue={editingMatch?.expansion_override ?? ""}>
                <option value="">{automaticExpansion ? `Automática · ${automaticExpansion}` : "Automática"}</option>
                {expansions.map(({ name }) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          </div>
          <div className="match-outcomes">
            <fieldset>
              <legend>Tirada de dado</legend>
              <div className="result-options">
                <label>
                  <input type="radio" name="dieRoll" value="lost" aria-label="Perdí el dado"
                    defaultChecked={editingMatch?.won_die_roll === false} required />
                  <span aria-hidden="true">⚄ ×</span>
                </label>
                <label>
                  <input type="radio" name="dieRoll" value="won" aria-label="Gané el dado"
                    defaultChecked={editingMatch?.won_die_roll === true} required />
                  <span aria-hidden="true">⚄ ✓</span>
                </label>
              </div>
            </fieldset>
            <fieldset>
              <legend>Resultado de la partida</legend>
              <div className="result-options">
                <label>
                  <input type="radio" name="result" value="lost" aria-label="Derrota"
                    defaultChecked={editingMatch?.won_match === false} required />
                  <span aria-hidden="true">🏆 ×</span>
                </label>
                <label>
                  <input type="radio" name="result" value="won" aria-label="Victoria"
                    defaultChecked={editingMatch?.won_match === true} required />
                  <span aria-hidden="true">🏆 ✓</span>
                </label>
              </div>
            </fieldset>
          </div>
          <div className="match-actions">
            <button type="submit">
              {saving ? "Guardando…" : editingMatch ? "Guardar cambios" : "Guardar partida"}
            </button>
            {editingMatch && <button className="secondary-button" type="button" onClick={onCancel}>Cancelar</button>}
          </div>
        </fieldset>
      </form>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
