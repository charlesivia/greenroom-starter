# Pre-flight Deal Review: Closing the Gap Before Settlement

I did not build a better settlement calculator. The existing calculator is downstream of the real problem. I built the step before settlement: a pre-flight workflow that catches ambiguous deal language early, gets the agent's interpretation before show night, and carries that interpretation into settlement. The wedge is small: two detectors, a weekly queue, a show-level review section, a send-and-record flow, and a settlement handoff.

Settlement disputes are often born before show night. The deal does not live in one clean object. It lives across structured fields, free-text prose, spreadsheets, agent email, and venue memory. The data made that concrete. Of 30 disputed or revised settlements at The Crescent, 30 had positive TM `signoff_text`. The system captured the in-the-room tour manager signoff, but not the next-morning agent review. The dispute was not that the TM refused the settlement at 2 a.m. The dispute was that the agent later read the deal differently. That changed the solution: pre-flight is not just "Mariana resolves ambiguity early." It is "the agent acknowledges the interpretation before show night."

Greenroom can only settle what it can represent. If a deal says "marketing recoup against gross; expenses capped at $1,350," the system needs to know whether the recoup sits inside or outside the cap. If a deal says there is a walkout bonus but `bonuses_json` is empty, the math engine cannot trigger it. By the time Mariana is settling at 2 a.m., the conversation is downstream of the failure. The right move is to pull that ambiguity earlier, while the agent can still confirm the intended interpretation.

What shipped is a complete narrow workflow. The full loop: Mariana opens `/shows` on Wednesday morning, sees `show_0141` in the THIS WEEK queue, clicks Review, sends the clarification, records the reply, and sees the resolved interpretation on the settle page. On `/shows`, the queue surfaces upcoming shows in the next seven local-calendar days with unresolved clarifications. In the demo state, `show_0141` appears with a high-severity marketing recoup × cap issue. The row links to the show detail page.

On the show detail page, the Pre-flight deal review section sits right after Deal terms. Mariana first reads what was negotiated, then sees the interpretation risk. `show_0141` shows the active marketing case. `show_0167` shows active bonus drift. `show_0056` shows the all-clear state: no pre-flight clarifications are recorded for that deal.

The interaction is intentionally small. Mariana can send a pending clarification to the agent, which moves it to `sent_to_agent`. When she has the reply, she records it. That marks the clarification `resolved`, stores the reply text, and sets `resolvedVia = in_app_reply`. On `/shows/show_0141/settle`, the settlement page shows a quiet "Pre-flight clarifications" block with the resolved interpretation and recorded reply. The settlement math does not change. The handoff gives Mariana provenance while she checks the worksheet.

The shipped detectors are narrow. `marketing_recoup_cap` catches deal prose where a marketing recoup intersects with an expense cap. `bonus_structure_drift` catches bonus-related prose when `bonuses_json` is missing. `show_0064` was a false positive for marketing after the first implementation, but it is a true positive for bonus drift. That helped keep the classes separate.

The architectural principle is: use the LLM to find ambiguous language, but use deterministic code to decide when the model is allowed to matter.

The marketing detector shows this clearly. Before the LLM runs, the deal must have an `expenseCap`, and the prose must contain "recoup" or "marketing." After the model returns, the detected phrase must be a literal substring of the deal prose, and that phrase must still contain "recoup" or "marketing." Citations are restricted to supplied context, and the target show is excluded from its own precedent set.

The bonus detector uses the same discipline. It only runs when `bonusesJson` is null and the prose contains bonus language such as "bonus," "walkout," "threshold," "gross above," "over $," or "pot." The returned phrase must be a literal substring and must contain one of those terms. It does not force weak precedent citations because the data overlap is thin. This card is about missing structure, not historical dispute volume.

Mid-build, I made the same call on clarification copy. The model can identify the risky phrase and citations, but the suggested clarification text is deterministic so Mariana sees consistent, reviewable language.

The important debug moment was the first marketing regression. The model produced three false positives across five test cases, a 60% false-positive rate, because it fired on expense-cap language alone. `show_0064`, `show_0001`, and `show_0010` all came back incorrectly. The literal substring guard helped, but it was not enough because phrases like "Expenses capped $2350" really were in the prose. They just were not marketing recoup phrases. I added deterministic gates before and after the model call, then reran the regression suite before moving to bonus drift.

The cuts were deliberate.

First, I cut `agent_risk_pattern`. The seed data points toward Daniel Hwang's marketing pushback pattern, but two detectors plus the operational queue proved the product loop with more depth than a third detector would have.

Second, I cut dismiss. Send, record, and resolve are the critical path. Dismiss adds audit complexity, but does not prove the main workflow.

Third, I cut email integration. The state transition proves the product behavior without external plumbing.

Fourth, I cut row dots and the expandable queue footer. The weekly queue already creates the operational entry point.

Fifth, I cut settlement math changes. V1 should show provenance, not alter payout math. Changing payouts based on a new AI workflow would be the wrong first proof.

V2 is where this becomes more powerful. Each resolved clarification is structured training data. Greenroom can learn which ambiguity classes cost money, which agents need earlier clarification, and which phrases should become structured fields instead of free text. Production overages can become another detector. Agent risk can be added once the workflow has enough confirmed outcomes. Eventually, resolved clarifications can inform the math engine, after the product has earned trust.

This is not "AI settlement." It is the missing handoff between negotiation and settlement. Two detectors prove the gap is detectable. The THIS WEEK queue makes it part of the operating rhythm. The show detail flow gets an interpretation recorded. The settlement handoff makes that interpretation useful when Mariana is settling the show at 2 a.m.
