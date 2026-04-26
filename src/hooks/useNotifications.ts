import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import {
  parseNotificationMessage,
  retryFailedPlatforms,
  getViewPostUrl,
  playSuccessPing,
  type NotificationMeta,
} from "@/lib/notificationUtils";

export interface Notification {
  id: string;
  user_id: string;
  title: string;
  message: string; // raw, includes meta sentinel
  displayMessage: string; // sanitized for display
  meta: NotificationMeta | null;
  type: string;
  read: boolean;
  created_at: string;
}

function enrich(row: Omit<Notification, "displayMessage" | "meta">): Notification {
  const { displayMessage, meta } = parseNotificationMessage(row.message);
  return { ...row, displayMessage, meta };
}

export function useNotifications() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setNotifications((data as Notification[]).map(enrich));
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("notifications-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const raw = payload.new as Notification;
          const n = enrich(raw);
          setNotifications((prev) => [n, ...prev]);

          const viewUrl = getViewPostUrl(n.meta);
          const failures = n.meta?.failures ?? [];
          const isSummary = n.meta?.kind === "summary";

          const action = !isSummary && failures.length > 0
            ? {
                label: "Retry",
                onClick: async () => {
                  toast.loading("Retrying failed platform(s)…", { id: `retry-${n.id}` });
                  const res = await retryFailedPlatforms(n.meta);
                  if (res.ok) {
                    toast.success("Retry succeeded", { id: `retry-${n.id}` });
                  } else {
                    toast.error(res.error || "Retry failed", { id: `retry-${n.id}` });
                  }
                },
              }
            : !isSummary && viewUrl && failures.length === 0
            ? {
                label: "View Post",
                onClick: () => window.open(viewUrl, "_blank", "noopener,noreferrer"),
              }
            : undefined;

          if (n.type === "success") {
            playSuccessPing();
            // Fire global success-shimmer event
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("skybrief:post-success"));
            }
            toast.success(n.title, { description: n.displayMessage, action });
          } else if (n.type === "error") {
            toast.error(n.title, { description: n.displayMessage, action });
          } else {
            toast.info(n.title, { description: n.displayMessage, action });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const markAsRead = useCallback(async (id: string) => {
    await supabase.from("notifications").update({ read: true }).eq("id", id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }, []);

  const markAllAsRead = useCallback(async () => {
    if (!user) return;
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (!unreadIds.length) return;
    await supabase.from("notifications").update({ read: true }).in("id", unreadIds);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, [user, notifications]);

  return { notifications, unreadCount, loading, markAsRead, markAllAsRead };
}
