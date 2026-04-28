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
      automations: {
        Row: {
          afternoon_platforms: Json
          afternoon_time: string
          city_id: string
          created_at: string
          enabled: boolean
          evening_platforms: Json
          evening_time: string
          id: string
          morning_platforms: Json
          morning_time: string
          platform_account_map: Json
          timezone: string
          tone: string
          updated_at: string
          user_id: string
          voice_settings: Json
        }
        Insert: {
          afternoon_platforms?: Json
          afternoon_time?: string
          city_id: string
          created_at?: string
          enabled?: boolean
          evening_platforms?: Json
          evening_time?: string
          id?: string
          morning_platforms?: Json
          morning_time?: string
          platform_account_map?: Json
          timezone?: string
          tone?: string
          updated_at?: string
          user_id: string
          voice_settings?: Json
        }
        Update: {
          afternoon_platforms?: Json
          afternoon_time?: string
          city_id?: string
          created_at?: string
          enabled?: boolean
          evening_platforms?: Json
          evening_time?: string
          id?: string
          morning_platforms?: Json
          morning_time?: string
          platform_account_map?: Json
          timezone?: string
          tone?: string
          updated_at?: string
          user_id?: string
          voice_settings?: Json
        }
        Relationships: [
          {
            foreignKeyName: "automations_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      cities: {
        Row: {
          country: string
          created_at: string
          id: string
          name: string
          state: string | null
          timezone: string
        }
        Insert: {
          country?: string
          created_at?: string
          id?: string
          name: string
          state?: string | null
          timezone?: string
        }
        Update: {
          country?: string
          created_at?: string
          id?: string
          name?: string
          state?: string | null
          timezone?: string
        }
        Relationships: []
      }
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
          last_attempt_at: string | null
          next_retry_at: string | null
          platform: string | null
          retry_count: number
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
          last_attempt_at?: string | null
          next_retry_at?: string | null
          platform?: string | null
          retry_count?: number
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
          last_attempt_at?: string | null
          next_retry_at?: string | null
          platform?: string | null
          retry_count?: number
          status?: string
          temperature?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      scheduled_posts: {
        Row: {
          automation_id: string | null
          caption: string | null
          city: string
          city_id: string | null
          created_at: string
          error_message: string | null
          id: string
          include_voiceover: boolean
          next_retry_at: string | null
          platform: string
          retry_count: number
          scheduled_at: string
          status: string
          user_id: string
          voiceover_url: string | null
        }
        Insert: {
          automation_id?: string | null
          caption?: string | null
          city: string
          city_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          include_voiceover?: boolean
          next_retry_at?: string | null
          platform?: string
          retry_count?: number
          scheduled_at: string
          status?: string
          user_id: string
          voiceover_url?: string | null
        }
        Update: {
          automation_id?: string | null
          caption?: string | null
          city?: string
          city_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          include_voiceover?: boolean
          next_retry_at?: string | null
          platform?: string
          retry_count?: number
          scheduled_at?: string
          status?: string
          user_id?: string
          voiceover_url?: string | null
        }
        Relationships: []
      }
      social_accounts: {
        Row: {
          access_token: string | null
          account_external_id: string | null
          account_name: string | null
          created_at: string
          extra: Json
          id: string
          platform: string
          refresh_token: string | null
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          account_external_id?: string | null
          account_name?: string | null
          created_at?: string
          extra?: Json
          id?: string
          platform: string
          refresh_token?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          account_external_id?: string | null
          account_name?: string | null
          created_at?: string
          extra?: Json
          id?: string
          platform?: string
          refresh_token?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      system_health: {
        Row: {
          id: string
          last_message: string | null
          last_run_at: string
          last_status: string | null
          updated_at: string
        }
        Insert: {
          id: string
          last_message?: string | null
          last_run_at?: string
          last_status?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          last_message?: string | null
          last_run_at?: string
          last_status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      system_logs: {
        Row: {
          context: Json | null
          created_at: string
          id: string
          message: string
          platform: string | null
          type: string
          user_id: string | null
        }
        Insert: {
          context?: Json | null
          created_at?: string
          id?: string
          message: string
          platform?: string | null
          type: string
          user_id?: string | null
        }
        Update: {
          context?: Json | null
          created_at?: string
          id?: string
          message?: string
          platform?: string | null
          type?: string
          user_id?: string | null
        }
        Relationships: []
      }
      user_cities: {
        Row: {
          city_id: string
          created_at: string
          id: string
          is_primary: boolean
          user_id: string
        }
        Insert: {
          city_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
          user_id: string
        }
        Update: {
          city_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_cities_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      weather_settings: {
        Row: {
          afternoon_platforms: Json
          afternoon_post_time: string
          afternoon_skip_date: string | null
          auto_post: boolean
          auto_post_afternoon: boolean
          auto_post_evening: boolean
          auto_post_morning: boolean
          caption_tone: string
          city: string
          created_at: string
          enable_voiceover: boolean
          evening_platforms: Json
          evening_post_time: string
          evening_skip_date: string | null
          id: string
          instagram_api_key: string | null
          linkedin_access_token: string | null
          linkedin_organization_urn: string | null
          linkedin_person_urn: string | null
          linkedin_refresh_token: string | null
          linkedin_token_expires_at: string | null
          morning_platforms: Json
          morning_post_time: string
          morning_skip_date: string | null
          post_time: string
          state: string | null
          tiktok_access_token: string | null
          tiktok_api_key: string | null
          tiktok_open_id: string | null
          tiktok_refresh_token: string | null
          tiktok_token_expires_at: string | null
          timezone: string
          twitter_access_token: string | null
          twitter_access_token_secret: string | null
          twitter_user_id: string | null
          updated_at: string
          user_id: string | null
          voiceover_similarity: number
          voiceover_speed: number
          voiceover_stability: number
          voiceover_voice_id: string
          youtube_access_token: string | null
          youtube_channel_id: string | null
          youtube_refresh_token: string | null
          youtube_token_expires_at: string | null
        }
        Insert: {
          afternoon_platforms?: Json
          afternoon_post_time?: string
          afternoon_skip_date?: string | null
          auto_post?: boolean
          auto_post_afternoon?: boolean
          auto_post_evening?: boolean
          auto_post_morning?: boolean
          caption_tone?: string
          city?: string
          created_at?: string
          enable_voiceover?: boolean
          evening_platforms?: Json
          evening_post_time?: string
          evening_skip_date?: string | null
          id?: string
          instagram_api_key?: string | null
          linkedin_access_token?: string | null
          linkedin_organization_urn?: string | null
          linkedin_person_urn?: string | null
          linkedin_refresh_token?: string | null
          linkedin_token_expires_at?: string | null
          morning_platforms?: Json
          morning_post_time?: string
          morning_skip_date?: string | null
          post_time?: string
          state?: string | null
          tiktok_access_token?: string | null
          tiktok_api_key?: string | null
          tiktok_open_id?: string | null
          tiktok_refresh_token?: string | null
          tiktok_token_expires_at?: string | null
          timezone?: string
          twitter_access_token?: string | null
          twitter_access_token_secret?: string | null
          twitter_user_id?: string | null
          updated_at?: string
          user_id?: string | null
          voiceover_similarity?: number
          voiceover_speed?: number
          voiceover_stability?: number
          voiceover_voice_id?: string
          youtube_access_token?: string | null
          youtube_channel_id?: string | null
          youtube_refresh_token?: string | null
          youtube_token_expires_at?: string | null
        }
        Update: {
          afternoon_platforms?: Json
          afternoon_post_time?: string
          afternoon_skip_date?: string | null
          auto_post?: boolean
          auto_post_afternoon?: boolean
          auto_post_evening?: boolean
          auto_post_morning?: boolean
          caption_tone?: string
          city?: string
          created_at?: string
          enable_voiceover?: boolean
          evening_platforms?: Json
          evening_post_time?: string
          evening_skip_date?: string | null
          id?: string
          instagram_api_key?: string | null
          linkedin_access_token?: string | null
          linkedin_organization_urn?: string | null
          linkedin_person_urn?: string | null
          linkedin_refresh_token?: string | null
          linkedin_token_expires_at?: string | null
          morning_platforms?: Json
          morning_post_time?: string
          morning_skip_date?: string | null
          post_time?: string
          state?: string | null
          tiktok_access_token?: string | null
          tiktok_api_key?: string | null
          tiktok_open_id?: string | null
          tiktok_refresh_token?: string | null
          tiktok_token_expires_at?: string | null
          timezone?: string
          twitter_access_token?: string | null
          twitter_access_token_secret?: string | null
          twitter_user_id?: string | null
          updated_at?: string
          user_id?: string | null
          voiceover_similarity?: number
          voiceover_speed?: number
          voiceover_stability?: number
          voiceover_voice_id?: string
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
