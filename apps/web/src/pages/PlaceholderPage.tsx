interface PlaceholderPageProps {
  title: string;
  eyebrow: string;
  description: string;
}

export default function PlaceholderPage({
  title,
  eyebrow,
  description,
}: PlaceholderPageProps) {
  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-cyan-400/70">
        {eyebrow}
      </div>

      <h2 className="mt-2 text-3xl font-semibold tracking-tight">
        {title}
      </h2>

      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
        {description}
      </p>

      <div className="glass-panel mt-8 flex min-h-[420px] items-center justify-center rounded-2xl">
        <div className="text-center">
          <div className="font-mono-ui text-[10px] uppercase tracking-[0.2em] text-slate-600">
            MODULE
          </div>

          <div className="mt-2 text-sm text-slate-500">
            Interface under construction
          </div>
        </div>
      </div>
    </div>
  );
}