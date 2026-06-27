// ---------------------------------------------------------------------------
// All public, LinkedIn-style content for the site lives here.
// Edit this one file to update your name, bio, experience, skills, etc.
// (The private projects area is managed separately through the admin panel.)
// ---------------------------------------------------------------------------

export type ExperienceItem = {
  company: string;
  role: string;
  start: string;
  end: string;
  location?: string;
  summary?: string;
  highlights?: string[];
};

export type EducationItem = {
  school: string;
  credential: string;
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

export type PatentItem = {
  title: string;
  number: string;
  url: string;
  status: "Granted" | "Pending";
  year: string;
};

export type Stat = {
  value: string;
  label: string;
};

export type Profile = {
  name: string;
  initials: string;
  headline: string;
  tagline: string;
  location: string;
  email: string;
  photo: string | null;
  about: string[];
  stats: Stat[];
  socials: SocialLink[];
  experience: ExperienceItem[];
  education: EducationItem[];
  skills: SkillGroup[];
  patents: PatentItem[];
};

export const profile: Profile = {
  name: "Abiola Onikoyi",
  initials: "AO",
  headline: "Petroleum Engineer @ Saudi Aramco",
  tagline:
    "Petroleum engineer with 17+ years across reservoir management, well testing, and production optimization. Inventor on five US patents, and committed to delivering sustainable energy solutions.",
  location: "Riyadh, Saudi Arabia",
  email: "abiolaonikoyi@gmail.com",
  photo: "/photo.jpg",

  about: [
    "I'm a petroleum engineer in Saudi Aramco's Water Injection Unit, bringing over 17 years of expertise in reservoir management, well testing, and production optimization. My focus is on innovative solutions for efficient water injection and sustained reservoir performance.",
    "Prior experience at Shell gave me a strong foundation in wells and reservoir management, surveillance reviews, and intervention operations. I'm committed to delivering sustainable energy solutions by leveraging advanced technical skills and collaborating across functions to meet organisational objectives.",
    "Alongside my engineering work I'm an inventor on five US patents and an active builder of entrepreneurial ventures.",
  ],

  stats: [
    { value: "17+", label: "Years in petroleum engineering" },
    { value: "5", label: "US patents as inventor" },
    { value: "2", label: "Global energy majors" },
    { value: "MS", label: "Petroleum Engineering" },
  ],

  socials: [
    {
      label: "LinkedIn",
      href: "https://www.linkedin.com/in/abiola-onikoyi-97a37a36",
    },
    { label: "Email", href: "mailto:abiolaonikoyi@gmail.com" },
  ],

  experience: [
    {
      company: "Saudi Aramco",
      role: "Petroleum Engineer, Water Injection Unit",
      start: "Aug 2014",
      end: "Present",
      location: "Riyadh, Saudi Arabia",
      summary:
        "Driving reservoir management, well testing, and production optimization for one of the world's largest energy companies, with a focus on efficient water injection and reservoir performance.",
      highlights: [
        "Reservoir management and surveillance for water injection operations.",
        "Well testing, production optimization, and field development.",
        "Inventor on five US patents filed with Saudi Aramco spanning well testing, flow measurement, and machine learning.",
      ],
    },
    {
      company: "Shell",
      role: "Production Technologist",
      start: "Aug 2009",
      end: "Aug 2014",
      location: "Port Harcourt, Nigeria",
      summary:
        "Asset production technologist responsible for wells and reservoir performance, after completing the Shell Special Intensive Training Programme (SITP).",
      highlights: [
        "Wells and fields performance monitoring; reservoir management and surveillance reviews.",
        "Construction of integrated production system models for wells and reservoir management.",
        "Intervention, workover, and recompletion design and implementation.",
        "Maturation of locked-in opportunities; GOR and BS&W trending and management.",
      ],
    },
    {
      company: "Keystone Bank (Bank PHB)",
      role: "Senior Executive Assistant",
      start: "Nov 2008",
      end: "Aug 2009",
      location: "Abeokuta, Nigeria",
      highlights: ["Grew the branch deposit base by ₦1 billion in eight months."],
    },
    {
      company: "Zenith Bank",
      role: "Executive Assistant",
      start: "Mar 2007",
      end: "Nov 2008",
      location: "Nigeria",
      highlights: ["Grew the branch deposit base by ₦500 million in seven months."],
    },
  ],

  education: [
    {
      school: "London School of Management Technology",
      credential: "Doctorate of Business Administration (DBA)",
      end: "2025",
      details: "London, United Kingdom",
    },
    {
      school: "Heriot-Watt University",
      credential: "Master of Science (MS)",
      field: "Petroleum Engineering",
      start: "2013",
      end: "2015",
    },
    {
      school: "University of Lagos",
      credential: "Bachelor of Science (BS)",
      field: "Chemical Engineering",
      start: "2001",
      end: "2006",
    },
  ],

  skills: [
    {
      category: "Reservoir & Production",
      items: [
        "Reservoir Management",
        "Well Testing",
        "Production Optimization",
        "Field Development",
        "Water Injection",
        "Surveillance Reviews",
      ],
    },
    {
      category: "Operations",
      items: [
        "Intervention Operations",
        "Workover & Recompletion",
        "Integrated Production Modelling",
        "Wells & Reservoir Management",
      ],
    },
    {
      category: "Innovation",
      items: [
        "Patents & IP",
        "Machine Learning Applications",
        "Data Analysis",
        "Sustainable Energy Solutions",
      ],
    },
  ],

  patents: [
    {
      title:
        "Method and apparatus for drone conveyed single phase ultrasonic flowmeter",
      number: "US20250231056A1",
      url: "https://patents.google.com/patent/US20250231056A1/en",
      status: "Pending",
      year: "2025",
    },
    {
      title: "Systems and methods for flow rate validation in a well system",
      number: "US12163416B2",
      url: "https://patents.google.com/patent/US12163416B2/en",
      status: "Granted",
      year: "2024",
    },
    {
      title: "System for automated real-time water injection well testing",
      number: "US12000276B2",
      url: "https://patents.google.com/patent/US12000276B2/en",
      status: "Granted",
      year: "2024",
    },
    {
      title:
        "Method and apparatus for temporary sealing of flange leaks on industrial pipelines",
      number: "US20250237340A1",
      url: "https://patents.google.com/patent/US20250237340A1/en",
      status: "Pending",
      year: "2025",
    },
    {
      title:
        "Temperature profile prediction in oil and gas industry utilizing machine learning model",
      number: "US20240183255A1",
      url: "https://patents.google.com/patent/US20240183255A1/en",
      status: "Pending",
      year: "2024",
    },
  ],
};
