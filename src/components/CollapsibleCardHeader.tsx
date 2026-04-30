import { ReactNode } from "react";
import { CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";

interface CollapsibleCardHeaderProps {
  open: boolean;
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Optional badges/info shown inline on the right when collapsed */
  collapsedHint?: ReactNode;
}

/**
 * Header row for a Collapsible Card. Click anywhere on the header to toggle.
 * Place inside <Collapsible>, before <CollapsibleContent>.
 */
export function CollapsibleCardHeader({
  open,
  icon,
  title,
  description,
  collapsedHint,
}: CollapsibleCardHeaderProps) {
  return (
    <CollapsibleTrigger asChild>
      <CardHeader className="pb-3 cursor-pointer select-none hover:bg-muted/30 transition-colors rounded-t-lg">
        <div className="flex items-center justify-between gap-2">
          <div className="space-y-1 min-w-0">
            <CardTitle className="text-base flex items-center gap-2">
              {icon}
              {title}
            </CardTitle>
            {description && (
              <CardDescription className="text-xs truncate">
                {description}
              </CardDescription>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!open && collapsedHint}
            <ChevronDown
              size={18}
              className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            />
          </div>
        </div>
      </CardHeader>
    </CollapsibleTrigger>
  );
}
