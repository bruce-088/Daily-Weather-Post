import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Cloud, Mic, Film, MapPin, Youtube, BarChart3 } from "lucide-react";

export default function Landing() {
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <header className="border-b border-border/40 backdrop-blur-sm sticky top-0 z-10 bg-background/60">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cloud className="h-6 w-6 text-primary" />
            <span className="text-xl font-semibold tracking-tight">SkyBrief</span>
          </div>
          <Link to="/dashboard">
            <Button variant="outline" size="sm">Login</Button>
          </Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-16 md:py-24">
        {/* Hero */}
        <section className="text-center max-w-3xl mx-auto">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-4">
            SkyBrief
          </h1>
          <p className="text-xl md:text-2xl text-muted-foreground italic mb-8">
            Automated Weather Forecasts for YouTube
          </p>
          <p className="text-lg text-muted-foreground mb-10 leading-relaxed">
            SkyBrief automatically generates and posts daily weather forecast videos to
            YouTube Shorts. Our AI-powered platform creates professional weather content
            for multiple cities with zero manual effort.
          </p>
          <Link to="/dashboard">
            <Button size="lg" className="text-base px-8">Login to Dashboard</Button>
          </Link>
        </section>

        {/* Features */}
        <section className="mt-24">
          <h2 className="text-3xl font-bold mb-10 text-center">Features</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: Cloud, title: "Daily Automated Posts", desc: "Morning, afternoon, and evening forecasts published automatically." },
              { icon: Mic, title: "Professional Voiceover", desc: "AI-generated natural voice narration on every clip." },
              { icon: Film, title: "Cinematic Visuals", desc: "Dynamic weather-appropriate backgrounds and overlays." },
              { icon: MapPin, title: "Multi-City Coverage", desc: "Scalable to any location you want to broadcast." },
              { icon: Youtube, title: "YouTube Integration", desc: "Direct posting to your YouTube Shorts channel." },
              { icon: BarChart3, title: "Performance Analytics", desc: "Track views, engagement, and growth over time." },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="glass-card p-6 rounded-xl">
                <Icon className="h-8 w-8 text-primary mb-3" />
                <h3 className="font-semibold mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* How It Works */}
        <section className="mt-24 max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-10 text-center">How It Works</h2>
          <ol className="space-y-4">
            {[
              "We fetch real-time weather data for your cities",
              "AI generates professional forecast scripts",
              "Videos are rendered with voiceover and visuals",
              "Content automatically posts to your YouTube Shorts channel",
              "Analytics track performance and engagement",
            ].map((step, i) => (
              <li key={i} className="flex gap-4 items-start glass-card p-4 rounded-lg">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-semibold">
                  {i + 1}
                </span>
                <span className="pt-1">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* YouTube Permissions */}
        <section className="mt-24 max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold mb-6 text-center">YouTube Permissions</h2>
          <div className="glass-card p-6 rounded-xl">
            <p className="text-muted-foreground mb-4">
              SkyBrief connects to your YouTube channel to upload weather videos automatically.
              We request the following permissions:
            </p>
            <ul className="space-y-2 list-disc list-inside text-muted-foreground mb-4">
              <li>Upload videos to your channel</li>
              <li>Manage uploaded content</li>
              <li>Read basic channel information</li>
            </ul>
            <p className="text-muted-foreground">
              These permissions allow us to post your daily weather forecasts without manual intervention.
            </p>
          </div>
        </section>

        {/* CTA */}
        <section className="mt-24 text-center">
          <h2 className="text-3xl font-bold mb-4">Get Started</h2>
          <Link to="/dashboard">
            <Button size="lg" className="text-base px-8">Login to Dashboard</Button>
          </Link>
        </section>
      </main>

      <footer className="border-t border-border/40 mt-16">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex gap-6">
            <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
          </div>
          <div>© 2026 SkyBrief Weather</div>
        </div>
      </footer>
    </div>
  );
}
