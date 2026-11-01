import Link from "next/link";
import { requestReset } from "@/app/auth-actions";
import { AuthForm } from "@/components/auth-form";
import { Field } from "@/components/ui";

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-5 text-xl font-semibold">Reset your password</h1>
      <AuthForm action={requestReset} submit="Send reset link">
        <Field label="Email" name="email" type="email" autoComplete="email" required />
      </AuthForm>
      <p className="mt-5 text-sm">
        <Link className="text-primary underline" href="/sign-in">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
