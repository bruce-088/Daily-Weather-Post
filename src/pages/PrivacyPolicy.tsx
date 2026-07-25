import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const PrivacyPolicy = () => {
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft size={14} /> Back
        </Link>

        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-muted-foreground text-sm mb-10">Last updated: July 25, 2026</p>

        <div className="space-y-8 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">1. Information We Collect</h2>
            <p className="mb-2">We collect the following types of information:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong className="text-foreground">Account information:</strong> Email address and authentication credentials when you create an account.</li>
              <li><strong className="text-foreground">Location data:</strong> City name you provide for weather lookups (not GPS coordinates).</li>
              <li><strong className="text-foreground">API tokens:</strong> Third-party API keys or OAuth tokens you provide to connect TikTok, YouTube, Instagram, Twitter/X, LinkedIn, or other platforms.</li>
              <li><strong className="text-foreground">Post history:</strong> Records of content generated and posted through the Service, including captions, timestamps, and status.</li>
              <li><strong className="text-foreground">Weather data:</strong> Weather information fetched for your configured city.</li>
              <li><strong className="text-foreground">Settings:</strong> Your preferences such as auto-post schedules and notification settings.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">2. How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>To provide and operate the Service, including fetching weather data and posting content on your behalf.</li>
              <li>To authenticate you and secure your account.</li>
              <li>To store your posting preferences and history.</li>
              <li>To communicate with you about your account or Service updates.</li>
              <li>To improve and maintain the Service.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">3. Third-Party Services</h2>
            <p className="mb-2">The Service integrates with the following third-party services:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong className="text-foreground">TikTok Content Posting API:</strong> Used to publish content to your TikTok account. Subject to <a href="https://www.tiktok.com/legal/terms-of-service" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">TikTok's Terms of Service</a> and <a href="https://www.tiktok.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Privacy Policy</a>.</li>
              <li><strong className="text-foreground">YouTube Data API:</strong> Used to upload YouTube Shorts to your YouTube channel. Subject to <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">YouTube's Terms of Service</a> and <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Google Privacy Policy</a>.</li>
              <li><strong className="text-foreground">Twitter/X API:</strong> Used to publish content to your Twitter/X account. Subject to <a href="https://twitter.com/en/tos" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Twitter's Terms of Service</a> and <a href="https://twitter.com/en/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Privacy Policy</a>.</li>
              <li><strong className="text-foreground">LinkedIn API:</strong> Used to publish content to your LinkedIn profile. Subject to <a href="https://www.linkedin.com/legal/user-agreement" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">LinkedIn's User Agreement</a> and <a href="https://www.linkedin.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Privacy Policy</a>.</li>
              <li><strong className="text-foreground">Instagram Graph API:</strong> Used to publish content to your Instagram account. Subject to <a href="https://help.instagram.com/581066165581870" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Instagram's Terms of Use</a> and <a href="https://privacycenter.instagram.com/policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Privacy Policy</a>.</li>
              <li><strong className="text-foreground">Weather data providers:</strong> Used to fetch current weather information for your configured city.</li>
              <li><strong className="text-foreground">Google OAuth:</strong> Used for optional sign-in authentication.</li>
            </ul>
            <p className="mt-2">SkyBrief only accesses third-party platforms within the scope of permissions you explicitly grant. We do not sell or share your data with third parties for advertising purposes.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">3a. Google API Services User Data Policy</h2>
            <h3 className="text-base font-semibold text-foreground mb-2">Limited Use Disclosure</h3>
            <p className="mb-2">SkyBrief's use of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>

            <h3 className="text-base font-semibold text-foreground mb-2">YouTube Data API - Specific Disclosures</h3>
            <p className="font-semibold text-foreground mb-1">Data Accessed:</p>
            <ul className="list-disc pl-5 space-y-1 mb-2">
              <li><strong className="text-foreground">youtube.readonly scope:</strong> We access your YouTube channel name, channel ID, and basic channel information to verify your connected channel and display it in your dashboard.</li>
              <li><strong className="text-foreground">youtube.upload scope:</strong> We use the YouTube Data API to upload weather forecast videos with titles, descriptions, and tags to your YouTube channel.</li>
            </ul>
            <p className="font-semibold text-foreground mb-1">We do NOT access:</p>
            <ul className="list-disc pl-5 space-y-1 mb-2">
              <li>Your watch history</li>
              <li>Your liked videos</li>
              <li>Videos from other channels</li>
              <li>Your personal viewing preferences</li>
              <li>Your subscriptions</li>
              <li>Your comments</li>
            </ul>

            <p className="font-semibold text-foreground mb-1">Data Use:</p>
            <ul className="list-disc pl-5 space-y-1 mb-2">
              <li>Channel information is used solely to verify your channel identity and display your channel name in the SkyBrief dashboard.</li>
              <li>Video upload capability is used exclusively to post automated weather forecast videos to your channel.</li>
            </ul>
            <p className="font-semibold text-foreground mb-1">We do NOT use Google user data for:</p>
            <ul className="list-disc pl-5 space-y-1 mb-2">
              <li>Advertising or ad targeting</li>
              <li>Analytics beyond basic upload success/failure tracking</li>
              <li>Developing, improving, or training AI/ML models (generalized or personalized)</li>
              <li>Any purpose other than providing you with automated weather video posting</li>
            </ul>

            <p className="font-semibold text-foreground mb-1">Data Transfer:</p>
            <ul className="list-disc pl-5 space-y-1 mb-2">
              <li>We do NOT sell, rent, share, or transfer Google user data to third parties.</li>
              <li>The only "transfer" is posting videos directly to YOUR YouTube channel (which is the core functionality you authorize).</li>
            </ul>
            <p className="font-semibold text-foreground mb-1">We do NOT transfer Google user data to:</p>
            <ul className="list-disc pl-5 space-y-1 mb-2">
              <li>Advertisers</li>
              <li>Data brokers</li>
              <li>AI/ML model training services</li>
              <li>Any third-party service</li>
            </ul>

            <p className="font-semibold text-foreground mb-1">Data Storage & Security:</p>
            <ul className="list-disc pl-5 space-y-1 mb-2">
              <li>OAuth access and refresh tokens are stored encrypted in our secure database.</li>
              <li>Tokens are protected with row-level security — only you can access your own tokens.</li>
              <li>We use HTTPS encryption for all data transmission.</li>
              <li>We never store your Google password.</li>
            </ul>

            <p className="font-semibold text-foreground mb-1">Data Retention & Deletion:</p>
            <ul className="list-disc pl-5 space-y-1 mb-2">
              <li>OAuth tokens: Retained only while your YouTube channel connection is active.</li>
              <li>Channel information: Cached briefly and refreshed on each use.</li>
              <li>Deletion: You can disconnect your YouTube channel at any time via Settings → YouTube Channels, which immediately revokes our access and deletes all associated tokens.</li>
              <li>Account deletion: Permanently removes all Google user data within 30 days.</li>
            </ul>

            <p className="font-semibold text-foreground mb-1">AI/ML Model Training:</p>
            <ul className="list-disc pl-5 space-y-1 mb-2">
              <li>We do NOT use any Google user data (including YouTube data) to develop, improve, or train AI/ML models.</li>
              <li>We do NOT transfer Google user data to third-party AI/ML services.</li>
              <li>This applies to both raw user data and aggregated/anonymized data derived from Google APIs.</li>
            </ul>

            <p className="font-semibold text-foreground mb-1">Your Rights:</p>
            <ul className="list-disc pl-5 space-y-1 mb-2">
              <li><strong className="text-foreground">Access:</strong> View all YouTube channel connections in Settings → YouTube Channels.</li>
              <li><strong className="text-foreground">Revoke:</strong> Disconnect any channel at any time to revoke SkyBrief's access.</li>
              <li><strong className="text-foreground">Delete:</strong> Delete your account to permanently remove all Google user data.</li>
            </ul>
            <p>For questions about how we handle your Google user data, contact us at <span className="text-primary">privacy@skybriefapp.com</span>.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">5. Data Storage & Security</h2>
            <p>Your data is stored securely by SkyBrief using industry-standard encryption and access controls. API tokens and credentials are stored in encrypted form. We use row-level security to ensure users can only access their own data.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">6. Data Retention</h2>
            <p>We retain your data for as long as your account is active. Post history is retained indefinitely unless you request deletion. When you delete your account, all associated data (including API tokens, settings, and post history) will be permanently removed within 30 days.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">7. Your Rights</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong className="text-foreground">Access:</strong> You can view all data associated with your account through the Service.</li>
              <li><strong className="text-foreground">Deletion:</strong> You can request deletion of your account and all associated data at any time.</li>
              <li><strong className="text-foreground">Revocation:</strong> You can disconnect third-party platform access at any time through your account settings or through the respective platform.</li>
              <li><strong className="text-foreground">Export:</strong> You can request a copy of your data by contacting us.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">8. Cookies</h2>
            <p>SkyBrief uses essential cookies and local storage for authentication and session management. We do not use tracking or advertising cookies.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">9. Children's Privacy</h2>
            <p>SkyBrief is not intended for users under the age of 13. We do not knowingly collect information from children under 13.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">10. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. We will notify users of material changes via email or in-app notification. Continued use of the Service after changes constitutes acceptance.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">11. Contact</h2>
            <p>If you have questions about this Privacy Policy or wish to exercise your data rights, please contact SkyBrief at <span className="text-primary">privacy@skybrief.app</span>.</p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-border/50 text-xs text-muted-foreground flex gap-4">
          <Link to="/terms" className="hover:text-foreground">Terms of Service</Link>
          <Link to="/" className="hover:text-foreground">Home</Link>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
