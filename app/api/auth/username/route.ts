import { createClient } from "@supabase/supabase-js";

const authOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};

function reply(status: number, data: object = {}) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return reply(415);

  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!username || username.length > 254 || username.includes("@") || !password || password.length > 4096) {
    return reply(400);
  }

  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!projectUrl || !secretKey || !publishableKey) return reply(503);

  try {
    const lookup = createClient(projectUrl, secretKey, authOptions);
    const { data: email, error: lookupError } = await lookup.rpc("resolve_login_username", {
      login_name: username,
    });
    if (lookupError) return reply(503);

    const auth = createClient(projectUrl, publishableKey, authOptions);
    const { data, error } = await auth.auth.signInWithPassword({
      email: email || `${crypto.randomUUID()}@example.invalid`,
      password,
    });
    if (error?.status === 429) return reply(429);
    if (!email || error || !data.session) return reply(401);

    return reply(200, {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  } catch {
    return reply(503);
  }
}
