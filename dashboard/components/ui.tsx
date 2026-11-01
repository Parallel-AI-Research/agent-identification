import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

const BUTTONS = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  secondary: "border border-input bg-card hover:bg-muted",
  danger: "border border-destructive/40 bg-card text-destructive hover:bg-destructive/5",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTONS }) {
  return (
    <button
      className={`inline-flex h-9 cursor-pointer items-center justify-center rounded-md px-3.5 text-sm font-medium transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${BUTTONS[variant]} ${className}`}
      {...props}
    />
  );
}

const FIELD =
  "w-full rounded-md border border-input bg-card px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input className={`mt-1.5 h-9 ${FIELD}`} {...props} />
      {hint ? <span className="mt-1 block font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function TextArea({
  label,
  hint,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string }) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <textarea className={`mt-1.5 py-2 font-mono ${FIELD}`} {...props} />
      {hint ? <span className="mt-1 block font-normal text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-border bg-card p-5 ${className}`}>
      {children}
    </section>
  );
}

export function Notice({
  tone,
  children,
}: {
  tone: "error" | "success" | "warning";
  children: ReactNode;
}) {
  const tones = {
    error: "border-destructive/30 bg-destructive/5 text-destructive",
    success: "border-success/30 bg-success/5 text-success",
    warning: "border-warning/30 bg-warning/5 text-warning",
  };
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-md border px-3 py-2 text-sm ${tones[tone]}`}
    >
      {children}
    </p>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone: "success" | "warning" | "muted";
  children: ReactNode;
}) {
  const tones = {
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    muted: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
