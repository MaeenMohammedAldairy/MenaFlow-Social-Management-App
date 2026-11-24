# Product catalog

The workspace product catalog is the source of verified product facts for Meta
automatic replies. Apply `supabase/migrations/20261030001000_product_catalog.sql`
and `supabase/migrations/20261030002000_whatsapp_product_extraction.sql` to the
target database before deploying the API and mobile app; the API does not apply
migrations at startup.

Existing rows in `mena_posts` are not modified or automatically converted.
Published posts can be imported from the catalog screen. The import extracts
the product name, a source SKU when present, relevant aliases generated from
the product name and post context, description, price, currency, and
availability from the title and copy, while retaining media references and a
link to the source post. Extracted quotes must match the source text and each
required field must meet the extraction confidence threshold. A complete
published-post import is created as active and verified; incomplete imports
remain drafts for staff review. Review source facts before relying on an
imported product.

Only active products that have been explicitly verified are eligible as
catalog context for automatic replies. Price and currency come from the
dedicated catalog fields, availability comes from its explicit status, and
product descriptions and specifications come from reviewed catalog fields.
Marketing copy in old posts is not a trusted source for any of those facts.
Draft and archived products are excluded. Saving an active product records its
verification time; staff should update the record whenever its price or
availability changes.

Products and their linked posts are scoped to a workspace. Archiving a product
does not delete it or its post links, and it can be reactivated after review.
The product editor can upload up to 20 images or videos (20 MB per file) from
the device library. Uploaded files use the configured WhatsApp media storage
backend and remain attached to the product draft until removed.

## Extracting products from WhatsApp messages

After messages from selected groups are imported, they are queued for analysis
on their own: selecting a group is the merchant's opt-in to having that
conversation read, so a background pass fills the queue every minute for every
workspace with a selection (ten workspaces per pass, rotating). The catalog
screen's «تحليل الرسائل» button queues the same work by hand and, unlike the
automatic pass, also retries messages whose job had already failed. The API
queues up to 200 eligible messages per request; the extraction worker polls
every three seconds by default and claims up to three pending jobs per cycle.
A message is eligible when it has text or a caption, or — only if the deployment
enables extraction from images — when it has media at all. A photo sent with no
words attached is therefore read only where `PRODUCT_VISION_EXTRACTION_ENABLED`
is on; elsewhere it is counted in the queue state as a message with nothing
readable rather than being silently dropped.
The automatic pass never revives a settled job, never queues over a workspace
paused for an exhausted AI quota, and never re-selects a message that already
has a job row — see `docs/PRODUCT_PUBLICATION_RUNBOOK.md` §2. The configured AI provider may
group messages when they clearly refer to the same product. The AI receives
only source text, captions, and text-only conversation associations. It never
receives image or video bytes, media URLs, or media-derived descriptions.
Extracted facts retain a source quote and model confidence score; unsupported
quotes are discarded. Relevant aliases may be generated from the product name
and source context. Stored media attached to the source messages is still
linked to the resulting product draft and shown in the catalog; media still
downloading is allowed to finish before its source message is analyzed. Draft
media can be reviewed and removed in the product editor.

A currency is read strictly from the quoted source text: a three-letter code, or
a currency named with its nationality («ريال يمني», «الريال السعودي»). Two
different codes in one quote cancel out rather than one being picked. Only when
the quote holds an ambiguous word — «٤٥ ريال» — does the workspace's own country
settle it, and only if that country actually uses the word, so «٤٥ ريال» becomes
`YER` in Yemen and `SAR` in Saudi Arabia while «٤٥ دولار» in Yemen stays
unresolved rather than being guessed as `USD`. A currency settled from the
country always requires a human review before it can become a draft.

Only candidates with a name, description, price and currency, and explicit
availability, each with a matching source quote and confidence of at least
0.85, can automatically create a **draft** product. These products are not
verified or activated automatically. A repeated SKU or normalized exact
product name is flagged for review instead of creating a duplicate. Incomplete
suggestions stay in the review list; a staff member may create a draft from an
extracted name and complete or correct it before verification and activation.
Suggestions can be dismissed without deleting their source messages.

The model must classify every message in a batch as a product candidate or
non-product. Non-product classifications are kept — they are how a merchant can
see where a message went — but they are not review work, so the catalog lists
them in their own slice («ليست منتجات») instead of mixing them into the queue.
The review tab is split into three slices, each fetched from the server and each
paged 50 rows at a time: «بانتظار مراجعتك» (products awaiting a decision),
«تمت معالجتها» (drafts created and possible duplicates) and «ليست منتجات». The
tab badge counts the first slice only; it used to add scanned post candidates to
the number of rows on the page, which is why it could read 20 when two products
were waiting. Dismissed suggestions are not listed and cannot be requested.
Staff can rate each extracted field, the product classification, and
multi-message grouping as correct or incorrect. The catalog screen summarizes
the manually reviewed field-level rates for the latest 50 non-dismissed
suggestions. This is a reviewed sample, not a calibrated model score.

The queue state shown above the list also counts messages that were read and
held nothing extractable — a photo with no caption, a sticker, a voice note.
Their jobs completed successfully, so without that counter they simply vanish
from view; the screen says how many there are and that writing the product
description alongside the photo is what makes such a message readable.
Processed messages are not re-extracted by the automatic pass, which only ever
queues messages that have no job row yet; pressing «تحليل الرسائل» by hand does
retry messages whose job failed or that held no text, because that press is a
request to try again. Changing extraction rules for messages that already
succeeded will still require a separately reviewed reprocessing workflow. Queueing and worker batch limits bound processing.
AI grouping and confidence are suggestions, not proof: review source quotes,
especially for temporary prices, currencies, and availability, before
activating a product.
When the source has no SKU, the system generates a stable `MF-` SKU from the
source message IDs. Generated aliases are limited to names that share product
identity terms with the extracted name, and neither SKU nor aliases determine
whether an extraction is complete.

## Internal order management

The internal order workflow uses active, verified catalog products with an explicit
price and currency. Create an order from **المزيد > الطلبات** or from a Meta
conversation. Orders start as drafts and can move through confirmed, preparing,
shipped, and completed; drafts, confirmed orders, and orders being prepared may
also be cancelled. A shipped or completed order cannot be cancelled through
the current workflow.

Order items retain the product name, SKU, unit price, currency, and line total
as they were when the order was created. Updating a catalog price does not
change prior orders. Products in one order must use the same currency.
Order submissions use a workspace-scoped client request ID so retrying after a
network timeout does not create a duplicate order.
The current release records customer details and fulfillment progress only;
it does not collect payment, reserve stock, calculate shipping or taxes, or
send customer notifications. The order and status-change actor/timestamp are
workspace-scoped. Apply
`supabase/migrations/20261109001000_order_management.sql` before deploying the
API or mobile app.
