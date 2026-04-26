import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground ring-offset-background transition-[box-shadow,border-color,background-color] duration-200 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-foreground/55 hover:border-primary/40 focus-visible:outline-none focus-visible:border-primary/60 focus-visible:bg-primary/[0.03] focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.15),0_0_18px_-2px_hsl(var(--primary)/0.35)] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
