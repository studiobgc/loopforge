/**
 * Utility functions
 */

// Simple class name merger (replaces clsx)
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
