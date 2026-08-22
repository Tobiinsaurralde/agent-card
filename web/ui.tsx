import type { ComponentPropsWithRef, ReactNode } from "react";

export function cx(...parts: Array<string | false | undefined | null>): string {
  return parts.filter(Boolean).join(" ");
}

/** Anillo de foco compartido: acento de marca, 3:1 contra el fondo adyacente. */
export const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Transición de feedback: propiedades explícitas, nunca `all`. */
const feedback =
  "transition-[background-color,border-color,color,opacity,transform] duration-100 ease-out";

type ButtonVariant = "primary" | "outline" | "ghost" | "danger";

interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: ButtonVariant;
  size?: "md" | "sm";
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/85",
  outline: "border border-border bg-card text-foreground hover:bg-muted",
  ghost: "text-foreground hover:bg-muted",
  danger:
    "border border-destructive/35 bg-destructive-soft text-destructive hover:border-destructive/60",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      // min-h-10 = 40px, el mínimo táctil. active:scale da feedback físico <100ms.
      className={cx(
        "inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg font-medium",
        size === "md" ? "px-4 text-sm" : "px-3 text-xs",
        "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        feedback,
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
        "min-h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground",
        "placeholder:text-muted-foreground/70 hover:border-muted-foreground/40",
        "aria-[invalid=true]:border-destructive",
        feedback,
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
        "min-h-10 w-full cursor-pointer rounded-lg border border-input bg-background px-3 text-sm text-foreground",
        "hover:border-muted-foreground/40",
        feedback,
        focusRing,
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

/** Control segmentado accesible: dos opciones, una activa, feedback inmediato. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (next: T) => void;
  options: Array<{ value: T; label: ReactNode }>;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted p-1"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cx(
              "inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium",
              feedback,
              focusRing,
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
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
      <label htmlFor={id} className="block text-[13px] font-medium text-foreground">
        {label}
        {required === true && (
          <span className="font-normal text-muted-foreground"> · obligatorio</span>
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
        className={cx("mt-0.5 size-4 shrink-0 cursor-pointer rounded accent-[var(--accent)]", focusRing)}
        aria-describedby={hint !== undefined ? `${id}-hint` : undefined}
      />
      <div className="space-y-0.5">
        <label htmlFor={id} className="block cursor-pointer text-sm text-foreground">
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
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("rounded-2xl border border-border bg-card p-4 md:p-5", className)}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <h2 className="font-display text-base font-bold tracking-tight text-card-foreground">{title}</h2>
          {description !== undefined && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

type ChipTone = "success" | "destructive" | "warning" | "muted" | "accent";

const chipTones: Record<ChipTone, string> = {
  success: "bg-success-soft text-success",
  destructive: "bg-destructive-soft text-destructive",
  warning: "bg-warning-soft text-warning",
  muted: "bg-muted text-muted-foreground",
  accent: "bg-accent-soft text-accent",
};

/** Chip de estado con punto: el patrón de decisión de todo el producto. */
export function Chip({
  tone,
  dot = true,
  children,
}: {
  tone: ChipTone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide",
        chipTones[tone],
      )}
    >
      {dot && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
