"use client";

import { useFormStatus } from "react-dom";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SendClarificationButton() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="brand" size="sm" disabled={pending}>
      <Send className="h-3.5 w-3.5" />
      {pending ? "Sending..." : "Send to agent"}
    </Button>
  );
}
