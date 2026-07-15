import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { SessionProvider } from './lib/session';
import { ToastProvider } from './components/toast';
import { TooltipProvider } from './components/ui';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: false } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ToastProvider>
          <TooltipProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </TooltipProvider>
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
