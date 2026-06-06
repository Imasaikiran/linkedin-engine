import { Nav } from "../components/site/Nav";
import { Hero } from "../components/site/Hero";
import { Problem } from "../components/site/Problem";
import { HowItWorks } from "../components/site/HowItWorks";
import { Impact } from "../components/site/Impact";
import { TryIt } from "../components/site/TryIt";
import { Footer } from "../components/site/Footer";

export const revalidate = 60;

export default function Page() {
  return (
    <main>
      <Nav />
      <Hero />
      <Problem />
      <HowItWorks />
      <Impact />
      <TryIt />
      <Footer />
    </main>
  );
}
