import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { boot } from './boot';
import { Window } from './shell/Window';
import './styles.css';

const { info } = await boot();

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing');
createRoot(root).render(
  <StrictMode>
    <Window platform={info.platform} />
  </StrictMode>,
);
