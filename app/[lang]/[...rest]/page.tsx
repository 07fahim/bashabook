import { notFound } from 'next/navigation';

// Any address under /bn or /en that no page owns: without this, Next shows its own English-only 404 instead of not-found.tsx.
export default function Missing() {
  notFound();
}
