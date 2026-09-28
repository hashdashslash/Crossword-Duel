import { GamePage } from './game/GamePage';
import { Home } from './Home';
import { usePath } from './lib/router';
import { Practice } from './Practice';
import { Daily } from './Daily';
import { Account } from './Account';

export function App() {
  const path = usePath();
  const game = path.match(/^\/g\/([A-Za-z]{4})\/?$/);
  if (game) return <GamePage key={game[1]!.toUpperCase()} code={game[1]!.toUpperCase()} />;
  if (path.startsWith('/practice')) return <Practice />;
  if (path.startsWith('/daily')) return <Daily />;
  if (path === '/signin' || path === '/signup') return <Account key={path} mode={path === '/signup' ? 'signup' : 'signin'} />;
  return <Home />;
}
