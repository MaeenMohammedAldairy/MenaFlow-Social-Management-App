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

After messages from selected groups are imported, the catalog screen can queue
unprocessed messages for analysis. The API queues up to 200 eligible messages
per request; the background worker polls every three seconds by default and
claims up to three pending jobs per cycle. The configured AI provider may
group messages when they clearly refer to the same product. The AI receives
only source text, captions, and text-only conversation associations. It never
receives image or video bytes, media URLs, or media-derived descriptions.
Extracted facts retain a source quote and model confidence score; unsupported
quotes are discarded. Relevant aliases may be generated from the product name
and source context. Stored media attached to the source messages is still
linked to the resulting product draft and shown in the catalog; media still
downloading is allowed to finish before its source message is analyzed. Draft
media can be reviewed and removed in the product editor.

Only candidates with a name, description, price and currency, and explicit
availability, each with a matching source quote and confidence of at least
0.85, can automatically create a **draft** product. These products are not
verified or activated automatically. A repeated SKU or normalized exact
product name is flagged for review instead of creating a duplicate. Incomplete
suggestions stay in the review list; a staff member may create a draft from an
extracted name and complete or correct it before verification and activation.
Suggestions can be dismissed without deleting their source messages.

The model must classify every message in a batch as a product candidate or
non-product. Non-product classifications are also shown for review so missed
products can be counted. Staff can rate each extracted field, the product
classification, and multi-message grouping as correct or incorrect. The
catalog screen summarizes the manually reviewed field-level rates for the
latest 50 non-dismissed suggestions. This is a reviewed sample, not a calibrated
model score.
Processed messages are not automatically re-extracted by subsequent queue
requests; changing extraction rules will require a separately reviewed
reprocessing workflow. Queueing and worker batch limits bound processing.
AI grouping and confidence are suggestions, not proof: review source quotes,
especially for temporary prices, currencies, and availability, before
activating a product.
When the source has no SKU, the system generates a stable `MF-` SKU from the
source message IDs. Generated aliases are limited to names that share product
identity terms with the extracted name, and neither SKU nor aliases determine
whether an extraction is complete.
