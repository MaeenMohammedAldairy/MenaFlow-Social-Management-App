import path from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";

const DEFAULT_BUCKET = "whatsapp-media";
const MAX_THUMBNAIL_EDGE = 640;

type SupabaseStorageConfig = {
  baseUrl: string;
  serviceRoleKey: string;
  bucket: string;
};

function storageConfig(): SupabaseStorageConfig | null {
  const baseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || DEFAULT_BUCKET;
  if (!baseUrl && !serviceRoleKey) return null;
  if (!baseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_STORAGE_CONFIGURATION_INCOMPLETE");
  }
  const parsed = new URL(baseUrl);
  if (parsed.username || parsed.password || !/^[A-Za-z0-9._-]+$/.test(bucket)) {
    throw new Error("SUPABASE_STORAGE_CONFIGURATION_INVALID");
  }
  if (parsed.protocol !== "https:" && process.env.NODE_ENV !== "development") {
    throw new Error("SUPABASE_STORAGE_REQUIRES_HTTPS");
  }
  return { baseUrl: parsed.origin, serviceRoleKey, bucket };
}

export function resolveWhatsAppMediaStorageRoot(): string {
  const configured = process.env.WHATSAPP_MEDIA_STORAGE_DIR?.trim();
  if (configured) return path.resolve(configured);

  const cwd = process.cwd();
  if (path.basename(cwd) === "api-server" || cwd.endsWith(path.join("artifacts", "api-server"))) {
    return path.resolve(cwd, "storage", "whatsapp");
  }
  return path.resolve(cwd, "artifacts", "api-server", "storage", "whatsapp");
}

export function assertMediaObjectPath(objectPath: string): void {
  if (
    !objectPath ||
    objectPath.startsWith("/") ||
    objectPath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error("INVALID_MEDIA_OBJECT_PATH");
  }
}

function objectUrl(config: SupabaseStorageConfig, objectPath: string): string {
  assertMediaObjectPath(objectPath);
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  return `${config.baseUrl}/storage/v1/object/${encodeURIComponent(config.bucket)}/${encodedPath}`;
}

function storageHeaders(config: SupabaseStorageConfig, contentType?: string) {
  return {
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
}

export async function storeMediaObject(
  objectPath: string,
  buffer: Buffer,
  contentType: string,
): Promise<"supabase" | "local"> {
  assertMediaObjectPath(objectPath);
  const config = storageConfig();
  if (!config) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SUPABASE_STORAGE_CONFIGURATION_REQUIRED");
    }
    return "local";
  }

  const response = await fetch(objectUrl(config, objectPath), {
    method: "POST",
    headers: {
      ...storageHeaders(config, contentType),
      "x-upsert": "true",
      "cache-control": "31536000",
    },
    body: buffer,
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`SUPABASE_STORAGE_UPLOAD_HTTP_${response.status}`);
  }
  return "supabase";
}

export async function readMediaObject(objectPath: string): Promise<Buffer> {
  const { stream } = await streamMediaObject(objectPath);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function streamMediaObject(
  objectPath: string,
): Promise<{ stream: Readable; contentLength: string | null }> {
  const config = storageConfig();
  if (!config) throw new Error("SUPABASE_STORAGE_CONFIGURATION_REQUIRED");
  const response = await fetch(objectUrl(config, objectPath), {
    headers: storageHeaders(config),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`SUPABASE_STORAGE_READ_HTTP_${response.status}`);
  }
  if (!response.body) throw new Error("SUPABASE_STORAGE_RESPONSE_BODY_MISSING");
  return {
    stream: Readable.fromWeb(response.body),
    contentLength: response.headers.get("content-length"),
  };
}

export async function hasMediaObject(objectPath: string): Promise<boolean> {
  const config = storageConfig();
  if (!config) throw new Error("SUPABASE_STORAGE_CONFIGURATION_REQUIRED");
  const response = await fetch(objectUrl(config, objectPath), {
    method: "HEAD",
    headers: storageHeaders(config),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(`SUPABASE_STORAGE_CHECK_HTTP_${response.status}`);
  }
  return true;
}

export async function createMediaThumbnail(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer, { failOn: "error", limitInputPixels: 100_000_000 })
    .rotate()
    .resize({
      width: MAX_THUMBNAIL_EDGE,
      height: MAX_THUMBNAIL_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 76, effort: 3 })
    .toBuffer();
}

export function thumbnailObjectPath(objectPath: string): string {
  const extension = path.posix.extname(objectPath);
  return `${objectPath.slice(0, -extension.length)}.thumb.webp`;
}
