import { updatePassword } from "@/app/auth-actions";
import { AuthForm } from "@/components/auth-form";
import { Field } from "@/components/ui";

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="mb-5 text-xl font-semibold">Choose a new password</h1>
      <AuthForm action={updatePassword} submit="Save password">
        <Field
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          hint="At least 8 characters."
          required
        />
      </AuthForm>
    </>
  );
}
