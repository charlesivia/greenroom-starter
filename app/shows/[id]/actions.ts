"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { dealClarifications } from "@/db/schema";

export async function sendClarificationToAgent(formData: FormData) {
  const clarificationId = String(formData.get("clarificationId") ?? "");
  const showId = String(formData.get("showId") ?? "");

  if (!clarificationId || !showId) {
    throw new Error("Missing clarificationId or showId");
  }

  await db
    .update(dealClarifications)
    .set({
      status: "sent_to_agent",
      sentToAgentAt: new Date(),
    })
    .where(
      and(
        eq(dealClarifications.id, clarificationId),
        eq(dealClarifications.status, "pending"),
      ),
    );

  revalidatePath(`/shows/${showId}`);
}

export async function recordClarificationReply(formData: FormData) {
  const clarificationId = String(formData.get("clarificationId") ?? "");
  const showId = String(formData.get("showId") ?? "");
  const agentReplyText = String(formData.get("agentReplyText") ?? "").trim();

  if (!clarificationId || !showId) {
    throw new Error("Missing clarificationId or showId");
  }

  if (!agentReplyText) {
    throw new Error("Agent reply is required");
  }

  await db
    .update(dealClarifications)
    .set({
      status: "resolved",
      agentReplyText,
      resolvedAt: new Date(),
      resolvedVia: "in_app_reply",
    })
    .where(
      and(
        eq(dealClarifications.id, clarificationId),
        eq(dealClarifications.status, "sent_to_agent"),
      ),
    );

  revalidatePath(`/shows/${showId}`);
}
