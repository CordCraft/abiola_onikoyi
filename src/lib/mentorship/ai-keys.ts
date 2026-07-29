import "server-only";

// Site-wide AI API keys, set once in the environment (Netlify env vars) and
// usable anywhere on the server: mentorship toolkit, Jarvis, blog tooling.
// A mentee-specific key stored on their MentorshipAiTool row always wins;
// these are the shared defaults handed out when the mentor grants a tool
// without pasting a dedicated key.

export function sharedKeyFor(tool: string): string | null {
  switch (tool) {
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY || null;
    case "openai":
      return process.env.OPENAI_API_KEY || null;
    case "fal":
      return process.env.FALAI_API_KEY || process.env.FAL_KEY || null;
    default:
      return null;
  }
}
