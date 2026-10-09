import Image from 'next/image';
import { initials } from '@/lib/photo';

/** A flatmate's photo, or their initials on turmeric when there is none, so nobody looks unfinished. Decorative: the name is always next to it. */
export function Avatar({ id, name, v, size = 36 }: { id: string; name: string; v: number | null; size?: number }) {
  const box = { width: size, height: size };
  if (v !== null) return <Image src={`/api/photo/${id}?v=${v}`} alt="" width={size} height={size} unoptimized className="shrink-0 rounded-full object-cover" style={box} />;
  return (
    <span aria-hidden="true" className="grid shrink-0 place-items-center rounded-full bg-turmeric font-bold leading-none text-on-turmeric" style={{ ...box, fontSize: size * 0.4 }}>
      {initials(name)}
    </span>
  );
}
