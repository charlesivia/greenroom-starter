"use client";

import { useFormStatus } from "react-dom";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

function SaveReplyButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="brand" size="sm" disabled={pending}>
      <CheckCircle2 className="h-3.5 w-3.5" />
      {pending ? "Saving..." : "Save reply"}
    </Button>
  );
}

export function RecordReplyForm({
  action,
  clarificationId,
  showId,
}: {
  action: (formData: FormData) => void | Promise<void>;
  clarificationId: string;
  showId: string;
}) {
  return (
    <form action={action} className="mt-4 space-y-2">
      <input type="hidden" name="clarificationId" value={clarificationId} />
      <input type="hidden" name="showId" value={showId} />
      <div>
        <div className="eyebrow text-[10px] text-ink-500 mb-1.5">
          Agent reply
        </div>
        <textarea
          name="agentReplyText"
          required
          rows={2}
          placeholder="Paste or summarize the agent reply"
          className="w-full rounded-lg bg-white/90 px-3 py-2 text-[12.5px] text-ink-900 ring-1 ring-ink-200/70 outline-none transition focus:ring-2 focus:ring-brand-600/40"
        />
      </div>
      <SaveReplyButton />
    </form>
  );
}
