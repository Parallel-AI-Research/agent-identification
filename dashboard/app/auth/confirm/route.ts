import { isAuthPKCECodeVerifierMissingError, type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// Only known paths, so a crafted email link can't redirect elsewhere.
const NEXT_PATHS = new Set(["/products", "/reset-password"]);

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/products";
  const supabase = await supabaseServer();
  let confirmed = false;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    confirmed = !error;
    // The link opened in a different browser from the one that requested it. Supabase
    // has already verified it, so only the sign-in step is missing here.
    if (isAuthPKCECodeVerifierMissingError(error)) {
      const target =
        next === "/reset-password" ? "/forgot-password?error=browser" : "/sign-in?notice=confirmed";
      return NextResponse.redirect(new URL(target, process.env.SITE_URL));
    }
  } else if (tokenHash && type) {
    confirmed = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  }
  const target = confirmed && NEXT_PATHS.has(next) ? next : "/sign-in?error=link";
  return NextResponse.redirect(new URL(target, process.env.SITE_URL));
}
