import type { PlatformAdapter, UploadResult } from "./platform-adapter.ts";

export class LinkedInAdapter implements PlatformAdapter {
  name = "linkedin";

  isConnected(settings: Record<string, unknown>): boolean {
    return !!settings.linkedin_access_token;
  }

  async getValidToken(supabase: any, userId: string): Promise<string | null> {
    const { data: settings } = await supabase
      .from("weather_settings")
      .select("linkedin_access_token, linkedin_refresh_token, linkedin_token_expires_at, linkedin_person_urn, linkedin_organization_urn")
      .eq("user_id", userId)
      .single();

    if (!settings?.linkedin_access_token) return null;

    // Check if token is expired (with 5 min buffer)
    const expiresAt = settings.linkedin_token_expires_at
      ? new Date(settings.linkedin_token_expires_at).getTime()
      : 0;

    let accessToken = settings.linkedin_access_token;

    if (Date.now() > expiresAt - 5 * 60 * 1000 && settings.linkedin_refresh_token) {
      console.log("LinkedIn token expired, refreshing...");
      const clientId = Deno.env.get("LINKEDIN_CLIENT_ID")!;
      const clientSecret = Deno.env.get("LINKEDIN_CLIENT_SECRET")!;

      const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: settings.linkedin_refresh_token,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        console.error("LinkedIn refresh failed:", data);
        return null;
      }

      const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
      await supabase
        .from("weather_settings")
        .update({
          linkedin_access_token: data.access_token,
          linkedin_refresh_token: data.refresh_token || settings.linkedin_refresh_token,
          linkedin_token_expires_at: newExpiresAt,
        })
        .eq("user_id", userId);

      accessToken = data.access_token;
    }

    // Prefer organization URN for company page posting, fallback to person URN
    const authorUrn = settings.linkedin_organization_urn || settings.linkedin_person_urn;
    const personUrn = settings.linkedin_person_urn;
    // Format: accessToken::authorUrn::personUrn (personUrn used as fallback)
    return `${accessToken}::${authorUrn}::${personUrn}`;
  }

  async uploadVideo(
    token: string,
    videoData: Uint8Array,
    title: string,
    description: string,
    _mimeType?: string,
  ): Promise<UploadResult | null> {
    const parts = token.split("::");
    const accessToken = parts[0];
    const authorUrn = parts[1];

    if (!authorUrn) {
      console.error("LinkedIn: author URN not provided in token");
      return null;
    }

    try {
      // Step 1: Register the upload
      console.log("LinkedIn: Registering video upload for", authorUrn);
      const registerRes = await fetch(
        "https://api.linkedin.com/rest/videos?action=initializeUpload",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "LinkedIn-Version": "202601",
            "X-Restli-Protocol-Version": "2.0.0",
          },
          body: JSON.stringify({
            initializeUploadRequest: {
              owner: authorUrn,
              fileSizeBytes: videoData.length,
              uploadCaptions: false,
              uploadThumbnail: false,
            },
          }),
        },
      );

      const registerData = await registerRes.json();
      if (!registerRes.ok) {
        console.error("LinkedIn register upload failed:", registerData);
        return null;
      }

      const uploadUrl =
        registerData.value?.uploadInstructions?.[0]?.uploadUrl;
      const videoUrn = registerData.value?.video;

      if (!uploadUrl || !videoUrn) {
        console.error("LinkedIn: Missing upload URL or video URN", registerData);
        return null;
      }

      // Step 2: Upload the video binary
      console.log("LinkedIn: Uploading video binary...");
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/octet-stream",
        },
        body: videoData,
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        console.error("LinkedIn video upload failed:", errText);
        return null;
      }

      // Step 3: Create the post with the video
      // Note: LinkedIn processes video asynchronously after post creation.
      // The video will appear on the post once LinkedIn finishes processing.
      console.log("LinkedIn: Creating post with video...");
      const postBody: any = {
        author: authorUrn,
        commentary: description || title,
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        content: {
          media: {
            title: title,
            id: videoUrn,
          },
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      };

      const postRes = await fetch("https://api.linkedin.com/rest/posts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "LinkedIn-Version": "202601",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify(postBody),
      });

      if (!postRes.ok) {
        const errText = await postRes.text();
        console.error("LinkedIn post creation failed:", errText);
        return null;
      }

      // The post ID is in the x-restli-id header
      const postId = postRes.headers.get("x-restli-id") || videoUrn;
      console.log("LinkedIn post created successfully:", postId);

      return { id: postId };
    } catch (err) {
      console.error("LinkedIn upload error:", err);
      return null;
    }
  }
}
