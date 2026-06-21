import { Bot, X } from "lucide-react";

export function DeployModalHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-6 py-5 border-b border-border">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
          <Bot size={17} className="text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-foreground">Deploy Bidding Agent</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Auto-bid posted jobs — résumé matched per JD</p>
        </div>
      </div>
      <button onClick={onClose} className="w-8 h-8 rounded-xl bg-secondary hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
        <X size={16} />
      </button>
    </div>
  );
}
