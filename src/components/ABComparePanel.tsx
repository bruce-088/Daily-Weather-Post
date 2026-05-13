import type { VariantPayload, ExperimentType } from "@/lib/abVariants";
import { EXPERIMENT_TYPE_LABELS } from "@/lib/abVariants";
import { ExperimentBadge } from "@/components/ExperimentBadge";

interface VariantCardProps {
  label: "A" | "B";
  payload: VariantPayload;
  type: ExperimentType;
}

function VariantCard({ label, payload, type }: VariantCardProps) {
  const fields: Array<[string, string | undefined]> = [];
  if (type === "hook_test") {
    fields.push(["Hook line", payload.hook_line]);
    fields.push(["Headline", payload.hook_headline]);
    fields.push(["Emphasis", payload.hook_emphasis]);
  } else if (type === "cta_test") {
    fields.push(["CTA text", payload.cta_text]);
    fields.push(["Voice line", payload.cta_voice_line]);
    fields.push(["Animation", payload.cta_animation]);
  } else {
    fields.push(["Background", payload.background_style]);
    fields.push(["Motion", payload.motion_treatment]);
    fields.push(["Particles", payload.particle_overlay]);
  }

  return (
    <div className="flex-1 min-w-0 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-center justify-between mb-2">
        <ExperimentBadge kind={label} />
        {payload.label && (
          <span className="text-[11px] text-muted-foreground truncate ml-2">{payload.label}</span>
        )}
      </div>
      <dl className="space-y-1.5">
        {fields.map(([k, v]) => (
          <div key={k} className="text-[11px]">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-foreground/90 font-mono break-words">{v || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export interface ABComparePanelProps {
  type: ExperimentType;
  variantA: VariantPayload;
  variantB: VariantPayload;
}

export function ABComparePanel({ type, variantA, variantB }: ABComparePanelProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {EXPERIMENT_TYPE_LABELS[type]} — variants
        </div>
        <ExperimentBadge kind="testing" />
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <VariantCard label="A" payload={variantA} type={type} />
        <VariantCard label="B" payload={variantB} type={type} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Both variants run through the same job pipeline. Only the fields above differ — every other
        element (weather, voice, duration) stays identical.
      </p>
    </div>
  );
}
