import { Nav } from "@/components/site/Nav";
import { Footer } from "@/components/site/Footer";
import {
  Hero,
  About,
  Experience,
  Skills,
  Education,
  Contact,
} from "@/components/site/Sections";

export default function Home() {
  return (
    <>
      <Nav />
      <main className="flex-1">
        <Hero />
        <About />
        <Experience />
        <Skills />
        <Education />
        <Contact />
      </main>
      <Footer />
    </>
  );
}
