"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { StatisticsPanel } from "./statistics-panel";

type Deck = { id: string; legend: string; deck_type: string };
type Legend = { name: string; champion: string; title: string };
type Match = {
  id: string;
  deck_id: string;
  opponent_legend: string;
  opponent_deck_type: string | null;
  won_die_roll: boolean;
  won_match: boolean;
  played_at: string;
};

const recentLimit = 50;
const dateFormat = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" });
const matchColumns = "id, deck_id, opponent_legend, opponent_deck_type, won_die_roll, won_match, played_at";
const deckColumns = "id, legend, deck_type";
const unspecifiedDeckType = "Sin especificar";

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

export function MatchPanel({ client, userId, accountMenu }: {
  client: SupabaseClient;
  userId: string;
  accountMenu: ReactNode;
}) {
  const [view, setView] = useState<"matches" | "statistics">("matches");
  const [decks, setDecks] = useState<Deck[]>([]);
  const [legends, setLegends] = useState<Legend[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [entry, setEntry] = useState({ version: 0, legend: "" });
  const [editingMatch, setEditingMatch] = useState<Match | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const editDialog = useRef<HTMLDialogElement>(null);
  const editHeading = useRef<HTMLHeadingElement>(null);
  const pendingMatch = useRef<{ id: string; fields: string } | null>(null);
  const saveInProgress = useRef(false);
  const editingDeck = decks.find((deck) => deck.id === editingMatch?.deck_id);

  useEffect(() => {
    const request = new AbortController();

    async function load() {
      try {
        const [deckResult, matchResult, legendResult] = await Promise.all([
          client.from("decks").select(deckColumns).eq("user_id", userId)
            .order("legend").order("deck_type").abortSignal(request.signal),
          client.from("matches").select(matchColumns).eq("user_id", userId)
            .order("played_at", { ascending: false }).order("id")
            .limit(recentLimit).abortSignal(request.signal),
          client.from("legends").select("name, champion, title")
            .order("champion").order("title").abortSignal(request.signal),
        ]);
        if (request.signal.aborted) return;
        if (deckResult.error || matchResult.error || legendResult.error) throw new Error("No se pudieron cargar los datos.");
        setDecks(deckResult.data);
        setMatches(matchResult.data);
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

  function editMatch(match: Match | null) {
    setEditingMatch(match);
    setError("");
    setNotice("");
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
      };

      if (editingMatch) {
        const { data: updatedMatch, error: updateError } = await client.from("matches")
          .update(match).eq("user_id", userId).eq("id", editingMatch.id)
          .select(matchColumns).single();
        if (updateError) throw updateError;
        setMatches((current) => current.map((item) => item.id === updatedMatch.id ? updatedMatch : item));
        editMatch(null);
        setNotice("Cambios guardados.");
        return;
      }

      const signature = JSON.stringify(match);
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
      setMatches((current) => [savedMatch, ...current].slice(0, recentLimit));
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

  return (
    <div>
      <div className="dashboard-bar">
        <nav className="dashboard-menu" aria-label="Vistas de Zenith Stats">
          <button type="button" aria-pressed={view === "matches"} onClick={() => setView("matches")}>
            Partidas
          </button>
          <button type="button" aria-pressed={view === "statistics"} onClick={() => setView("statistics")}>
            Estadísticas
          </button>
        </nav>
        {accountMenu}
      </div>
      {loading && <p role="status">Cargando partidas…</p>}
      {loadError && <p role="alert">No se pudieron cargar tus datos. Recarga la página para reintentar.</p>}
      <div className="match-panel" hidden={loading || loadError || view !== "matches"}>
        <section className="panel match-entry" aria-labelledby="match-entry-title">
          <h2 id="match-entry-title">Registrar partida</h2>
          <MatchForm key={entry.version} legends={legends} initialLegend={entry.legend}
            saving={saving} error={editingMatch ? "" : error}
            onSave={(event) => void saveMatch(event, null)} />
          <p role="status" hidden={notice !== "Partida guardada."}>{notice}</p>
        </section>

        <section className="panel match-history" aria-labelledby="match-history-title">
          <h2 id="match-history-title">Mis partidas recientes</h2>
          {matches.length === 0 ? <p>Aún no has registrado partidas.</p> : (
            <ul className="match-list">
              {matches.map((match) => {
                const deck = decks.find((item) => item.id === match.deck_id);
                const deckType = visibleDeckType(deck);

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
                      <time dateTime={match.played_at}>{dateFormat.format(new Date(match.played_at))}</time>
                    </div>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={saving}
                      aria-haspopup="dialog"
                      onClick={(event) => {
                        event.currentTarget.focus();
                        editMatch(match);
                      }}
                    >
                      Editar
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p role="status" hidden={notice !== "Cambios guardados."}>{notice}</p>
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
      </div>
      {!loading && !loadError && view === "statistics" && (
        <StatisticsPanel
          client={client}
          userId={userId}
          showLegend={showLegend}
          showDeckType={visibleDeckType}
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
  legends, initialLegend = "", editingMatch, editingDeck, saving, error, onSave, onCancel,
}: {
  legends: Legend[];
  initialLegend?: string;
  editingMatch?: Match;
  editingDeck?: Deck;
  saving: boolean;
  error: string;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onCancel?: () => void;
}) {
  return (
    <>
      <form onSubmit={onSave}>
        <fieldset disabled={saving}>
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
