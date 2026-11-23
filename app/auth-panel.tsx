"use client";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState, type FormEvent } from "react";
import { MatchPanel } from "./match-panel";

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
let client: SupabaseClient | undefined;

export function AuthPanel() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!projectUrl || !publishableKey) return;

    try {
      client ??= createClient(projectUrl, publishableKey);
      const { data: { subscription } } = client.auth.onAuthStateChange(
        (_event, nextSession) => {
          setSession(nextSession);
          setLoading(false);
        },
      );

      return () => subscription.unsubscribe();
    } catch {
      setError("Revisa la configuración de Supabase.");
      setLoading(false);
    }
  }, []);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || busy) return;

    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError("");

    try {
      const { error: authError } = await client.auth.signInWithPassword({
        email: String(fields.get("email")).trim(),
        password: String(fields.get("password")),
      });
      if (authError) {
        setError(authError.code === "invalid_credentials"
          ? "El correo o la contraseña son incorrectos."
          : "No se pudo iniciar sesión. Inténtalo de nuevo.");
      }
    } catch {
      setError("No se pudo conectar con Supabase. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!client || busy) return;
    setBusy(true);
    setError("");

    try {
      const { error: authError } = await client.auth.signOut({ scope: "local" });
      if (authError) setError("No se pudo cerrar sesión. Inténtalo de nuevo.");
    } catch {
      setError("No se pudo cerrar sesión. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  if (!projectUrl || !publishableKey) {
    return <p>El inicio de sesión está pendiente de configuración.</p>;
  }

  if (loading) return <p role="status">Comprobando sesión…</p>;
  if (!client) return <p role="alert">{error}</p>;

  return (
    <section className="auth-panel" aria-labelledby="auth-title">
      {session ? (
        <>
          <h2 id="auth-title">Sesión iniciada</h2>
          <p>{session.user.email}</p>
          <button type="button" disabled={busy} onClick={signOut}>
            {busy ? "Cerrando sesión…" : "Cerrar sesión"}
          </button>
          <MatchPanel key={session.user.id} client={client} userId={session.user.id} />
        </>
      ) : (
        <>
          <h2 id="auth-title">Iniciar sesión</h2>
          <form onSubmit={signIn}>
            <label>
              Correo electrónico
              <input name="email" type="email" autoComplete="username" required />
            </label>
            <label>
              Contraseña
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <button type="submit" disabled={busy}>
              {busy ? "Entrando…" : "Entrar"}
            </button>
          </form>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
