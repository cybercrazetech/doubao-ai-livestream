import React from 'react';
import LiveSession from './components/LiveSession';

const App: React.FC = () => {
  const apiKey = process.env.API_KEY;

  if (!apiKey) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4 text-center">
        <h1 className="text-3xl font-bold mb-4 text-red-500">Configuration Error</h1>
        <p className="text-neutral-400 max-w-md">
          API Key not found. Please ensure <code>process.env.API_KEY</code> is configured in your environment.
        </p>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] w-full bg-neutral-950 flex flex-col overflow-hidden font-sans">
        
      {/* Header - Fixed Height */}
      <header className="flex-none w-full max-w-7xl mx-auto flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-tr from-blue-600 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/30">
             <svg className="w-5 h-5 sm:w-6 sm:h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
             </svg>
          </div>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-white tracking-tight">LiveVision AI</h1>
            <p className="hidden sm:block text-xs text-neutral-400">Powered by Gemini 2.5</p>
          </div>
        </div>
        
        <a 
          href="https://ai.google.dev" 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-xs font-medium text-neutral-500 hover:text-white transition-colors"
        >
          Docs &rarr;
        </a>
      </header>

      {/* Main Container - Flex-1 to take remaining height, min-h-0 to allow scrolling inside children */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 pb-4 sm:px-6 sm:pb-6 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 shadow-2xl shadow-black/50 rounded-2xl overflow-hidden ring-1 ring-white/10">
           <LiveSession apiKey={apiKey} />
        </div>
      </main>
    </div>
  );
};

export default App;