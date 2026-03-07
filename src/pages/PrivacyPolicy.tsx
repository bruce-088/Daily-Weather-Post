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
        <p className="text-muted-foreground text-sm mb-10">Last updated: March 7, 2026</p>

        <div className="space-y-8 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">1. Information We Collect</h2>
            <p className="mb-2">We collect the following types of information:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong className="text-foreground">Account information:</strong> Email address and authentication credentials when you create an account.</li>
              <li><strong className="text-foreground">Location data:</strong> City name you provide for weather lookups (not GPS coordinates).</li>
              <li><strong className="text-foreground">API tokens:</strong> Third-party API keys or OAuth tokens you provide to connect TikTok, Instagram, or other platforms.</li>
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
              <li><strong className="text-foreground">Instagram Graph API:</strong> Used to publish content to your Instagram account. Subject to <a href="https://help.instagram.com/581066165581870" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Instagram's Terms of Use</a> and <a href="https://privacycenter.instagram.com/policy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Privacy Policy</a>.</li>
              <li><strong className="text-foreground">Weather data providers:</strong> Used to fetch current weather information for your configured city.</li>
              <li><strong className="text-foreground">Google OAuth:</strong> Used for optional sign-in authentication.</li>
            </ul>
            <p className="mt-2">We only access third-party platforms within the scope of permissions you explicitly grant. We do not sell or share your data with third parties for advertising purposes.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">4. Data Storage & Security</h2>
            <p>Your data is stored securely using industry-standard encryption and access controls. API tokens and credentials are stored in encrypted form. We use row-level security to ensure users can only access their own data.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">5. Data Retention</h2>
            <p>We retain your data for as long as your account is active. Post history is retained indefinitely unless you request deletion. When you delete your account, all associated data (including API tokens, settings, and post history) will be permanently removed within 30 days.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">6. Your Rights</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong className="text-foreground">Access:</strong> You can view all data associated with your account through the Service.</li>
              <li><strong className="text-foreground">Deletion:</strong> You can request deletion of your account and all associated data at any time.</li>
              <li><strong className="text-foreground">Revocation:</strong> You can disconnect third-party platform access at any time through your account settings or through the respective platform.</li>
              <li><strong className="text-foreground">Export:</strong> You can request a copy of your data by contacting us.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">7. Cookies</h2>
            <p>The Service uses essential cookies and local storage for authentication and session management. We do not use tracking or advertising cookies.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">8. Children's Privacy</h2>
            <p>The Service is not intended for users under the age of 13. We do not knowingly collect information from children under 13.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">9. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. We will notify users of material changes via email or in-app notification. Continued use of the Service after changes constitutes acceptance.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">10. Contact</h2>
            <p>If you have questions about this Privacy Policy or wish to exercise your data rights, please contact us at <span className="text-primary">privacy@skybrief.app</span>.</p>
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
