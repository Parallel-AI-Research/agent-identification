import Link from "next/link";
import { signIn } from "@/app/auth-actions";
import { AuthForm } from "@/components/auth-form";
import { Field, Notice } from "@/components/ui";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <>
      <h1 className="mb-5 text-xl font-semibold">Sign in</h1>
      <div className="space-y-4">
        {error === "link" ? (
          <Notice tone="error">
            That link has expired or was already used. Request a new one.
          </Notice>
        ) : null}
        <AuthForm action={signIn} submit="Sign in">
          <Field label="Email" name="email" type="email" autoComplete="email" required />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </AuthForm>
      </div>
      <p className="mt-5 flex justify-between text-sm">
        <Link className="text-primary underline" href="/sign-up">
          Create an account
        </Link>
        <Link className="text-primary underline" href="/forgot-password">
          Forgot password?
        </Link>
      </p>
    </>
  );
}
