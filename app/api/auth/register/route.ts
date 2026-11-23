import { createHash, createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function reply(status: number, code?: string) {
  return Response.json(code ? { code } : {}, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return reply(415);

  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!/^[a-z0-9][a-z0-9_.-]{2,29}$/.test(username)) return reply(400, "invalid_username");
  if (password.length < 8 || Buffer.byteLength(password) > 72) return reply(400, "invalid_password");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return reply(503);

  try {
    const supabase = createClient(url, secret, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const source = process.env.VERCEL === "1"
      ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
      : null;
    const sourceKey = createHmac("sha256", secret).update(source || "local").digest("hex");
    const { data: allowed, error: rateError } = await supabase.rpc("allow_registration_attempt", {
      registration_source: sourceKey,
    });
    if (rateError) return reply(503);
    if (!allowed) return reply(429);

    const { data: existing, error: lookupError } = await supabase.rpc("resolve_login_username", {
      login_name: username,
    });
    if (lookupError) return reply(503);
    if (existing) return reply(409, "username_taken");

    const localPart = createHash("sha256").update(username).digest("hex");
    const { error } = await supabase.auth.admin.createUser({
      email: `${localPart}@users.zenith-stats.invalid`,
      password,
      email_confirm: true,
      app_metadata: { zenith_username: username },
      user_metadata: { username },
    });
    if (error?.code === "email_exists" || error?.code === "user_already_exists") {
      return reply(409, "username_taken");
    }
    if (error?.code === "weak_password") return reply(400, "invalid_password");
    if (error?.status === 429) return reply(429);
    if (error) return reply(503);

    return reply(201);
  } catch {
    return reply(503);
  }
}
