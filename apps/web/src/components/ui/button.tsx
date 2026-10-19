/**
 * shadcn/ui Button (base-nova, on Base UI) in the Tabletop look: a small
 * sticker that presses into its shadow. `size="icon"` is the round sticker
 * used for the camera buttons.
 */
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "#lib/utils.ts";

const buttonVariants = cva(
  "sticker-sm press inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-ui font-extrabold whitespace-nowrap select-none disabled:cursor-default disabled:opacity-40 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground",
        plain: "bg-card text-card-foreground",
        accent: "bg-accent text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        danger: "bg-danger text-ink",
      },
      size: {
        default: "min-h-12 px-5 text-base",
        sm: "min-h-9 px-3 text-sm",
        lg: "min-h-16 px-6 font-display text-2xl font-normal tracking-wide",
        icon: "size-12 rounded-full",
        "icon-sm": "size-9 rounded-full",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { buttonVariants };
