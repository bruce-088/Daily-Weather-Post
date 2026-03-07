import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const TermsOfService = () => {
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8">
          <ArrowLeft size={14} /> Back
        </Link>

        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-muted-foreground text-sm mb-10">Last updated: March 7, 2026</p>

        <div className="space-y-8 text-sm leading-relaxed text-muted-foreground">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">1. Service Description</h2>
            <p>SkyBrief ("the Service") is a weather-based social media posting application that allows users to generate and publish weather-related content to third-party platforms including TikTok, YouTube, Instagram, Twitter/X, and LinkedIntagram, Twitter/X, and LinkedIntagram, Twitter/X, and LinkedIn. The Service fetches weather data, generates captions, and facilitates content posting on behalf of authenticated users.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">2. Acceptance of Terms</h2>
            <p>By accessing or using the Service, you agree to be bound by these Terms of Service. If you do not agree to these terms, you may not use the Service.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">3. User Accounts</h2>
            <p>You must create an account to use the Service. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You must provide accurate and complete information when creating your account.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">4. Content Ownership & Posting</h2>
            <p>You retain ownership of any content you create or post through the Service. By using the Se, YouTube, Instagram, Twitter/X, or LinkedIn content to third-, YouTube, Instagram, Twitter/X, or LinkedInms (such as TikTok or Instagram), you acknowledge that such content is also subject to the terms and policies of those platforms. You are solely responsible for the content you post and must ensure it complies with all applicable laws and platform policies.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">5. Third-Party API Usage</h2>
            <p>The Service integrates wiYouTube Data API, Instagram Graph API, Twitter/X API, LinkedInAPIs including the TikTok Content Posting API, Instagram Graph API, and weather data providers. By connecting your third-party accounts, you authorize the Service to act on your behalf within the scope of permissions you grant. You may revoke access at any time through your account settings or through the respective third-party platform settings.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">6. User Responsibilities</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>You will not use the Service for any unlawful purpose.</li>
              <li>You will not post spam, misleading, or harmful content.</li>
              <li>You will comply with the terms of service of all connected third-party platforms.</li>
              <li>You are responsible for any API keys or tokens you provide to the Service.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">7. Account Termination</h2>
            <p>We reserve the right to suspend or terminate your account if you violate these terms. You may delete your account at any time, which will remove your data from our systems in accordance with our Privacy Policy.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">8. Limitation of Liability</h2>
            <p>The Service is provided "as is" without warranties of any kind. We are not liable for any damages arising from the use of the Service, including but not limited to failed posts, data loss, or issues with third-party platform integrations. We do not guarantee uninterrupted or error-free operation of the Service.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">9. Changes to Terms</h2>
            <p>We may update these Terms of Service from time to time. Continued use of the Service after changes constitutes acceptance of the new terms. We will notify users of material changes via email or in-app notification.</p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">10. Contact</h2>
            <p>If you have questions about these Terms, please contact us at <span className="text-primary">support@skybrief.app</span>.</p>
          </section>
        </div>

        <div className="mt-12 pt-6 border-t border-border/50 text-xs text-muted-foreground flex gap-4">
          <Link to="/privacy" className="hover:text-foreground">Privacy Policy</Link>
          <Link to="/" className="hover:text-foreground">Home</Link>
        </div>
      </div>
    </div>
  );
};

export default TermsOfService;
