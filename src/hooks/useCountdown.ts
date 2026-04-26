import { useEffect, useState } from "react";

/**
 * Returns a human-readable countdown string updated every minute.
 * - Future: "Posting in 2h 14m" / "Posting in 12m" / "Posting in <1m"
 * - Past: "Overdue by 3m" / "Overdue by 1h 5m"
 */
export function useCountdown(target: string | Date): { label: string; isPast: boolean; diffMs: number } {
  const targetMs = typeof target === "string" ? new Date(target).getTime() : target.getTime();
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [targetMs]);

  const diffMs = targetMs - now;
  const isPast = diffMs < 0;
  const abs = Math.abs(diffMs);
  const totalMinutes = Math.floor(abs / 60_000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  let parts = "";
  if (days > 0) parts = `${days}d ${hours}h`;
  else if (hours > 0) parts = `${hours}h ${minutes}m`;
  else if (minutes > 0) parts = `${minutes}m`;
  else parts = "<1m";

  const label = isPast ? `Overdue by ${parts}` : `Posting in ${parts}`;
  return { label, isPast, diffMs };
}
