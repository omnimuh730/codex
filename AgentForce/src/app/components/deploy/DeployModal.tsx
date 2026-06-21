import { Loader2, Zap } from "lucide-react";
import type { DeployOptions } from "../../types";
import { AppButton, AppInput } from "../primitives";
import { DeployModalHeader } from "./DeployModalHeader";
import { DeployFormFields } from "./DeployFormFields";
import { AutoSubmitToggle } from "./AutoSubmitToggle";
import { useDeployForm } from "./useDeployForm";

export function DeployModal({ onClose, onDeploy }: {
  onClose: () => void;
  onDeploy: (opts: DeployOptions) => Promise<void> | void;
}) {
  const form = useDeployForm(onDeploy);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 sm:p-0">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 bg-card rounded-3xl border border-border w-full max-w-lg" style={{ boxShadow: "var(--shadow-xl)" }}>
        <DeployModalHeader onClose={onClose} />

        <form onSubmit={form.handleSubmit} className="px-6 py-5 space-y-4">
          <AppInput label="Agent Name" value={form.name} onChange={form.setName} placeholder="e.g. React Full Stack apply" required />

          <DeployFormFields
            profiles={form.profiles}
            profileId={form.profileId}
            setProfileId={form.setProfileId}
            models={form.models}
            model={form.model}
            setModel={form.setModel}
            loadingMeta={form.loadingMeta}
            sources={form.sources}
            source={form.source}
            setSource={form.setSource}
            startIndex={form.startIndex}
            setStartIndex={form.setStartIndex}
            endIndex={form.endIndex}
            setEndIndex={form.setEndIndex}
            posted={form.posted}
            sourceTitle={form.source}
            rangeCount={form.rangeCount}
          />

          <AutoSubmitToggle autoSubmit={form.autoSubmit} onToggle={() => form.setAutoSubmit(v => !v)} />

          {form.err && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{form.err}</p>
          )}

          <div className="flex gap-3 pt-1">
            <AppButton variant="default" className="flex-1" onClick={onClose}>Cancel</AppButton>
            <AppButton variant="primary" className="flex-1" type="submit" disabled={form.loading || !form.valid || form.loadingMeta}>
              {form.loading ? <><Loader2 size={13} className="animate-spin" />Launching…</> : <><Zap size={13} />Deploy Agent</>}
            </AppButton>
          </div>
        </form>
      </div>
    </div>
  );
}
