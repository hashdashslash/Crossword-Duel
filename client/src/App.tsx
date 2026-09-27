import { GamePage } from './game/GamePage';
import { Home } from './Home';
import { usePath } from './lib/router';
import { Practice } from './Practice';

export function App() {
  const path = usePath();
  const game = path.match(/^\/g\/([A-Za-z]{4})\/?$/);
  if (game) return <GamePage key={game[1]!.toUpperCase()} code={game[1]!.toUpperCase()} />;
  if (path.startsWith('/practice')) return <Practice />;
  return <Home />;
}
