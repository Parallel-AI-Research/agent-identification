import Link from "next/link";
import { requestReset } from "@/app/auth-actions";
import { AuthForm } from "@/components/auth-form";
import { Field, Notice } from "@/components/ui";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <>
      <h1 className="mb-5 text-xl font-semibold">Reset your password</h1>
      <div className="space-y-4">
        {error === "browser" ? (
          <Notice tone="error">
            Reset links only work in the browser that requested them. Request a new link here, then
            open it in this browser.
          </Notice>
        ) : null}
        <AuthForm action={requestReset} submit="Send reset link">
          <Field label="Email" name="email" type="email" autoComplete="email" required />
        </AuthForm>
      </div>
      <p className="mt-5 text-sm">
        <Link className="text-primary underline" href="/sign-in">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
