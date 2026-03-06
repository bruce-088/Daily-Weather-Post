import type { ReactNode } from "react";

export function MobilePreview({ children }: { children: ReactNode }) {
  return (
    <div className="relative mx-auto" style={{ width: 300, height: 620 }}>
      {/* Phone frame */}
      <div className="absolute inset-0 rounded-[2.5rem] border-4 border-muted-foreground/20 bg-card shadow-2xl overflow-hidden">
        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-28 h-6 bg-card rounded-b-2xl z-20" />
        {/* Screen content */}
        <div className="absolute inset-2 rounded-[2rem] overflow-hidden flex items-center justify-center bg-background">
          <div className="transform scale-[0.68] origin-center">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
