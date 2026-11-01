import Link from "next/link";
import { signUp } from "@/app/auth-actions";
import { AuthForm } from "@/components/auth-form";
import { Field } from "@/components/ui";

export default function SignUpPage() {
  return (
    <>
      <h1 className="mb-5 text-xl font-semibold">Create your account</h1>
      <AuthForm action={signUp} submit="Create account">
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          hint="At least 8 characters."
          required
        />
      </AuthForm>
      <p className="mt-5 text-sm">
        Already have an account?{" "}
        <Link className="text-primary underline" href="/sign-in">
          Sign in
        </Link>
      </p>
    </>
  );
}
