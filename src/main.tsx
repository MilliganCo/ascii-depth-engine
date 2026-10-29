import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import GameApp from './game/GameApp';
import './styles.css';

function Shell() {
  const [editor, setEditor] = useState(new URLSearchParams(location.search).get('editor') === '1');
  return editor ? <App onPlay={() => setEditor(false)} /> : <GameApp onEditor={() => setEditor(true)} />;
}
createRoot(document.getElementById('root')!).render(<Shell />);
