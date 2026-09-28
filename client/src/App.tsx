import { GamePage } from './game/GamePage';
import { Home } from './Home';
import { usePath } from './lib/router';
import { Practice } from './Practice';
import { Daily } from './Daily';
import { Account } from './Account';
import { GameReviewPage, HistoryPage, ProfilePage } from './History';
import { FriendsPage } from './Friends';
import { InviteToast } from './components/InviteToast';

export function App() {
  const path = usePath();
  // Invites pop up anywhere except inside a game (accepting would abandon it)
  // and the pages that already list them.
  const toast = !path.startsWith('/g/') && path !== '/' && path !== '/friends';
  return <>{page(path)}{toast && <InviteToast />}</>;
}

function page(path: string) {
  const game = path.match(/^\/g\/([A-Za-z]{4})\/?$/);
  if (game) return <GamePage key={game[1]!.toUpperCase()} code={game[1]!.toUpperCase()} />;
  if (path.startsWith('/practice')) return <Practice />;
  if (path.startsWith('/daily')) return <Daily />;
  if (path === '/history') return <HistoryPage />;
  if (path === '/friends') return <FriendsPage />;
  const review = path.match(/^\/games\/([\w-]+)\/?$/);
  if (review) return <GameReviewPage key={review[1]} id={review[1]!} />;
  const profile = path.match(/^\/u\/([A-Za-z0-9_]+)\/?$/);
  if (profile) return <ProfilePage key={profile[1]} username={profile[1]!} />;
  if (path === '/signin' || path === '/signup') return <Account key={path} mode={path === '/signup' ? 'signup' : 'signin'} />;
  return <Home />;
}
