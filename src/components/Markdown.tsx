import ReactMarkdown from "react-markdown";

// Renders user-authored markdown for project updates with sensible styling.
// react-markdown sanitizes by not rendering raw HTML by default, so this is
// safe to use with stored content.
export function Markdown({ children }: { children: string }) {
  return (
    <div className="space-y-3 text-zinc-700">
      <ReactMarkdown
        components={{
          h1: (props) => (
            <h1 className="text-xl font-bold text-zinc-900" {...props} />
          ),
          h2: (props) => (
            <h2 className="text-lg font-bold text-zinc-900" {...props} />
          ),
          h3: (props) => (
            <h3 className="text-base font-semibold text-zinc-900" {...props} />
          ),
          p: (props) => <p className="leading-relaxed" {...props} />,
          ul: (props) => (
            <ul className="list-disc space-y-1 pl-5 marker:text-zinc-300" {...props} />
          ),
          ol: (props) => (
            <ol className="list-decimal space-y-1 pl-5" {...props} />
          ),
          a: (props) => (
            <a
              className="font-medium text-accent underline underline-offset-2"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            />
          ),
          code: (props) => (
            <code
              className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-sm text-zinc-800"
              {...props}
            />
          ),
          blockquote: (props) => (
            <blockquote
              className="border-l-2 border-zinc-300 pl-4 italic text-zinc-600"
              {...props}
            />
          ),
          strong: (props) => (
            <strong className="font-semibold text-zinc-900" {...props} />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
