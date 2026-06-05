export function SectionHeader({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-accent">{eyebrow}</p>
      <h2 className="mt-3 font-serif text-3xl tracking-tight text-ink sm:text-4xl">{title}</h2>
      {lead ? <p className="mt-4 text-lg leading-relaxed text-ink-soft">{lead}</p> : null}
    </div>
  );
}
