import Link from "next/link";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PlainBadge } from "@/components/ui/badge";
import { formatShowDate } from "@/lib/format";
import { getThisWeekPreFlightQueue } from "@/lib/queries";

export async function PreFlightQueueSection() {
  const queue = await getThisWeekPreFlightQueue();
  const count = queue.items.length;

  if (count === 0) {
    return (
      <Card className="mb-10">
        <CardHeader>
          <div>
            <CardTitle>THIS WEEK · PRE-FLIGHT · all clear</CardTitle>
            <CardDescription>
              Checked {queue.checkedShowCount} upcoming{" "}
              {queue.checkedShowCount === 1 ? "show" : "shows"}. No unresolved
              pre-flight clarifications recorded.
            </CardDescription>
          </div>
          <PlainBadge variant="brand">All clear</PlainBadge>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3 rounded-lg bg-canvas-soft ring-1 ring-ink-200/50 p-4">
            <CheckCircle2 className="h-4 w-4 text-brand-700 mt-0.5 shrink-0" />
            <div className="text-[12.5px] text-ink-500 leading-relaxed">
              New pending or awaiting-reply clarifications will appear here for
              shows in the next 7 calendar days.
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card accent="amber" className="mb-10">
      <CardHeader>
        <div>
          <CardTitle>
            THIS WEEK · PRE-FLIGHT · {count}{" "}
            {count === 1 ? "show needs" : "shows need"} review
          </CardTitle>
          <CardDescription>
            {count} upcoming {count === 1 ? "show has" : "shows have"}{" "}
            unresolved deal ambiguities. Resolve before show night to avoid 2
            a.m. surprises.
          </CardDescription>
        </div>
        <PlainBadge variant="amber">{count} active</PlainBadge>
      </CardHeader>
      <CardContent className="divide-y divide-ink-100/80 py-0">
        {queue.items.map((item) => (
          <div
            key={item.showId}
            className="grid grid-cols-[auto_1fr_auto] items-center gap-4 py-4"
          >
            <PlainBadge variant={severityVariant(item.severity)}>
              {item.severity}
            </PlainBadge>

            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[12px] text-ink-500">
                <span className="font-medium text-ink-800">
                  {formatShowDate(item.date)}
                </span>
                <span>·</span>
                <span className="truncate">{item.artistName}</span>
                <PlainBadge
                  variant={item.status === "sent_to_agent" ? "sky" : "amber"}
                  className="ml-1"
                >
                  {item.status === "sent_to_agent" ? "Awaiting reply" : "Pending"}
                </PlainBadge>
              </div>
              <div className="mt-1 text-[13px] font-medium text-ink-900 leading-snug line-clamp-2">
                {item.leadSentence}
              </div>
              {item.otherUnresolvedCount > 0 && (
                <div className="mt-1 text-[11.5px] text-ink-400">
                  +{item.otherUnresolvedCount} more
                </div>
              )}
            </div>

            <Link
              href={`/shows/${item.showId}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[12px] font-medium text-ink-900 ring-1 ring-inset ring-ink-200/80 shadow-sm transition hover:bg-ink-50"
            >
              Review
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function severityVariant(
  severity: "high" | "medium" | "low",
): "rose" | "amber" | "default" {
  if (severity === "high") return "rose";
  if (severity === "medium") return "amber";
  return "default";
}
