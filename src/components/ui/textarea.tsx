import * as React from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground ring-offset-background transition-[box-shadow,border-color,background-color] duration-200 placeholder:text-foreground/55 hover:border-primary/40 focus-visible:outline-none focus-visible:border-primary/60 focus-visible:bg-primary/[0.03] focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.15),0_0_18px_-2px_hsl(var(--primary)/0.35)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
