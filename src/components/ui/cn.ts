import { clsx, type ClassValue } from "clsx";

/**
 * Join class names. There is no tailwind-merge in this project: pass variants through
 * component props instead of trying to override a component's own utilities via className.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
