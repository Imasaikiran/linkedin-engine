import { Nav } from "../../components/site/Nav";
import { DashboardSection } from "../../components/site/DashboardSection";
import { Footer } from "../../components/site/Footer";

export const revalidate = 60;

export const metadata = {
  title: "Run health - linkedin-engine",
  description: "Run stats for a self-hosted linkedin-engine instance.",
};

// Optional, unlinked route. Anyone who self-hosts and sets SUPABASE_URL +
// SUPABASE_ANON_KEY gets an at-a-glance health page for their own runs. It is
// intentionally not in the site nav: the public landing page is marketing, not
// the maintainer's stats.
export default function DashboardPage() {
  return (
    <main>
      <Nav />
      <DashboardSection />
      <Footer />
    </main>
  );
}
