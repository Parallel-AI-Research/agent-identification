"use server";

import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export interface AuthState {
  error?: string;
  success?: string;
}
const MIN_PASSWORD = 8;
const text = (form: FormData, key: string) => String(form.get(key) ?? "");

export async function signIn(_: AuthState, form: FormData): Promise<AuthState> {
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({
    email: text(form, "email"),
    password: text(form, "password"),
  });
  if (error) {
    return {
      error:
        error.code === "email_not_confirmed"
          ? "Confirm your email first. Check your inbox for the link."
          : "Email or password is incorrect.",
    };
  }
  redirect("/products");
}

export async function signUp(_: AuthState, form: FormData): Promise<AuthState> {
  const password = text(form, "password");
  if (password.length < MIN_PASSWORD) {
    return { error: `Use at least ${MIN_PASSWORD} characters for your password.` };
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signUp({
    email: text(form, "email"),
    password,
    options: { emailRedirectTo: `${process.env.SITE_URL}/auth/confirm` },
  });
  if (error) return { error: error.message };
  return { success: "Check your email for a link to confirm your account." };
}

export async function requestReset(_: AuthState, form: FormData): Promise<AuthState> {
  const supabase = await supabaseServer();
  // The reply is the same either way, so this form can't reveal who has an account.
  await supabase.auth.resetPasswordForEmail(text(form, "email"), {
    redirectTo: `${process.env.SITE_URL}/auth/confirm?next=/reset-password`,
  });
  return { success: "If that email has an account, a reset link is on its way." };
}

export async function updatePassword(_: AuthState, form: FormData): Promise<AuthState> {
  const password = text(form, "password");
  if (password.length < MIN_PASSWORD) {
    return { error: `Use at least ${MIN_PASSWORD} characters for your password.` };
  }
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };
  redirect("/products");
}

export async function signOut(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/sign-in");
}
