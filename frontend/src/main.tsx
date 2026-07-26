import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root 엘리먼트를 찾지 못했습니다');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
