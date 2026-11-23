import { AuthPanel } from "./auth-panel";

export default function Home() {
  return (
    <main>
      <header className="page-header">
        <h1><span className="brand-zenith">Zenith</span> Stats</h1>
        <p>Estadísticas personales de Riftbound</p>
      </header>
      <AuthPanel />
    </main>
  );
}
