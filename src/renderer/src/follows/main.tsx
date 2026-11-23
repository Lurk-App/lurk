import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { boot } from '../boot';
import '../styles.css';
import { FollowsApp } from './FollowsApp';

await boot();

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing');
createRoot(root).render(
  <StrictMode>
    <FollowsApp />
  </StrictMode>,
);
