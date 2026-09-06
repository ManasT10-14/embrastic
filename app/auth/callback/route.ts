import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Handles Supabase's PKCE `?code=` confirmation/magic-link flow (used by
 * signUp's emailRedirectTo and resetPasswordForEmail's redirectTo). This is
 * distinct from /auth/confirm, which handles the older token_hash/type flow.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/protected";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    return NextResponse.redirect(`${origin}/auth/error?error=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${origin}/auth/error?error=No code provided`);
}
