"use client";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { MatchPanel } from "./match-panel";

const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
let client: SupabaseClient | undefined;

export function AuthPanel() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accountMenu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function closeOnOutsidePress(event: PointerEvent) {
      const menu = accountMenu.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false;
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePress, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress, true);
  }, []);

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
    const identifier = String(fields.get("identifier") ?? "").trim();
    const password = String(fields.get("password") ?? "");
    setBusy(true);
    setError("");

    try {
      if (identifier.includes("@")) {
        const { error: authError } = await client.auth.signInWithPassword({ email: identifier, password });
        if (authError) {
          setError(authError.code === "invalid_credentials"
            ? "El usuario o la contraseña son incorrectos."
            : "No se pudo iniciar sesión. Inténtalo de nuevo.");
        }
        return;
      }

      const response = await fetch("/api/auth/username", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: identifier, password }),
      });
      if (!response.ok) {
        if (response.status === 400 || response.status === 401) {
          setError("El usuario o la contraseña son incorrectos.");
        } else if (response.status === 429) {
          setError("Demasiados intentos. Espera un momento antes de volver a probar.");
        } else {
          setError("El acceso con nombre de usuario no está disponible. Puedes entrar con tu correo.");
        }
        return;
      }
      const { error: sessionError } = await client.auth.setSession(await response.json());
      if (sessionError) setError("No se pudo iniciar sesión. Inténtalo de nuevo.");
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
    <section className={session ? "auth-panel" : "auth-panel login-panel"}
      aria-labelledby={session ? undefined : "auth-title"}>
      {session ? (
        <MatchPanel
          key={session.user.id}
          client={client}
          userId={session.user.id}
          accountMenu={
            <details
              ref={accountMenu}
              className="account-menu"
              onKeyDown={(event) => {
                if (event.key === "Escape" && event.currentTarget.open) {
                  event.preventDefault();
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector("summary")?.focus();
                }
              }}
            >
              <summary aria-label="Cuenta">
                <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="12" cy="8" r="3.5" />
                  <path d="M5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2" />
                </svg>
              </summary>
              <div className="panel account-popover">
                <p>{session.user.email}</p>
                <button className="secondary-button" type="button" disabled={busy} onClick={signOut}>
                  {busy ? "Cerrando sesión…" : "Cerrar sesión"}
                </button>
                {error && <p role="alert">{error}</p>}
              </div>
            </details>
          }
        />
      ) : (
        <>
          <h2 id="auth-title">Iniciar sesión</h2>
          <form onSubmit={signIn}>
            <label>
              Usuario o correo electrónico
              <input name="identifier" type="text" autoComplete="username"
                autoCapitalize="none" spellCheck={false} required />
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
      {!session && error && <p role="alert">{error}</p>}
    </section>
  );
}
