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
  const [registering, setRegistering] = useState(false);
  const [registeredUsername, setRegisteredUsername] = useState("");
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
        (event, nextSession) => {
          if (event === "SIGNED_OUT") {
            setRegistering(false);
            setRegisteredUsername("");
            setError("");
          }
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

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const fields = new FormData(event.currentTarget);
    const username = String(fields.get("identifier") ?? "").trim().toLowerCase();
    const password = String(fields.get("password") ?? "");
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        if (response.status === 409) {
          setError("Ese usuario ya está en uso.");
        } else if (response.status === 429) {
          setError("Demasiados intentos. Espera unos minutos antes de volver a probar.");
        } else if (result?.code === "invalid_username") {
          setError("Revisa el formato del nombre de usuario.");
        } else if (result?.code === "invalid_password") {
          setError("Usa una contraseña de al menos 8 caracteres. Prueba con una combinación de letras, números y símbolos.");
        } else {
          setError("El registro no está disponible en este momento. Inténtalo de nuevo.");
        }
        return;
      }

      setRegisteredUsername(username);
      setRegistering(false);
    } catch {
      setError("No se pudo conectar con el servidor. Inténtalo de nuevo.");
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
                <p>{session.user.app_metadata.zenith_username ?? session.user.email}</p>
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
          <h2 id="auth-title">{registering ? "Crear cuenta" : "Iniciar sesión"}</h2>
          {!registering && registeredUsername && <p role="status">Cuenta creada. Entra con tu usuario y contraseña.</p>}
          <form key={registering ? "register" : "sign-in"} method="post" onSubmit={registering ? register : signIn}>
            <label>
              {registering ? "Nombre de usuario" : "Usuario o correo electrónico"}
              <input
                name="identifier"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                defaultValue={registering ? "" : registeredUsername}
                minLength={registering ? 3 : undefined}
                maxLength={registering ? 30 : undefined}
                aria-describedby={registering ? "username-rules" : undefined}
                required
              />
              {registering && (
                <small id="username-rules">De 3 a 30 caracteres. Empieza con una letra sin tilde o un número. También puedes usar puntos, guiones y guiones bajos.</small>
              )}
            </label>
            <label>
              Contraseña
              <input name="password" type="password"
                autoComplete={registering ? "new-password" : "current-password"}
                minLength={registering ? 8 : undefined}
                maxLength={registering ? 72 : undefined}
                required />
              {registering && <small>Mínimo 8 caracteres.</small>}
            </label>
            <div className="match-actions">
              <button type="submit" disabled={busy}>
                {registering ? (busy ? "Creando cuenta…" : "Crear cuenta") : (busy ? "Entrando…" : "Entrar")}
              </button>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => {
                setError("");
                setRegisteredUsername("");
                setRegistering(!registering);
              }}>
                {registering ? "Volver a iniciar sesión" : "Crear una cuenta"}
              </button>
            </div>
          </form>
        </>
      )}
      {!session && error && <p role="alert">{error}</p>}
    </section>
  );
}
