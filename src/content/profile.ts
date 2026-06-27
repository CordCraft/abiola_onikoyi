// ---------------------------------------------------------------------------
// All public, LinkedIn-style content for the site lives here.
// Edit this one file to update your name, bio, experience, skills, etc.
// (The private projects area is managed separately through the admin panel.)
// ---------------------------------------------------------------------------

export type ExperienceItem = {
  company: string;
  role: string;
  start: string; // e.g. "2021"
  end: string; // e.g. "Present"
  location?: string;
  summary?: string;
  highlights?: string[];
};

export type EducationItem = {
  school: string;
  credential: string; // degree / certificate
  field?: string;
  start?: string;
  end?: string;
  details?: string;
};

export type SkillGroup = {
  category: string;
  items: string[];
};

export type SocialLink = {
  label: string;
  href: string;
};

export type Profile = {
  name: string;
  initials: string;
  headline: string; // short professional title
  tagline: string; // one-sentence summary under the headline
  location: string;
  email: string;
  // Path to a photo in /public. Leave as the placeholder until you add one.
  photo: string | null;
  about: string[]; // each string is a paragraph
  socials: SocialLink[];
  experience: ExperienceItem[];
  education: EducationItem[];
  skills: SkillGroup[];
};

// NOTE: The values below are professional placeholders. Replace them with the
// real details from your LinkedIn profile (or send them to me and I'll fill
// them in). Anything you leave blank simply won't show on the site.
export const profile: Profile = {
  name: "Abiola Onikoyi",
  initials: "AO",
  headline: "Entrepreneur & Technology Leader",
  tagline:
    "Building ventures at the intersection of technology, data, and people.",
  location: "United Kingdom",
  email: "hello@abiolaonikoyi.com",
  photo: "/photo.jpg",

  about: [
    "I'm a technology leader and entrepreneur focused on turning ambitious ideas into products that create real-world value. My work spans strategy, product, and execution.",
    "This site is a living overview of my professional background. The private area collects the entrepreneurial projects I'm actively building, with regular updates on their progress.",
  ],

  socials: [
    { label: "LinkedIn", href: "https://www.linkedin.com/in/" },
    { label: "Email", href: "mailto:hello@abiolaonikoyi.com" },
  ],

  experience: [
    {
      company: "Company Name",
      role: "Your Role / Title",
      start: "2022",
      end: "Present",
      location: "City, Country",
      summary:
        "One or two lines describing what you do here and the impact you've had.",
      highlights: [
        "A notable achievement or responsibility.",
        "Another measurable result or initiative you led.",
      ],
    },
    {
      company: "Previous Company",
      role: "Previous Role",
      start: "2019",
      end: "2022",
      location: "City, Country",
      summary: "Short description of the role and your contributions.",
      highlights: ["Key accomplishment.", "Key accomplishment."],
    },
  ],

  education: [
    {
      school: "University Name",
      credential: "Degree (e.g. BSc)",
      field: "Field of Study",
      start: "2015",
      end: "2018",
      details: "Optional notes — honours, focus areas, activities.",
    },
  ],

  skills: [
    {
      category: "Leadership",
      items: ["Strategy", "Product Management", "Team Building", "Fundraising"],
    },
    {
      category: "Technology",
      items: ["Software Architecture", "Data & Analytics", "Cloud", "AI / ML"],
    },
    {
      category: "Business",
      items: ["Go-to-Market", "Operations", "Partnerships", "Finance"],
    },
  ],
};
