import ReactMarkdown from "react-markdown";

type Tone = "light" | "dark";

// Renders user-authored markdown. react-markdown does not render raw HTML by
// default, so stored content is safe. `tone` switches the palette between the
// light admin dashboard and the dark public site.
export function Markdown({
  children,
  tone = "light",
}: {
  children: string;
  tone?: Tone;
}) {
  const dark = tone === "dark";
  const heading = dark ? "text-white" : "text-zinc-900";
  const strong = dark ? "text-white" : "text-zinc-900";
  const codeBg = dark ? "bg-white/10 text-zinc-100" : "bg-zinc-100 text-zinc-800";
  const quote = dark
    ? "border-white/20 text-zinc-300"
    : "border-zinc-300 text-zinc-600";
  const marker = dark ? "marker:text-accent/60" : "marker:text-zinc-300";

  return (
    <div className={`space-y-4 ${dark ? "text-zinc-300" : "text-zinc-700"}`}>
      <ReactMarkdown
        components={{
          h1: (props) => <h1 className={`text-2xl font-bold ${heading}`} {...props} />,
          h2: (props) => <h2 className={`text-xl font-bold ${heading}`} {...props} />,
          h3: (props) => <h3 className={`text-lg font-semibold ${heading}`} {...props} />,
          p: (props) => <p className="leading-relaxed" {...props} />,
          ul: (props) => (
            <ul className={`list-disc space-y-1 pl-5 ${marker}`} {...props} />
          ),
          ol: (props) => <ol className="list-decimal space-y-1 pl-5" {...props} />,
          a: (props) => (
            <a
              className="font-medium text-accent underline underline-offset-2"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            />
          ),
          code: (props) => (
            <code className={`rounded px-1.5 py-0.5 font-mono text-sm ${codeBg}`} {...props} />
          ),
          blockquote: (props) => (
            <blockquote className={`border-l-2 pl-4 italic ${quote}`} {...props} />
          ),
          strong: (props) => <strong className={`font-semibold ${strong}`} {...props} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
