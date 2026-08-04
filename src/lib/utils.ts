import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path);
}

/** True when the path is an image or PDF that the preview pane can render. */
export function isPreviewableFilePath(path: string): boolean {
  return /\.(png|jpe?g|gif|svg|webp|bmp|ico|pdf)$/i.test(path);
}
