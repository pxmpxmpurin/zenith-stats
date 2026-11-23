"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState, type FormEvent } from "react";

type Deck = { id: string; legend: string; deck_type: string };
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

function normalizeLegend(legend: string) {
  return legend.trim().toLowerCase();
}

function formatLegend(legend: string) {
  return normalizeLegend(legend).replace(/^./u, (firstLetter) => firstLetter.toUpperCase());
}

export function MatchPanel({ client, userId }: { client: SupabaseClient; userId: string }) {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [legendQuery, setLegendQuery] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const legendInput = useRef<HTMLInputElement>(null);
  const pendingMatch = useRef<{ id: string; fields: string } | null>(null);
  const saveInProgress = useRef(false);
  const knownLegends = [...new Map(
    decks.map((deck) => [normalizeLegend(deck.legend), formatLegend(deck.legend)]),
  ).values()];
  const search = normalizeLegend(legendQuery);
  const suggestions = knownLegends
    .filter((legend) => normalizeLegend(legend).includes(search))
    .slice(0, 3);

  useEffect(() => {
    const request = new AbortController();

    async function load() {
      try {
        const [deckResult, matchResult] = await Promise.all([
          client.from("decks").select(deckColumns).eq("user_id", userId)
            .order("legend").order("deck_type").abortSignal(request.signal),
          client.from("matches").select(matchColumns).eq("user_id", userId)
            .order("played_at", { ascending: false }).order("id")
            .limit(recentLimit).abortSignal(request.signal),
        ]);
        if (request.signal.aborted) return;
        if (deckResult.error || matchResult.error) throw new Error("No se pudieron cargar los datos.");
        setDecks(deckResult.data);
        setMatches(matchResult.data);
      } catch {
        if (!request.signal.aborted) setLoadError(true);
      } finally {
        if (!request.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => request.abort();
  }, [client, userId]);

  async function saveMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveInProgress.current) return;

    const form = event.currentTarget;
    const fields = new FormData(form);
    const opponentLegend = formatLegend(String(fields.get("opponentLegend") ?? ""));
    const opponentDeckType = String(fields.get("opponentDeckType") ?? "").trim();
    const legend = formatLegend(legendQuery);
    const dieRoll = fields.get("dieRoll");
    const result = fields.get("result");

    setNotice("");
    setError("");
    if (!opponentLegend || !legend ||
        (dieRoll !== "won" && dieRoll !== "lost") ||
        (result !== "won" && result !== "lost")) {
      setError("Completa los campos obligatorios.");
      return;
    }

    saveInProgress.current = true;
    setSaving(true);

    try {
      const matchesLegend = (deck: Deck) => (
        normalizeLegend(deck.legend) === search &&
        deck.deck_type.trim().toLowerCase() === unspecifiedDeckType.toLowerCase()
      );
      let selectedDeck = decks.find(matchesLegend);
      if (!selectedDeck) {
        const { data: savedDeck, error: deckError } = await client.from("decks")
          .insert({ user_id: userId, legend, deck_type: unspecifiedDeckType })
          .select(deckColumns).single();
        if (deckError?.code === "23505") {
          const { data: currentDecks, error: refreshError } = await client.from("decks")
            .select(deckColumns).eq("user_id", userId).order("legend").order("deck_type");
          if (refreshError) throw refreshError;
          setDecks(currentDecks);
          selectedDeck = currentDecks.find(matchesLegend);
        } else if (deckError) {
          throw deckError;
        } else {
          selectedDeck = savedDeck;
          setDecks((current) => [...current, savedDeck]);
        }
      }
      if (!selectedDeck) throw new Error("No se pudo recuperar la leyenda.");

      const match = {
        user_id: userId,
        deck_id: selectedDeck.id,
        opponent_legend: opponentLegend,
        opponent_deck_type: opponentDeckType || null,
        won_die_roll: dieRoll === "won",
        won_match: result === "won",
      };
      const signature = JSON.stringify(match);
      if (pendingMatch.current?.fields !== signature) {
        pendingMatch.current = { id: crypto.randomUUID(), fields: signature };
      }
      const id = pendingMatch.current.id;
      const { data: insertedMatch, error: matchError } = await client.from("matches")
        .insert({ id, ...match }).select(matchColumns).single();

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
      form.reset();
      setLegendQuery(legend);
      setShowSuggestions(false);
      setNotice("Partida guardada.");
    } catch {
      setError("No se pudo guardar la partida. Inténtalo de nuevo.");
    } finally {
      saveInProgress.current = false;
      setSaving(false);
    }
  }

  if (loading) return <p role="status">Cargando partidas…</p>;
  if (loadError) return <p role="alert">No se pudieron cargar tus datos. Recarga la página para reintentar.</p>;

  return (
    <div className="match-panel">
      <h2>Registrar partida</h2>
      <form onSubmit={saveMatch}>
        <fieldset disabled={saving}>
          <div
            className="legend-picker"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setShowSuggestions(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setShowSuggestions(false);
            }}
          >
            <label>
              Tu leyenda
              <input
                ref={legendInput}
                value={legendQuery}
                onChange={(event) => {
                  setLegendQuery(event.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setLegendQuery(formatLegend)}
                onClick={() => setShowSuggestions(true)}
                placeholder="Busca o escribe una leyenda"
                autoComplete="off"
                required
              />
            </label>
            {showSuggestions && suggestions.length > 0 && (
              <ul className="legend-suggestions" aria-label="Leyendas guardadas">
                {suggestions.map((legend) => (
                  <li key={legend}>
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setLegendQuery(legend);
                        legendInput.current?.focus();
                        setShowSuggestions(false);
                      }}
                    >
                      {legend}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <label>
            Leyenda rival
            <input
              name="opponentLegend"
              onBlur={(event) => {
                event.currentTarget.value = formatLegend(event.currentTarget.value);
              }}
              required
            />
          </label>
          <label>Tipo de mazo rival (opcional)<input name="opponentDeckType" /></label>
          <fieldset>
            <legend>Tirada de dado</legend>
            <div className="result-options">
              <label>
                <input type="radio" name="dieRoll" value="lost" aria-label="Perdí el dado" required />
                <span aria-hidden="true">⚄ ×</span>
              </label>
              <label>
                <input type="radio" name="dieRoll" value="won" aria-label="Gané el dado" required />
                <span aria-hidden="true">⚄ ✓</span>
              </label>
            </div>
          </fieldset>
          <fieldset>
            <legend>Resultado de la partida</legend>
            <div className="result-options">
              <label>
                <input type="radio" name="result" value="lost" aria-label="Derrota" required />
                <span aria-hidden="true">🏆 ×</span>
              </label>
              <label>
                <input type="radio" name="result" value="won" aria-label="Victoria" required />
                <span aria-hidden="true">🏆 ✓</span>
              </label>
            </div>
          </fieldset>
          <button type="submit">{saving ? "Guardando…" : "Guardar partida"}</button>
        </fieldset>
      </form>
      {error && <p role="alert">{error}</p>}
      <p role="status" hidden={!notice}>{notice}</p>

      <h2>Mis partidas recientes</h2>
      {matches.length === 0 ? <p>Aún no has registrado partidas.</p> : (
        <ul className="match-list">
          {matches.map((match) => {
            const deck = decks.find((item) => item.id === match.deck_id);

            return (
              <li key={match.id}>
                <strong>
                  {deck ? formatLegend(deck.legend) : "Tu leyenda"} contra {formatLegend(match.opponent_legend)}
                </strong>
                {match.opponent_deck_type && <span> · {match.opponent_deck_type}</span>}
                <div>
                  {match.won_match ? "Victoria" : "Derrota"} · {match.won_die_roll ? "Ganaste el dado" : "Perdiste el dado"}
                </div>
                <time dateTime={match.played_at}>{dateFormat.format(new Date(match.played_at))}</time>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
