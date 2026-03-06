export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          read?: boolean
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      post_history: {
        Row: {
          caption: string | null
          city: string
          condition: string | null
          created_at: string
          error_message: string | null
          id: string
          image_url: string | null
          platform: string | null
          status: string
          temperature: number | null
          user_id: string | null
        }
        Insert: {
          caption?: string | null
          city: string
          condition?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          image_url?: string | null
          platform?: string | null
          status?: string
          temperature?: number | null
          user_id?: string | null
        }
        Update: {
          caption?: string | null
          city?: string
          condition?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          image_url?: string | null
          platform?: string | null
          status?: string
          temperature?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      scheduled_posts: {
        Row: {
          caption: string | null
          city: string
          created_at: string
          error_message: string | null
          id: string
          platform: string
          scheduled_at: string
          status: string
          user_id: string
        }
        Insert: {
          caption?: string | null
          city: string
          created_at?: string
          error_message?: string | null
          id?: string
          platform?: string
          scheduled_at: string
          status?: string
          user_id: string
        }
        Update: {
          caption?: string | null
          city?: string
          created_at?: string
          error_message?: string | null
          id?: string
          platform?: string
          scheduled_at?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      weather_settings: {
        Row: {
          auto_post: boolean
          city: string
          created_at: string
          id: string
          instagram_api_key: string | null
          post_time: string
          tiktok_access_token: string | null
          tiktok_api_key: string | null
          tiktok_open_id: string | null
          tiktok_refresh_token: string | null
          tiktok_token_expires_at: string | null
          updated_at: string
          user_id: string | null
          youtube_access_token: string | null
          youtube_channel_id: string | null
          youtube_refresh_token: string | null
          youtube_token_expires_at: string | null
        }
        Insert: {
          auto_post?: boolean
          city?: string
          created_at?: string
          id?: string
          instagram_api_key?: string | null
          post_time?: string
          tiktok_access_token?: string | null
          tiktok_api_key?: string | null
          tiktok_open_id?: string | null
          tiktok_refresh_token?: string | null
          tiktok_token_expires_at?: string | null
          updated_at?: string
          user_id?: string | null
          youtube_access_token?: string | null
          youtube_channel_id?: string | null
          youtube_refresh_token?: string | null
          youtube_token_expires_at?: string | null
        }
        Update: {
          auto_post?: boolean
          city?: string
          created_at?: string
          id?: string
          instagram_api_key?: string | null
          post_time?: string
          tiktok_access_token?: string | null
          tiktok_api_key?: string | null
          tiktok_open_id?: string | null
          tiktok_refresh_token?: string | null
          tiktok_token_expires_at?: string | null
          updated_at?: string
          user_id?: string | null
          youtube_access_token?: string | null
          youtube_channel_id?: string | null
          youtube_refresh_token?: string | null
          youtube_token_expires_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
