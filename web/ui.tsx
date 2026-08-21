import type { ComponentPropsWithRef, ReactNode } from "react";

function cx(...parts: Array<string | false | undefined | null>): string {
  return parts.filter(Boolean).join(" ");
}

/** Anillo de foco compartido: 3:1 contra el fondo adyacente, nunca `outline-none` solo. */
const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: ButtonVariant;
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50",
  secondary:
    "bg-secondary text-secondary-foreground hover:bg-muted disabled:opacity-50",
  ghost:
    "bg-transparent text-foreground hover:bg-muted disabled:opacity-50 border border-border",
  destructive:
    "bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50",
};

export function Button({
  variant = "primary",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      // min-h-10 = 40px, el mínimo táctil.
      className={cx(
        "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed",
        focusRing,
        buttonVariants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: ComponentPropsWithRef<"input">) {
  return (
    <input
      className={cx(
        "min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground",
        "placeholder:text-muted-foreground aria-[invalid=true]:border-destructive",
        focusRing,
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: ComponentPropsWithRef<"select">) {
  return (
    <select
      className={cx(
        "min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground",
        focusRing,
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

interface FieldProps {
  id: string;
  label: string;
  /** Se muestra debajo del control, no como placeholder. */
  hint?: string;
  error?: string | undefined;
  required?: boolean;
  children: ReactNode;
}

export function Field({ id, label, hint, error, required, children }: FieldProps) {
  const hintId = hint !== undefined ? `${id}-hint` : undefined;
  const errorId = error !== undefined ? `${id}-error` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {label}
        {required === true && (
          <span className="text-muted-foreground"> (obligatorio)</span>
        )}
      </label>
      {children}
      {hint !== undefined && error === undefined && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function Checkbox({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={cx(
          "mt-0.5 size-4 shrink-0 rounded border-input accent-primary",
          focusRing,
        )}
        aria-describedby={hint !== undefined ? `${id}-hint` : undefined}
      />
      <div className="space-y-0.5">
        <label htmlFor={id} className="block text-sm text-foreground">
          {label}
        </label>
        {hint !== undefined && (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

export function Panel({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        "rounded-lg border border-border bg-card p-4 md:p-6",
        className,
      )}
    >
      <header className="mb-4 space-y-1">
        <h2 className="text-sm font-semibold tracking-tight text-card-foreground">
          {title}
        </h2>
        {description !== undefined && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </header>
      {children}
    </section>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone: "success" | "destructive" | "muted";
  children: ReactNode;
}) {
  const tones = {
    success: "bg-success text-success-foreground",
    destructive: "bg-destructive text-destructive-foreground",
    muted: "bg-muted text-foreground",
  } as const;
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center rounded px-2 py-0.5 text-xs font-semibold",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
