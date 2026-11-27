/**
 * product-extraction-prompt-version.ts
 *
 * The version of the instruction the model was given.
 *
 * 37 of 47 stored suggestions in the live workspace recorded no model at all,
 * so there was no way to ask «did the rows before this date come from the old
 * instruction?» after changing one. Writing the version on every suggestion and
 * job makes a prompt change measurable instead of folklore: the metrics can
 * group by it, and a regression can be dated to a number.
 *
 * Bump it in one place, whenever the wording of the instruction changes in a way
 * that can change an answer — including a change to how the group's images are
 * described to it, since they now ride in this same request.
 *
 * `v3` is the single-call instruction. `v2` names the version whose photos were
 * read by a separate request and merged over the text answer, and `v1` anything
 * older; rows keep whatever version wrote them, so a comparison across the
 * change is a `group by`, not a guess.
 */
export const PRODUCT_EXTRACTION_PROMPT_VERSION = "v3";
