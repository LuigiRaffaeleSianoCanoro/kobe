// Shared by the browser, the upload route and the importer. A WhatsApp export without media is far smaller.
export const MAX_EXPORT_BYTES = 50 * 1024 * 1024;
export const TOO_LARGE = "This file is larger than 50 MB. Export the chat again and choose Without media.";
