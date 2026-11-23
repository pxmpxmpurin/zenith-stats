"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState, type FormEvent } from "react";

export type CatalogLegend = { name: string; champion: string; title: string };
type Player = {
  player_id: string;
  username: string;
  is_admin: boolean;
  is_developer: boolean;
  is_owner: boolean;
  is_zenith: boolean;
};
const roleFields = {
  administrator: "is_admin",
  developer: "is_developer",
  zenith: "is_zenith",
} as const;
type Role = keyof typeof roleFields;

export function DeveloperPanel({ client, isOwner, onLegendsAdded, onUsernameChanged, onRoleChanged }: {
  client: SupabaseClient;
  isOwner: boolean;
  onLegendsAdded: (legends: CatalogLegend[]) => void;
  onUsernameChanged: (userId: string, username: string) => void;
  onRoleChanged: (userId: string, role: Role, enabled: boolean) => void;
}) {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [directoryError, setDirectoryError] = useState(false);
  const [directoryRevision, setDirectoryRevision] = useState(0);
  const [playerId, setPlayerId] = useState("");
  const [username, setUsername] = useState("");
  const [playerBusy, setPlayerBusy] = useState(false);
  const [playerError, setPlayerError] = useState("");
  const [playerNotice, setPlayerNotice] = useState("");
  const [legendText, setLegendText] = useState("");
  const [legendBusy, setLegendBusy] = useState(false);
  const [legendError, setLegendError] = useState("");
  const [legendNotice, setLegendNotice] = useState("");
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createdUsername, setCreatedUsername] = useState("");
  const selectedPlayer = players?.find((player) => player.player_id === playerId);
  const canEditPlayer = Boolean(selectedPlayer && (isOwner || !selectedPlayer.is_owner));

  useEffect(() => {
    const request = new AbortController();

    async function load() {
      const directory: Player[] = [];
      try {
        while (!request.signal.aborted) {
          const { data, count, error } = await client.rpc("developer_list_players", undefined, { count: "exact" })
            .order("player_id").range(directory.length, directory.length + 199)
            .abortSignal(request.signal).overrideTypes<Player[], { merge: false }>();
          if (request.signal.aborted) return;
          if (error || !Array.isArray(data)) throw new Error("No se pudo cargar el directorio.");
          directory.push(...data);
          if (!data.length || (count !== null && directory.length >= count)) {
            setPlayers(directory);
            setDirectoryError(false);
            return;
          }
        }
      } catch {
        if (!request.signal.aborted) setDirectoryError(true);
      }
    }

    void load();
    return () => request.abort();
  }, [client, directoryRevision]);

  async function createAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creatingAccount) return;

    const form = event.currentTarget;
    const fields = new FormData(form);
    const newUsername = String(fields.get("username") ?? "").trim().toLowerCase();
    const password = String(fields.get("password") ?? "");
    setCreatingAccount(true);
    setCreateError("");
    setCreatedUsername("");

    try {
      const { data } = await client.auth.getSession();
      if (!data.session) {
        setCreateError("Vuelve a iniciar sesión para crear una cuenta.");
        return;
      }
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
        body: JSON.stringify({ username: newUsername, password }),
      });
      const result = await response.json();
      if (response.status === 409) {
        setCreateError("Ese nombre de usuario ya está en uso.");
      } else if (response.status === 401 || response.status === 403) {
        setCreateError("Tu cuenta no tiene acceso a la creación de usuarios desde Desarrollo.");
      } else if (result.code === "invalid_username") {
        setCreateError("Revisa el formato del nombre de usuario.");
      } else if (result.code === "invalid_password") {
        setCreateError("Usa una contraseña de al menos 8 caracteres. Prueba con letras, números y símbolos.");
      } else if (response.ok && typeof result.userId === "string") {
        form.reset();
        setCreatedUsername(newUsername);
        setDirectoryRevision((current) => current + 1);
      } else {
        setCreateError("No se pudo crear la cuenta. Inténtalo de nuevo.");
      }
    } catch {
      setCreateError("No se pudo crear la cuenta. Inténtalo de nuevo.");
    } finally {
      setCreatingAccount(false);
    }
  }

  async function saveUsername(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEditPlayer || playerBusy) return;
    setPlayerBusy(true);
    setPlayerError("");
    setPlayerNotice("");

    try {
      const { data, error } = await client.rpc("developer_set_username", {
        target_user: playerId,
        new_username: username,
      });
      if (error?.code === "23505") {
        setPlayerError("Ese nombre de usuario ya está en uso.");
        return;
      }
      if (error?.code === "22023") {
        setPlayerError("Usa de 3 a 30 caracteres. Empieza con una letra sin tilde o un número.");
        return;
      }
      if (error || typeof data !== "string") throw new Error("No se pudo cambiar el nombre.");
      setPlayers((current) => current?.map((player) =>
        player.player_id === playerId ? { ...player, username: data } : player,
      ) ?? null);
      setUsername(data);
      onUsernameChanged(playerId, data);
      setPlayerNotice("Nombre de usuario actualizado.");
    } catch {
      setPlayerError("No se pudo cambiar el nombre de usuario.");
    } finally {
      setPlayerBusy(false);
    }
  }

  async function changeRole(role: Role, enabled: boolean) {
    if (!canEditPlayer || playerBusy) return;
    setPlayerBusy(true);
    setPlayerError("");
    setPlayerNotice("");

    try {
      const { error } = await client.rpc("developer_set_role", { target_user: playerId, role_name: role, enabled });
      if (error) throw error;
      const field = roleFields[role];
      setPlayers((current) => current?.map((player) =>
        player.player_id === playerId ? { ...player, [field]: enabled } : player,
      ) ?? null);
      onRoleChanged(playerId, role, enabled);
      setPlayerNotice("Roles actualizados.");
    } catch {
      setPlayerError("No se pudo cambiar el rol.");
    } finally {
      setPlayerBusy(false);
    }
  }

  async function addLegends(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (legendBusy) return;
    setLegendError("");
    setLegendNotice("");

    const lines = legendText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const entries = lines.map((line) => line.split("|").map((part) => part.trim()));
    if (!entries.length || entries.length > 100 || entries.some((parts) => parts.length !== 2 ||
      parts.some((part) => !part || part.length > 100 || part.includes(" · ")))) {
      setLegendError("Escribe hasta 100 líneas con el formato Campeón | Título de la leyenda.");
      return;
    }

    setLegendBusy(true);
    try {
      const { data, error } = await client.rpc("developer_add_legends", {
        new_legends: entries.map(([champion, title]) => ({ champion, title })),
      }).overrideTypes<CatalogLegend[], { merge: false }>();
      if (error || !Array.isArray(data)) throw new Error("No se pudieron guardar las leyendas.");
      onLegendsAdded(data);
      setLegendText("");
      setLegendNotice(data.length === 0 ? "Todas esas leyendas ya existen."
        : data.length === 1 ? "1 leyenda añadida." : `${data.length} leyendas añadidas.`);
    } catch {
      setLegendError("No se pudieron guardar las leyendas.");
    } finally {
      setLegendBusy(false);
    }
  }

  return (
    <div className="developer-panel">
      <section className="panel" aria-labelledby="catalog-tools-title">
        <h2 id="catalog-tools-title">Catálogo de leyendas</h2>
        <form onSubmit={addLegends}>
          <label>
            Nuevas leyendas
            <textarea value={legendText} onChange={(event) => setLegendText(event.target.value)}
              aria-describedby="legend-import-format" rows={5} maxLength={21000} required />
            <small id="legend-import-format">Una por línea, con el formato Campeón | Título de la leyenda.</small>
          </label>
          <button type="submit" disabled={legendBusy}>{legendBusy ? "Añadiendo…" : "Añadir leyendas"}</button>
        </form>
        {legendError && <p role="alert">{legendError}</p>}
        {legendNotice && <p role="status">{legendNotice}</p>}
      </section>
      <section className="panel" aria-labelledby="account-tools-title">
        <h2 id="account-tools-title">Usuarios y roles</h2>
        {directoryError && <p role="alert">No se pudo cargar la lista de usuarios.</p>}
        {!directoryError && !players && <p role="status">Cargando usuarios…</p>}
        {players && (
          <label>
            Usuario
            <select value={playerId} disabled={playerBusy} onChange={(event) => {
              const nextPlayer = players.find((player) => player.player_id === event.target.value);
              setPlayerId(event.target.value);
              setUsername(nextPlayer?.username ?? "");
              setPlayerError("");
              setPlayerNotice("");
            }}>
              <option value="">Elige un usuario</option>
              {[...players].sort((a, b) => a.username.localeCompare(b.username, "es")).map((player) => (
                <option key={player.player_id} value={player.player_id}>{player.username}</option>
              ))}
            </select>
          </label>
        )}
        {selectedPlayer && (
          <>
            <form className="developer-username" onSubmit={saveUsername}>
              <label>
                Nombre de usuario
                <input value={username} onChange={(event) => setUsername(event.target.value)}
                  autoCapitalize="none" spellCheck={false} minLength={3} maxLength={30}
                  readOnly={!canEditPlayer} required />
              </label>
              <button type="submit" disabled={playerBusy || !canEditPlayer}>Guardar nombre</button>
            </form>
            <div className="match-actions developer-roles">
              <button type="button" className="secondary-button" disabled={playerBusy || !canEditPlayer}
                onClick={() => void changeRole("administrator", !selectedPlayer.is_admin)}>
                {selectedPlayer.is_admin ? "Quitar administrador" : "Dar rol de administrador"}
              </button>
              <button type="button" className="secondary-button" disabled={playerBusy || !canEditPlayer}
                onClick={() => void changeRole("zenith", !selectedPlayer.is_zenith)}>
                {selectedPlayer.is_zenith ? "Quitar rol Zenith" : "Dar rol Zenith"}
              </button>
              {isOwner && !selectedPlayer.is_owner && (
                <button type="button" className="secondary-button" disabled={playerBusy}
                  onClick={() => void changeRole("developer", !selectedPlayer.is_developer)}>
                  {selectedPlayer.is_developer ? "Quitar desarrollador" : "Dar rol de desarrollador"}
                </button>
              )}
              {selectedPlayer.is_owner && <span>Desarrollador propietario</span>}
            </div>
          </>
        )}
        {playerError && <p role="alert">{playerError}</p>}
        {playerNotice && <p role="status">{playerNotice}</p>}
      </section>
      <section className="panel" aria-labelledby="create-account-title">
        <h2 id="create-account-title">Crear cuenta</h2>
        <form method="post" onSubmit={createAccount}>
          <label>
            Nombre de usuario
            <input name="username" autoComplete="off" autoCapitalize="none" spellCheck={false}
              minLength={3} maxLength={30} required />
            <small>De 3 a 30 caracteres. Usa letras sin tilde, números, puntos, guiones o guiones bajos.</small>
          </label>
          <label>
            Contraseña
            <input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={72} required />
          </label>
          <button type="submit" disabled={creatingAccount}>
            {creatingAccount ? "Creando cuenta…" : "Crear cuenta"}
          </button>
        </form>
        {createError && <p role="alert">{createError}</p>}
        {createdUsername && <p role="status">Cuenta creada para <strong>{createdUsername}</strong>.</p>}
      </section>
    </div>
  );
}
